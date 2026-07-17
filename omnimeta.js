/*
  OmniMeta — a substrate-neutral OMeta engine in the VVE vtable/send style.

  Depends on (already loaded from main-engine / utils): `send`, `sendNoKw`, `vtables`.

  NAMING SCHEME (suffix tracks structural role — does the vtable own a cursor type?):
    OmniMeta      the engine: universal combinators + the cursor protocol.
    ...Substrate  owns a cursor TYPE: defines initialCursor:, cursorKey:,
                  cursor:hasConsumedMoreThan:, and the primitive(s) that
                  read/advance that cursor. (Seq, Dict, Graph, DOM.)
    ...Grammar    a vtable of matchers built on a substrate, REUSING its cursor,
                  adding no new cursor type. (Char, Number, Vertex, ...)
                  NB: adding a primitive on someone else's cursor is still a Grammar.
    matcher       one rule (consumes the cursor; returns a value or throws fail).
    grammar       a named collection of matchers.
    match (m)     the runtime object { vtable, cursor, memo } — NOT called "matcher".
    -Meta         reserved for OmniMeta and the public-name exception DOMMeta.

  Architecture:
    - A match is `m = { vtable: <grammar>, cursor, memo }`. ALL mutable state
      lives on `m`; the grammar vtable is shared + stateless.
    - Rule application IS message send: `send(self, 'apply:', 'digit')` ~ sendNoKw(self,'digit').
    - Grammar inheritance / rule override IS `_parent`.
    - Backtracking IS save/restore of `self.cursor` + thrown `fail`.

  THE INVARIANT: cursor-state rolls back on backtrack; object mutation does NOT.
    Anything that must survive backtracking lives in the (immutable) cursor value.

  British spelling in comments; American in code.
*/

// ── Sentinels ──────────────────────────────────────────────────────────────
fail = { omnimetaFail: true };                // thrown for match failure; caught by combinators
MATCH_FAILED = { omnimetaMatchFailed: true }; // returned by top-level `match` on failure

// ── Engine: substrate-neutral combinators + cursor protocol ──────────────────
vtables.OmniMeta = {

  // ---- cursor protocol (substrates override) -------------------------------
  // initialCursor: MUST be overridden. The other two have defaults.
  ['initialCursor:']:            (self, input)  => { throw 'OmniMeta: abstract initialCursor:'; },
  ['cursorKey:']:                (self, cursor) => cursor,   // ints / identity by default
  ['cursor:hasConsumedMoreThan:']:(self, a, b)  => false,    // LR dormant unless overridden

  // ---- rule application ----------------------------------------------------
  // v1: direct dispatch, NO memo, NO left-recursion. This single method is the
  // ONLY place LR/packrat will ever live (Warth's seed-grow keyed on
  //   'rule@' + send(self, 'cursorKey:', self.cursor), using cursor:hasConsumedMoreThan:
  //   as the grow-termination test). Adding LR disturbs neither combinators
  //   nor substrates.
  ['apply:']:      (self, rule)       => sendNoKw(self, rule),
  ['apply:with:']: (self, rule, args) => sendNoKw(self, rule, ...args),
  //   ^ parametrised rules are just vtable methods with extra params, e.g.
  //     ['listOf:sepBy:']: (self, ruleName, delim) => ...
  //     send(self, 'apply:', 'listOf:sepBy:', 'with:', ['expr', ','])

  // ---- ordered choice ( e1 | e2 | ... ) ------------------------------------
  ['or:']: (self, alts) => {                  // alts: array of zero-arg thunks
    const save = self.cursor;
    for (const alt of alts) {
      try { self.cursor = save; return alt(); }
      catch (f) { if (f !== fail) throw f; }
    }
    throw fail;
  },

  // ---- optional ( e? ) -----------------------------------------------------
  ['opt:']: (self, thunk) => {
    const save = self.cursor;
    try { return thunk(); }
    catch (f) { if (f !== fail) throw f; self.cursor = save; return undefined; }
  },

  // ---- negation ( ~e ) — never advances ------------------------------------
  ['not:']: (self, thunk) => {
    const save = self.cursor;
    try { thunk(); }
    catch (f) { if (f !== fail) throw f; self.cursor = save; return true; }
    self.cursor = save;                        // e succeeded ⇒ ~e fails; don't advance
    throw fail;
  },

  // ---- lookahead ( &e ) — binds but never advances -------------------------
  ['lookahead:']: (self, thunk) => {
    const save = self.cursor;
    const r = thunk();
    self.cursor = save;
    return r;
  },

  // ---- repetition ( e* and e+ ) with the progress guard --------------------
  ['many:']:  (self, thunk) => send(self, 'many:', thunk, 'seed:', undefined),
  ['many1:']: (self, thunk) => { const first = thunk();
                                 return send(self, 'many:', thunk, 'seed:', first); },
  ['many:seed:']: (self, thunk, seed) => {
    const acc = seed !== undefined ? [seed] : [];
    while (true) {
      const before    = self.cursor;
      const beforeKey = send(self, 'cursorKey:', before); 
      let v;
      try { v = thunk(); }
      catch (f) {
        if (f !== fail) throw f;
        self.cursor = before;
        break;
      }   // normal end of repetition
      // Consumption-implies-progress: a successful iteration that didn't advance
      // the cursor would loop forever. The cursor-key guard is the generic,
      // substrate-neutral termination net.
      if (send(self, 'cursorKey:', self.cursor) === beforeKey)
        throw ['many: made no progress — non-terminating rule (empty success)'];
      acc.push(v);
    }
    return acc;
  },

  // ---- semantic predicate ( &`expr` ) --------------------------------------
  ['pred:']: (self, b) => { if (!b) throw fail; return true; },

  // ---- lending: foreign cursor TYPE (spawns a child match) ─────────────────
  // For same-cursor foreign rules (e.g. abstract arrow → concrete head/shaft)
  // you don't need lending — that's _parent inheritance + plain send.
  // Diverges from top-level `match` in FAILURE SEMANTICS: a failed lend THROWS
  // fail, so the calling rule's enclosing or:/opt:/not: backtracks naturally.
  // (Top-level match has no parent to backtrack into, hence MATCH_FAILED.)
  // Future divergences anticipated: inheriting parent grammar parameters
  // (e.g. ε tolerance), debug/error context, etc.  — all read off `self`.
  ['lend:input:rule:']:      (self, grammar, input, rule) => {
    const r = matchStrict(grammar, input, rule);
    if (r === MATCH_FAILED) throw fail;
    return r;
  },
  ['lend:input:rule:with:']: (self, grammar, input, rule, args) => {
    const r = matchStrict(grammar, input, rule, args);
    if (r === MATCH_FAILED) throw fail;
    return r;
  },
};

// ── Entry points ─────────────────────────────────────────────────────────────
// `match` is the friendly form: returns null on failure. Single-line composable
// at API boundaries. The project convention is that rules should not return
// null as a legitimate match value — use undefined (which `opt:` already
// returns) or a sentinel object if you genuinely need "matched but no result".
//
// `matchStrict` is the discriminating form: returns MATCH_FAILED on failure.
// Used by `lend:` internally where the engine MUST tell "rule failed" from
// "rule succeeded with null value"; available for any caller that needs the
// same distinction.
matchStrict = function(grammar, input, startRule, args) {
  const m = { vtable: grammar, cursor: null, memo: new Map() };
  m.cursor = send(m, 'initialCursor:', input);
  try {
    return args !== undefined ? send(m, 'apply:', startRule, 'with:', args)
                              : send(m, 'apply:', startRule);
  } catch (f) {
    if (f === fail) return MATCH_FAILED;
    throw f;
  }
};
 
match = function(grammar, input, startRule, args) {
  const r = matchStrict(grammar, input, startRule, args);
  return r === MATCH_FAILED ? null : r;
};

perform = match; // Signal intent for when the rule is primarily match-to-mutate


// ── SeqSubstrate: linear-index cursor over any finite indexable input ────────
// Cursor is an immutable { stream, idx }. Owns the cursor type. Element type is
// irrelevant — chars, tokens, ASTs-as-lists, and vertices are all just elements,
// which is why CharGrammar and (later) VertexGrammar are SIBLINGS here, not
// subclasses of one another.
vtables.SeqSubstrate = {
  _parent: vtables.OmniMeta,

  ['initialCursor:']:             (self, seq) => ({ stream: seq, idx: 0 }),
  ['cursorKey:']:                 (self, c)   => c.idx,
  ['cursor:hasConsumedMoreThan:']:(self, a, b)=> a.idx > b.idx,   // ordered ⇒ LR works here

  // the one true primitive: consume one element
  ['anything']: (self) => {
    const { stream, idx } = self.cursor;
    if (idx >= stream.length) throw fail;
    self.cursor = { stream, idx: idx + 1 };
    return stream[idx];
  },

  ['exactly:']: (self, x) => {          // generic over element type (===)
    const r = send(self, 'apply:', 'anything');
    send(self, 'pred:', r === x);
    return r;
  },

  ['end']: (self) => {
    send(self, 'pred:', self.cursor.idx >= self.cursor.stream.length);
    return true;
  },
};

// ── CharGrammar: character-specific matchers on SeqSubstrate ─────────────────
// Scannerless: tokenisation is just rules. `token:` skips leading whitespace
// then matches a literal; the OMeta-sugar "..." compiles to send(self, 'token:', "...").
// There is deliberately NO monolithic `scanner` rule listing every token kind
// (that's Warth's Fig 2.5 capability demo, not the practical pattern) —
// whitespace-skipping is folded into each token-match at its point of use.
vtables.CharGrammar = {
  _parent: vtables.SeqSubstrate,

  ['digit']: (self) => {
    const r = send(self, 'apply:', 'anything');
    send(self, 'pred:', typeof r === 'string' && r >= '0' && r <= '9');
    return r;
  },

  ['letter']: (self) => {
    const r = send(self, 'apply:', 'anything');
    send(self, 'pred:', typeof r === 'string' && ((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z')));
    return r;
  },

  // letter or digit — the default "identifier continuation" class.
  ['alnum']: (self) => send(self, 'or:', [
    () => send(self, 'apply:', 'letter'),
    () => send(self, 'apply:', 'digit'),
  ]),

  // exactly the given character (alias of SeqSubstrate's exactly: for chars).
  ['char:']: (self, c) => send(self, 'apply:', 'exactly:', 'with:', [c]),

  // match any one char in the given string of options.
  ['oneOf:']: (self, chars) => {
    const r = send(self, 'apply:', 'anything');
    send(self, 'pred:', typeof r === 'string' && chars.indexOf(r) >= 0);
    return r;
  },

  // zero or more whitespace chars; returns nothing useful (consumed only).
  ['spaces']: (self) => send(self, 'many:', () => send(self, 'apply:', 'oneOf:', 'with:', [' \t\r\n'])),

  // match the literal multi-char string `s` exactly, char by char.
  // Returns s on success. (No whitespace handling — that's token:.)
  ['seq:']: (self, s) => {
    for (let i = 0; i < s.length; i++) send(self, 'apply:', 'char:', 'with:', [s[i]]);
    return s;
  },

  // token: skip leading whitespace, then match literal `s`. The "..." sugar.
  // Good for punctuation/operators. For ALPHABETIC keywords that could be a
  // prefix of a longer identifier (e.g. "if" in "ifx"), use wordToken: which
  // adds a trailing-boundary check.
  ['token:']: (self, s) => {
    send(self, 'apply:', 'spaces');
    return send(self, 'apply:', 'seq:', 'with:', [s]);
  },

  // wordToken: like token: but asserts the match isn't followed by an
  // identifier-continuation char, so "if" won't match inside "ifx".
  ['wordToken:']: (self, s) => {
    send(self, 'apply:', 'spaces');
    send(self, 'apply:', 'seq:', 'with:', [s]);
    send(self, 'not:', () => send(self, 'apply:', 'alnum'));
    return s;
  },
};

// ── NumberGrammar: an example notation on CharGrammar (no LR needed) ──────────
vtables.NumberGrammar = {
  _parent: vtables.CharGrammar,

  // number = digit+   (folded in the semantic action; left-associative without LR)
  ['number']: (self) => {
    const ds = send(self, 'many1:', () => send(self, 'apply:', 'digit'));
    return ds.reduce((n, d) => n * 10 + (d.charCodeAt(0) - 48), 0);
  },
};

/*
  The classic LEFT-RECURSIVE phrasing, for reference — needs the LR mechanism in
  `apply:` and will infinite-loop under v1, so it's commented out:

    ['number']: (self) => send(self, 'or:', [
      () => { const n = send(self, 'apply:', 'number');   // <- left recursion
              const d = send(self, 'apply:', 'digit');
              return n * 10 + (d.charCodeAt(0) - 48); },
      () => { const d = send(self, 'apply:', 'digit');
              return d.charCodeAt(0) - 48; },
    ]),
*/

// (See OmniMeta's `lend:input:rule:` method above for foreign-cursor sub-matches.)

/*
  Console test (compiled-JS form, bare assignments):

    result = match(vtables.NumberGrammar, "12345", "number")   // => 12345
    bad    = match(vtables.NumberGrammar, "x99",  "number")    // => MATCH_FAILED
*/

// ── PathDataGrammar: minimal SVG path-data matching on CharGrammar ───────────
// Deliberately minimal: just enough for the literal patterns we match.
vtables.PathDataGrammar = {
  _parent: vtables.CharGrammar,

  // number = spaces '-'? digit+ ('.' digit+)?   ⟹ float
  ['number']: (self) => {
    send(self, 'apply:', 'spaces');
    const sign = send(self, 'opt:', () => send(self, 'apply:', 'char:', 'with:', ['-']));
    const int  = send(self, 'many1:', () => send(self, 'apply:', 'digit'));
    const frac = send(self, 'opt:', () => {
      send(self, 'apply:', 'char:', 'with:', ['.']);
      return send(self, 'many1:', () => send(self, 'apply:', 'digit'));
    });
    return parseFloat((sign || '') + int.join('') + (frac ? '.' + frac.join('') : ''));
  },

  // point = number ','? number   ⟹ [x, y]
  ['point']: (self) => {
    const x = send(self, 'apply:', 'number');
    send(self, 'opt:', () => send(self, 'apply:', 'token:', 'with:', [',']));
    const y = send(self, 'apply:', 'number');
    return [x, y];
  },

  // a command letter, whitespace-skipped
  ['cmd:']: (self, c) => send(self, 'apply:', 'token:', 'with:', [c]),
};

// ── VertexGrammar: cyclic vertex-list matching on SeqSubstrate ───────────────
// Cursor inherited unchanged ({stream, idx}); stream is an array of [x, y]
// vertex pairs. Vertices arrive in arbitrary starting position and winding;
// `initialCursor:` canonicalises them up front so every downstream rule sees
// the same starting point and the same winding sign.
//
// Canonical form:
//   1. The vertex with min-coords (lex-min on the [x, y] pair) is at index 0.
//   2. The cycle is wound shoelace-positive — the shoelace formula returns
//      a positive value for the canonical sequence. Polygons that arrive
//      shoelace-negative get their cycle reversed (keeping the anchor vertex
//      in place).
vtables.VertexGrammar = {
  _parent: vtables.SeqSubstrate,
 
  ['initialCursor:']: (self, verts) => ({ stream: canonicalizeVerts(verts), idx: 0 }),
 
  // polygon = anything+ end   (sanity: ≥3 vertices; consumes the full cycle).
  // Returned `verts` are in canonical form — the same array the cursor walked.
  ['polygon']: (self) => {
    const verts = send(self, 'many1:', () => send(self, 'apply:', 'anything'));
    send(self, 'apply:', 'end');
    send(self, 'pred:', verts.length >= 3);
    return { kind: 'polygon', verts };
  },
 
  // parallelogram = a b c d end
  //   ⟹ requires {b-a == c-d} and {c-b == d-a}
  //      (opposite sides equal as vectors traversed in canonical order)
  // Returns {v1, v2} — the two basis edges anchored at vertex a.
  ['parallelogram']: (self) => {
    const a = send(self, 'apply:', 'anything');
    const b = send(self, 'apply:', 'anything');
    const c = send(self, 'apply:', 'anything');
    const d = send(self, 'apply:', 'anything');
    send(self, 'apply:', 'end');
    send(self, 'pred:', vmag(vsub(vsub(b,a), vsub(c,d))) < EPS_VERTEX);
    send(self, 'pred:', vmag(vsub(vsub(c,b), vsub(d,a))) < EPS_VERTEX);
    return { kind: 'parallelogram', verts: [a,b,c,d], v1: vsub(b,a), v2: vsub(d,a) };
  },
 
  // rect = parallelogram where v1 ⊥ v2.
  // Two-tier composition: parallelogram does the structural match;
  // rect adds one perpendicularity predicate. Scale-invariant test:
  // |v1·v2| < EPS · |v1| · |v2|  ⇔  |cos θ| < EPS.
  ['rect']: (self) => {
    const p = send(self, 'apply:', 'parallelogram');
    const w = vmag(p.v1), h = vmag(p.v2);
    send(self, 'pred:', Math.abs(vdot(p.v1, p.v2)) < EPS_VERTEX * w * h);
    return { kind: 'rect', verts: p.verts, v1: p.v1, v2: p.v2, width: w, height: h };
  },
};
 
// Tolerance for vertex-level vector equality and perpendicularity tests.
// Absolute for length-like comparisons; scale-relative for angle-like
// comparisons (multiplied through by |v1|·|v2|). Adequate for Mathcha
// coordinate ranges; promote to a grammar-instance parameter if a use case
// needs finer or coarser tuning per match.
EPS_VERTEX = 0.01;
 
// Rotate the cycle so the lex-min vertex is at index 0, and reverse it if
// the shoelace sum is negative (so canonical input is always shoelace-positive).
canonicalizeVerts = function(verts) {
  if (verts.length < 3) return verts.slice();
  let mi = 0;
  for (let i = 1; i < verts.length; i++) {
    const [xi, yi] = verts[i], [xm, ym] = verts[mi];
    if (xi < xm || (xi === xm && yi < ym)) mi = i;
  }
  const rotated = verts.slice(mi).concat(verts.slice(0, mi));
  if (shoelaceArea(rotated) < 0) {
    // Reverse the cycle keeping the anchor vertex (index 0) in place.
    return [rotated[0]].concat(rotated.slice(1).reverse());
  }
  return rotated;
};
 
// Signed area via the shoelace formula. Positive ⇔ the vertex sequence
// traverses the cycle in the +-orientation defined by the formula itself
// (a property of the input numbers; independent of any screen orientation).
shoelaceArea = function(verts) {
  let s = 0;
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = verts[i];
    const [x1, y1] = verts[(i + 1) % n];
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
};
 
/*
  Console test (compiled-JS, bare assignments):
 
    // Axis-aligned square, vertices given in arbitrary starting position:
    match(vtables.VertexGrammar, [[10,10],[0,10],[0,0],[10,0]], 'polygon')
    // => { kind: 'polygon', verts: [[0,0],[10,0],[10,10],[0,10]] }
 
    // The same square, reverse winding — canonicalisation makes it identical:
    match(vtables.VertexGrammar, [[0,10],[10,10],[10,0],[0,0]], 'polygon')
    // => same canonical verts
 
    // Degenerate (<3 vertices) — polygon rejects:
    match(vtables.VertexGrammar, [[0,0],[1,1]], 'polygon')           // => null
 
    // Parallelogram (sheared, not a rect):
    match(vtables.VertexGrammar, [[0,0],[10,0],[12,5],[2,5]], 'parallelogram')
    // => { kind: 'parallelogram', v1: [10,0], v2: [2,5], verts: [...] }
    match(vtables.VertexGrammar, [[0,0],[10,0],[12,5],[2,5]], 'rect') // => null
 
    // Axis-aligned rect:
    match(vtables.VertexGrammar, [[0,0],[10,0],[10,5],[0,5]], 'rect')
    // => { kind: 'rect', width: 10, height: 5, ... }
 
    // Rotated square (45°): vertices at the diamond points.
    match(vtables.VertexGrammar, [[5,0],[10,5],[5,10],[0,5]], 'rect')
    // => { kind: 'rect', width: ~7.07, height: ~7.07 }
*/

// ── DictSubstrate ────────────────────────────────────────────────────────────
// Cursor: { dict, consumed:Set }. Owns the cursor type.
// Defaults work for plain JS objects; subclass and override the three
// dict-access protocol methods for DOM attributes, Maps, etc.
vtables.DictSubstrate = {
  _parent: vtables.OmniMeta,

  // ---- cursor protocol ----
  ['initialCursor:']: (self, dict) => ({ dict, consumed: new Set() }),
  ['cursorKey:']:     (self, c)    => [...c.consumed].sort().join('\x1f'),
  // cursor:hasConsumedMoreThan: stays false (no total order ⇒ LR dormant)

  // ---- dict-access protocol (override for non-JS-object backings) ----
  ['keysOf:']:    (self, d)    => Object.keys(d),
  ['lookup:in:']: (self, k, d) => d[k],
  ['hasKey:in:']: (self, k, d) => Object.prototype.hasOwnProperty.call(d, k),

  // ---- primitives ----
  // anyKey — consume any unconsumed key (first in keysOf: order). Returns [k,v].
  ['anyKey']: (self) => {
    const { dict, consumed } = self.cursor;
    for (const k of send(self, 'keysOf:', dict)) {
      if (consumed.has(k)) continue;
      self.cursor = { dict, consumed: new Set(consumed).add(k) };
      return [k, send(self, 'lookup:', k, 'in:', dict)];
    }
    throw fail;
  },

  // key: — consume a specific named key. Returns the value.
  ['key:']: (self, k) => {
    const { dict, consumed } = self.cursor;
    if (consumed.has(k))             throw fail;
    if (!send(self, 'hasKey:', k, 'in:', dict))  throw fail;
    self.cursor = { dict, consumed: new Set(consumed).add(k) };
    return send(self, 'lookup:', k, 'in:', dict);
  },
};

/*
  Console test (compiled JS, bare assignments):

    // match a single key
    match(vtables.DictSubstrate, {name:'Joel', age:29}, 'key:', ['name'])  // => 'Joel'
    match(vtables.DictSubstrate, {name:'Joel'},          'key:', ['nope']) // => MATCH_FAILED

    // openness: extra keys silently ignored, no `closed` needed
    vtables.PersonGrammar = {
      _parent: vtables.DictSubstrate,
      ['person']: (self) => ({
        name: send(self, 'apply:', 'key:', 'with:', ['name']),
        age:  send(self, 'apply:', 'key:', 'with:', ['age']),
      }),
    }
    match(vtables.PersonGrammar, {name:'Joel', age:29, hobby:'svg'}, 'person')
    // => { name: 'Joel', age: 29 }   (hobby silently ignored — openness)
*/

// ── DOMAttrSubstrate ─────────────────────────────────────────────────────────
// Same cursor, same primitives as DictSubstrate; overrides the three dict-access
// protocol methods to read DOM attributes instead of JS object keys.
// Values are ALWAYS strings (DOM contract); lend: into a sub-grammar for parsing.
vtables.DOMAttrSubstrate = {
  _parent: vtables.DictSubstrate,

  ['keysOf:']:    (self, elt)    => [...elt.attributes].map(a => a.name),
  ['lookup:in:']: (self, k, elt) => elt.getAttribute(k),
  ['hasKey:in:']: (self, k, elt) => elt.hasAttribute(k),
};

/*
  Console test (compiled JS, bare assignments):

    elt = document.querySelector('rect')   // or whatever's handy

    // direct attribute access
    match(vtables.DOMAttrSubstrate, elt, 'key:', ['fill'])    // => 'red' (or whatever)

    // openness: extra attributes ignored — exactly as we want for DOM
    vtables.PositionedGrammar = {
      _parent: vtables.DOMAttrSubstrate,
      ['positioned']: (self) => ({
        x: parseFloat(send(self, 'apply:', 'key:', 'with:', ['x'])),
        y: parseFloat(send(self, 'apply:', 'key:', 'with:', ['y'])),
      }),
    }
    match(vtables.PositionedGrammar, elt, 'positioned')
    // => { x: 10, y: 20 }   (fill, stroke, class, etc. silently ignored)
*/

// ── DOMMeta ──────────────────────────────────────────────────────────────────
// Cursor: { dict, consumed:Set }  (inherited shape from DictSubstrate, where
// `dict` is the current DOM element). Tree navigation produces a fresh cursor
// with consumed reset; attribute matching mutates the consumed-set in place
// (immutably). Backtracking restores both atomically via cursor restoration.
vtables.DOMMeta = {
  _parent: vtables.DOMAttrSubstrate,

  // ---- tree navigation: each produces a fresh cursor at the new element ────
  // Convention: throw fail if the navigation can't land somewhere.

  ['parent']: (self) => {
    const p = self.cursor.dict.parentElement;
    if (!p) throw fail;
    self.cursor = { dict: p, consumed: new Set() };
    return p;
  },

  ['firstChild']: (self) => {
    const c = self.cursor.dict.firstElementChild;
    if (!c) throw fail;
    self.cursor = { dict: c, consumed: new Set() };
    return c;
  },

  ['firstChildWhere:']: (self, predFn) => {
    for (const c of self.cursor.dict.children) {
      if (predFn(c)) {
        self.cursor = { dict: c, consumed: new Set() };
        return c;
      }
    }
    throw fail;
  },

  ['nthChild:']: (self, n) => {
    const c = self.cursor.dict.children[n];
    if (!c) throw fail;
    self.cursor = { dict: c, consumed: new Set() };
    return c;
  },

  // CSS-selector descent: cursor moves to first matching descendant.
  ['querySelector:']: (self, sel) => {
    const c = self.cursor.dict.querySelector(sel);
    if (!c) throw fail;
    self.cursor = { dict: c, consumed: new Set() };
    return c;
  },

  // ---- backtracking-aware OMeta-style descendant search ───────────────────
  // Apply `rule` at the first descendant where it succeeds; cursor lands there.
  // Depth-first, pre-order (excluding self). Failure means no descendant matches.
  ['findFirstMatching:']: (self, rule) => {
    const root = self.cursor.dict;
    const stack = [...root.children].reverse();   // pre-order, left-to-right
    while (stack.length) {
      const node = stack.pop();
      const save = self.cursor;
      self.cursor = { dict: node, consumed: new Set() };
      try {
        const v = send(self, 'apply:', rule);
        return v;                                  // cursor stays at the match
      } catch (f) {
        if (f !== fail) throw f;
        self.cursor = save;                        // restore; try next descendant
      }
      for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
    }
    throw fail;
  },
};

/*
  Console test (compiled-JS form, bare assignments):

    elt = document.querySelector('svg')

    vtables.PathFinderGrammar = {
      _parent: vtables.DOMMeta,
      ['hasD']: (self) => sendNoKw(self, 'key:', 'd'),
      ['anyPathD']: (self) => sendNoKw(self, 'findFirstMatching:', 'hasD'),
    }
    match(vtables.PathFinderGrammar, elt, 'anyPathD')
    // => the `d` attribute string of the first descendant that has one
*/

// ── ChildSetSubstrate ────────────────────────────────────────────────────────
// Cursor: { parent:Element, consumed:Set<Element> }.
// "Match the children of `parent` as an unordered multiset, taking without
// replacement." Each primitive success consumes one child by adding it to
// consumed. Backtracking restores the whole cursor; consumption rolls back
// automatically — cursor-state IS the rollback boundary.
//
// Designed to host abstract/concrete grammar pairs that match notation
// components: e.g. an arrow grammar identifying two heads via a paired
// DOM-rules grammar that tests individual children.
vtables.ChildSetSubstrate = {
  _parent: vtables.OmniMeta,

  ['initialCursor:']: (self, elt) => ({ parent: elt, consumed: new Set() }),

  // consumed.size suffices for many:'s progress guard (monotonic on
  // successful consumption). Full equality for memo needs a stable
  // serialisation (e.g. lazy ids via WeakMap); deferred.
  ['cursorKey:']:     (self, c)   => c.consumed.size,
  // No total order on consumed-sets ⇒ LR dormant.

  // ---- primitives ──────────────────────────────────────────────────────────

  // Consume any unconsumed child (first by document order); return the Element.
  ['anyChild']: (self) => {
    const { parent, consumed } = self.cursor;
    for (const c of parent.children) {
      if (consumed.has(c)) continue;
      self.cursor = { parent, consumed: new Set(consumed).add(c) };
      return c;
    }
    throw fail;
  },

  // Consume an unconsumed child satisfying a JS predicate.
  ['childWhere:']: (self, predFn) => {
    const { parent, consumed } = self.cursor;
    for (const c of parent.children) {
      if (consumed.has(c)) continue;
      if (predFn(c)) {
        self.cursor = { parent, consumed: new Set(consumed).add(c) };
        return c;
      }
    }
    throw fail;
  },

  // The workhorse: consume an unconsumed child for which `ruleName` in
  // `grammar` succeeds. Lends to that grammar with a fresh sub-match at the
  // candidate child; first success consumes that child and returns the
  // foreign rule's match value. This is the cross-substrate join.
  ['childMatching:inGrammar:']: (self, ruleName, grammar) => {
    const { parent, consumed } = self.cursor;
    for (const c of parent.children) {
      if (consumed.has(c)) continue;
      try {
        const v = send(self, 'lend:', grammar, 'input:', c, 'rule:', ruleName);
        self.cursor = { parent, consumed: new Set(consumed).add(c) };
        return v;
      } catch (f) {
        if (f !== fail) throw f;
        // not this one; try next unconsumed child
      }
    }
    throw fail;
  },
};

/*
  Console test (compiled-JS, bare assignments) — demonstrates the cross-grammar
  pattern that AbstractArrow / MathchaArrow will be a specialisation of:

    parentElt = document.querySelector('g')   // a <g> containing mixed children

    // A tiny DOMMeta-side rules grammar: tests a single element.
    vtables.SimpleShapeRules = {
      _parent: vtables.DOMMeta,
      ['circle']: (self) => {
        sendNoKw(self, 'pred:', self.cursor.dict.tagName === 'circle');
        return { kind: 'circle', elt: self.cursor.dict };
      },
    }

    // A ChildSet-side grammar: orchestrates which children to consume.
    vtables.CountCircles = {
      _parent: vtables.ChildSetSubstrate,
      ['circles']: (self) =>
        sendNoKw(self, 'many:', () =>
          sendNoKw(self, 'apply:with:', 'childMatching:inGrammar:',
                   ['circle', vtables.SimpleShapeRules])),
    }

    match(vtables.CountCircles, parentElt, 'circles')
    // => one entry per circle child; rect/text children silently skipped
*/

// ── HeadShaftArrow ────────────────────────────────────────────────────────────
// Grammar for arrows with separate head/shaft elements, operating over a <g>'s
// children-as-multiset. Leaves `head` and `shaft` abstract; concrete grammars
// override. The endpoints rule uses the classify-then-project pattern we settled
// on: targetPt/originPt are inspections (under `lookahead:`) that share one
// classification of the head, so the original sketch's structure is preserved exactly.
vtables.HeadShaftArrow = {
  _parent: vtables.ChildSetSubstrate,
  // head, shaft: abstract — concrete grammars override.
 
  // arrow endpoints = &targetPt:t &originPt:o     => [o, t]
  //                 | head:h1 head:h2 ~head       => [h1.tip, h2.tip]
  //                 | shaft:s                     => send(s, 'endpoints')
  ['endpoints']: (self) => send(self, 'or:', [
    () => {
      const t = send(self, 'lookahead:', () => send(self, 'apply:', 'targetPt'));
      const o = send(self, 'lookahead:', () => send(self, 'apply:', 'originPt'));
      return [o, t];
    },
    () => {
      const h1 = send(self, 'apply:', 'head');
      const h2 = send(self, 'apply:', 'head');
      send(self, 'not:', () => send(self, 'apply:', 'head'));
      return [h1.tip, h2.tip];
    },
    () => {
      const s = send(self, 'apply:', 'shaft');
      return send(s, 'endpoints');
    },
  ]),
 
  // arrow targetPt = head:h ~head => h.tip
  ['targetPt']: (self) => {
    const h = send(self, 'apply:', 'head');
    send(self, 'not:', () => send(self, 'apply:', 'head'));
    return h.tip;
  },
 
  // arrow targetPt: t = head:h ~head shaft:s
  //   ⟹ send(s, 'orientWith:', h)  -- the explicit symmetry-breaking step
  //      send(s, 'target:', t)      -- moves the appropriate DOM endpoint
  //      send(h, 'touch:', t)       -- moves the head's tip to the new target
  //      send(h, 'lookAlong:', send(s, 'outwardTangentAtTarget'))  -- head aims away from shaft body
  ['targetPt:']: (self, t) => {
    const h = send(self, 'apply:', 'head');
    send(self, 'not:', () => send(self, 'apply:', 'head'));
    const s = send(self, 'apply:', 'shaft');
    send(s, 'orientWith:', h);
    send(s, 'target:', t);
    send(h, 'touch:', t);
    send(h, 'lookAlong:', send(s, 'outwardTangentAtTarget'));
  },
 
  // arrow originPt = head:h ~head shaft:s  ⟹ send(s, 'orientWith:', h); send(s, 'origin')
  ['originPt']: (self) => {
    const h = send(self, 'apply:', 'head');
    send(self, 'not:', () => send(self, 'apply:', 'head'));
    const s = send(self, 'apply:', 'shaft');
    send(s, 'orientWith:', h);
    return send(s, 'origin');
  },
 
  // arrow originPt: o = head:h ~head shaft:s
  //   ⟹ send(s, 'orientWith:', h)
  //      send(s, 'origin:', o)
  //      send(h, 'lookAlong:', vsub(h.tip, o))   -- head's tip unchanged; only its angle.
  ['originPt:']: (self, o) => {
    const h = send(self, 'apply:', 'head');
    send(self, 'not:', () => send(self, 'apply:', 'head'));
    const s = send(self, 'apply:', 'shaft');
    send(s, 'orientWith:', h);
    send(s, 'origin:', o);
    send(h, 'lookAlong:', send(s, 'outwardTangentAtTarget'));
  },
};

// ── MathchaArrow: the adapter ────────────────────────────────────────────────
vtables.MathchaArrow = {
  _parent: vtables.HeadShaftArrow,

  ['head']:  (self) => send(self, 'apply:', 'childMatching:inGrammar:', 'with:', ['head',  vtables.MathchaHeadShaftRules]),
  ['shaft']: (self) => send(self, 'apply:', 'childMatching:inGrammar:', 'with:', ['shaft', vtables.MathchaHeadShaftRules]),
};

// ── MathchaHeadShaftRules: per-element classifiers ───────────────────────────
vtables.MathchaHeadShaftRules = {
  _parent: vtables.DOMMeta,

  // mathcha head = g transform=(col:back col:left col:tip)
  //                => {fwd: neg(back), tip: tip}
  ['head']: (self) => {
    const elt = self.cursor.dict;
    send(self, 'pred:', elt.tagName === 'g');
    send(self, 'pred:', elt.transform?.baseVal?.numberOfItems > 0);
    const m    = elt.transform.baseVal[0].matrix;
    const back = [m.a, m.b];
    const tip  = [m.e, m.f];
    return { vtable: vtables.MathchaArrowhead, elt, tip, fwd: neg(back) };
  },

  // mathcha shaft = (path|polyline|line) .connection .real
  ['shaft']: (self) => {
    const elt = self.cursor.dict;
    const cl = elt.classList;
    send(self, 'pred:', ['path','polyline','line'].includes(elt.tagName));
    send(self, 'pred:', cl.contains('connection') && cl.contains('real'));
    return { vtable: vtables.MathchaArrowShaft, elt };
  },
};

/*
  Console test (compiled-JS, bare assignments):

    arrowG = document.querySelector('g.arrow')    // pick an arrow <g>

    eps = match(vtables.MathchaArrow, arrowG, 'endpoints')
    // directed (1 head):       [origin, target]
    // double-headed (2 heads): [tip,    tip]
    // plain line (0 heads):    [start,  end]
*/
 
// ── AbstractArrowShaft ───────────────────────────────────────────────────────
// Defines the directional API (origin/target getters & setters, outward tangents)
// in terms of three SYMMETRIC primitives that subclasses must implement:
//   endpointAt: i           → the endpoint at DOM-order index i
//   endpointAt: i put: pt   → mutate the endpoint at DOM-order index i
//   outwardTangentAt: i     → unit vector pointing AWAY from the shaft at i
//
// The directional API requires `orientWith:` to have been called first with
// the relevant arrowhead — that's the single, explicit symmetry-breaking step.
// Once oriented, origin/target/outwardTangentAt{Origin,Target} are defined
// purely in terms of self.originIdx/targetIdx and the symmetric primitives.
//
// dataset.originIndex disappears — orientation is a transient wrapper field.
vtables.AbstractArrowShaft = {
  // — orientation —
  ['orientWith:']: (self, arrowhead) => {
    const e0 = send(self, 'endpointAt:', 0);
    const e1 = send(self, 'endpointAt:', 1);
    self.targetIdx = dist2(e0, arrowhead.tip) < dist2(e1, arrowhead.tip) ? 0 : 1;
    self.originIdx = 1 - self.targetIdx;
    return self;
  },
 
  // — oriented getters & setters (require orientWith: first) —
  ['origin']:                 (self)     => send(self, 'endpointAt:', self.originIdx),
  ['target']:                 (self)     => send(self, 'endpointAt:', self.targetIdx),
  ['origin:']:                (self, pt) => send(self, 'endpointAt:', self.originIdx, 'put:', pt),
  ['target:']:                (self, pt) => send(self, 'endpointAt:', self.targetIdx, 'put:', pt),
  ['outwardTangentAtOrigin']: (self)     => send(self, 'outwardTangentAt:', self.originIdx),
  ['outwardTangentAtTarget']: (self)     => send(self, 'outwardTangentAt:', self.targetIdx),
};

// ── MathchaArrowShaft becomes a marker wrapper ────────────────────────────
// The classifier returns this so the directional API from AbstractArrowShaft
// can run. All the real work passes through to the element via the existing
// doesNotUnderstand: forwarder, which now finds endpointAt: / outwardTangentAt:
// on byTag[elt.tagName] automatically.
vtables.MathchaArrowShaft = {
  _parent: vtables.AbstractArrowShaft,
  ['doesNotUnderstand:']: (self, [sel, ...args]) => sendNoKw(self.elt, sel, ...args),
};

vtables.AbstractArrowhead = {
  // Abstract: every concrete head defines how to apply a position + direction.
  // Subclasses implement placeAt:lookingAlong: against their own encoding.
};

vtables.MathchaArrowhead = {
  _parent: vtables.AbstractArrowhead,
 
  // The single source of Mathcha-head conventions — both directions.
  // (Cross-reference: the READ side that produces {tip, fwd} from this same
  // matrix encoding lives in MathchaHeadShaftRules.head.)
  ['lookAlong:']: (self, fwd) => {
    const n = vmag(fwd) > 0.001 ? vnormed(fwd) : [1, 0];
    const m = self.elt.transform.baseVal[0].matrix;
    // Empirically determined based on Mathcha's arrowhead coord sys
    /* [ */ m.a = -n[0]; m.c =  n[1]; // e ]
    /* [ */ m.b = -n[1]; m.d = -n[0]; // f ]
    //       look back     look left
  },
 
  ['touch:']: (self, tip) => {
    const m = self.elt.transform.baseVal[0].matrix;
    m.e = tip[0]; m.f = tip[1];
  },
 
  // Everything else (id, parentElement, ...) flows through to the element.
  ['doesNotUnderstand:']: (self, [sel, ...args]) => sendNoKw(self.elt, sel, ...args),
};

vtables.PowerpointArrow = {
  _parent: vtables.DOMMeta,

  // arrow = path d=(M b1 _* b2 Z M _ tip ...) ⟹ { from: (b1 ~ b2), to: tip }
  ['endpoints']: (self) => {
    const elt = self.cursor.dict;
    send(self, 'pred:', elt.tagName === 'path');
    const d = send(self, 'apply:', 'key:', 'with:', ['d']);
    return send(self, 'lend:', vtables.PowerpointArrowPath, 'input:', d, 'rule:', 'arrow');
  },

  ['originPt']: (self) => { const [from, to] = send(self, 'endpoints'); return from; },
  ['targetPt']: (self) => { const [from, to] = send(self, 'endpoints'); return to; },
  ['isDirected']: () => true, // FOR NOW...
};

// ── PowerpointArrowPath: the literal PP arrow path-data pattern ──────────────
vtables.PowerpointArrowPath = {
  _parent: vtables.PathDataGrammar,

  // arrow = M b1 _* b2 Z M _ tip ... ⟹ { from: (b1 ~ b2), to: tip }
  ['arrow']: (self) => {
    send(self, 'apply:', 'cmd:', 'with:', ['M']);
    const b1 = send(self, 'apply:', 'point');

    // `_*` — skip points, stopping at the LAST one before Z.
    // A plain `point*` here would be WRONG: PEG repetition is possessive, so it
    // would swallow b2 as well and the following `point:b2` could never match
    // (no backtracking into a `*`). The `~(point Z)` lookahead is exactly what
    // makes "stop just before the closing point" expressible — your instinct
    // that lookahead was necessary is right, and this is why.
    send(self, 'many:', () => {
      send(self, 'not:', () => { send(self, 'apply:', 'point'); send(self, 'apply:', 'cmd:', 'with:', ['Z']); });
      return send(self, 'apply:', 'point');
    });

    const b2 = send(self, 'apply:', 'point');
    send(self, 'apply:', 'cmd:', 'with:', ['Z']);
    send(self, 'apply:', 'cmd:', 'with:', ['M']);
    send(self, 'apply:', 'point');
    const tip = send(self, 'apply:', 'point');
    // `...` — remainder deliberately unmatched; we just stop here.

    return [vmul(0.5, vadd(b1, b2)), tip];
  },
};