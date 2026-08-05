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
    - Rule application IS message send: `⟦self apply: 'digit'⟧` ~ sendNoKw(self,'digit').
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
  //   'rule@' + ⟦self cursorKey: self.cursor⟧, using cursor:hasConsumedMoreThan:
  //   as the grow-termination test). Adding LR disturbs neither combinators
  //   nor substrates.
  ['apply:']:      (self, rule)       => sendNoKw(self, rule),
  ['apply:with:']: (self, rule, args) => sendNoKw(self, rule, ...args),
  //   ^ parametrised rules are just vtable methods with extra params, e.g.
  //     ['listOf:sepBy:']: (self, ruleName, delim) => ...
  //     ⟦self apply: 'listOf:sepBy:' with: ['expr', ',']⟧

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
  ['many:']:  (self, thunk) => ⟦self many: thunk seed: undefined⟧,
  ['many1:']: (self, thunk) => { const first = thunk();
                                 return ⟦self many: thunk seed: first⟧; },
  ['many:seed:']: (self, thunk, seed) => {
    const acc = seed !== undefined ? [seed] : [];
    while (true) {
      const before    = self.cursor;
      const beforeKey = ⟦self cursorKey: before⟧; 
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
      if (⟦self cursorKey: self.cursor⟧ === beforeKey)
        throw ['many: made no progress — non-terminating rule (empty success)'];
      acc.push(v);
    }
    return acc;
  },

  // ---- semantic predicate ( &`expr` ) --------------------------------------
  ['pred:']: (self, b) => { if (!b) throw fail; return true; },

  // ---- rule designators ----------------------------------------------------
  // A "rule designator" is either a NAME (string) — late-bound & overridable
  // through self's vtable chain — or a THUNK (self => result) for composed
  // applications like Named(Box) passed as an argument. `applyRule:` accepts
  // both. Prefer names wherever possible: they keep binding contexts live.
  // (A thunk still resolves its inner names late, since its body goes through
  //  apply: on self — the thunk freezes the SHAPE of the application, not the
  //  bindings.)
  ['applyRule:']: (self, designator) =>
    (typeof designator === 'function')
      ? designator(self)
      : ⟦self apply: designator⟧,

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
  m.cursor = ⟦m initialCursor: input⟧;
  try {
    return args !== undefined ? ⟦m apply: startRule with: args⟧
                              : ⟦m apply: startRule⟧;
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
    const r = ⟦self apply: 'anything'⟧;
    ⟦self pred: r === x⟧;
    return r;
  },

  ['end']: (self) => {
    ⟦self pred: self.cursor.idx >= self.cursor.stream.length⟧;
    return true;
  },

  ['show']: (self) => {
    let consumed = new Array(self.cursor.idx);
    let next = new Array(self.cursor.stream.length - self.cursor.idx);
    let i = 0;
    for (; i<consumed.length; i++) consumed[i] = self.cursor.stream[i];
    for (; i<next.length; i++) next[i] = self.cursor.stream[i];
    if (typeof self.cursor.stream === 'string') {
      consumed = consumed.join('');
      next = next.join('');
    }
    return [consumed, next];
  },
};

// ── CharGrammar: character-specific matchers on SeqSubstrate ─────────────────
// Scannerless: tokenisation is just rules. `token:` skips leading whitespace
// then matches a literal; the OMeta-sugar "..." compiles to ⟦self token: "..."⟧.
// There is deliberately NO monolithic `scanner` rule listing every token kind
// (that's Warth's Fig 2.5 capability demo, not the practical pattern) —
// whitespace-skipping is folded into each token-match at its point of use.
vtables.CharGrammar = {
  _parent: vtables.SeqSubstrate,

  ['digit']: (self) => {
    const r = ⟦self apply: 'anything'⟧;
    ⟦self pred: typeof r === 'string' && r >= '0' && r <= '9'⟧;
    return r;
  },

  ['letter']: (self) => {
    const r = ⟦self apply: 'anything'⟧;
    ⟦self pred: typeof r === 'string'
              && ((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z'))⟧;
    return r;
  },

  // letter or digit — the default "identifier continuation" class.
  ['alnum']: (self) => ⟦self or: [
    () => ⟦self apply: 'letter'⟧,
    () => ⟦self apply: 'digit'⟧,
  ]⟧,

  // exactly the given character (alias of SeqSubstrate's exactly: for chars).
  ['char:']: (self, c) => ⟦self apply: 'exactly:' with: [c]⟧,

  // match any one char in the given string of options.
  ['oneOf:']: (self, chars) => {
    const r = ⟦self apply: 'anything'⟧;
    ⟦self pred: typeof r === 'string' && chars.indexOf(r) >= 0⟧;
    return r;
  },

  // zero or more whitespace chars; returns nothing useful (consumed only).
  ['spaces']: (self) => ⟦self many: () => ⟦self apply: 'oneOf:' with: [' \t\r\n']⟧⟧,

  // match the literal multi-char string `s` exactly, char by char.
  // Returns s on success. (No whitespace handling — that's token:.)
  ['seq:']: (self, s) => {
    for (let i = 0; i < s.length; i++) ⟦self apply: 'char:' with: [s[i]]⟧;
    return s;
  },

  // token: skip leading whitespace, then match literal `s`. The "..." sugar.
  // Good for punctuation/operators. For ALPHABETIC keywords that could be a
  // prefix of a longer identifier (e.g. "if" in "ifx"), use wordToken: which
  // adds a trailing-boundary check.
  ['token:']: (self, s) => {
    ⟦self apply: 'spaces'⟧;
    return ⟦self apply: 'seq:' with: [s]⟧;
  },

  // wordToken: like token: but asserts the match isn't followed by an
  // identifier-continuation char, so "if" won't match inside "ifx".
  ['wordToken:']: (self, s) => {
    ⟦self apply: 'spaces'⟧;
    ⟦self apply: 'seq:' with: [s]⟧;
    ⟦self not: () => ⟦self apply: 'alnum'⟧⟧;
    return s;
  },
};

// ── NumberGrammar: an example notation on CharGrammar (no LR needed) ──────────
vtables.NumberGrammar = {
  _parent: vtables.CharGrammar,

  // number = digit+   (folded in the semantic action; left-associative without LR)
  ['number']: (self) => {
    const ds = ⟦self many1: () => ⟦self apply: 'digit'⟧⟧;
    return ds.reduce((n, d) => n * 10 + (d.charCodeAt(0) - 48), 0);
  },
};

/*
  The classic LEFT-RECURSIVE phrasing, for reference — needs the LR mechanism in
  `apply:` and will infinite-loop under v1, so it's commented out:

    ['number']: (self) => ⟦self or: [
      () => { const n = ⟦self apply: 'number'⟧;   // <- left recursion
              const d = ⟦self apply: 'digit'⟧;
              return n * 10 + (d.charCodeAt(0) - 48); },
      () => { const d = ⟦self apply: 'digit'⟧;
              return d.charCodeAt(0) - 48; },
    ]⟧,
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
    ⟦self apply: 'spaces'⟧;
    const sign = ⟦self opt: () => ⟦self apply: 'char:' with: ['-']⟧⟧;
    const int  = ⟦self many1: () => ⟦self apply: 'digit'⟧⟧;
    const frac = ⟦self opt: () => {
      ⟦self apply: 'char:' with: ['.']⟧;
      return ⟦self many1: () => ⟦self apply: 'digit'⟧⟧;
    }⟧;
    return parseFloat((sign || '') + int.join('') + (frac ? '.' + frac.join('') : ''));
  },

  // point = number ','? number   ⟹ [x, y]
  ['point']: (self) => {
    const x = ⟦self apply: 'number'⟧;
    ⟦self opt: () => ⟦self apply: 'token:' with: [',']⟧⟧;
    const y = ⟦self apply: 'number'⟧;
    return [x, y];
  },

  // a command letter, whitespace-skipped
  ['cmd:']: (self, c) => ⟦self apply: 'token:' with: [c]⟧,
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
    const verts = ⟦self many1: () => ⟦self apply: 'anything'⟧⟧;
    ⟦self apply: 'end'⟧;
    ⟦self pred: verts.length >= 3⟧;
    return { kind: 'polygon', verts };
  },
 
  // parallelogram = a b c d end
  //   ⟹ requires {b-a == c-d} and {c-b == d-a}
  //      (opposite sides equal as vectors traversed in canonical order)
  // Returns {v1, v2} — the two basis edges anchored at vertex a.
  ['parallelogram']: (self) => {
    const a = ⟦self apply: 'anything'⟧;
    const b = ⟦self apply: 'anything'⟧;
    const c = ⟦self apply: 'anything'⟧;
    const d = ⟦self apply: 'anything'⟧;
    ⟦self apply: 'end'⟧;
    ⟦self pred: vmag(vsub(vsub(b,a), vsub(c,d))) < EPS_VERTEX⟧;
    ⟦self pred: vmag(vsub(vsub(c,b), vsub(d,a))) < EPS_VERTEX⟧;
    return { kind: 'parallelogram', verts: [a,b,c,d], v1: vsub(b,a), v2: vsub(d,a) };
  },
 
  // rect = parallelogram where v1 ⊥ v2.
  // Two-tier composition: parallelogram does the structural match;
  // rect adds one perpendicularity predicate. Scale-invariant test:
  // |v1·v2| < EPS · |v1| · |v2|  ⇔  |cos θ| < EPS.
  ['rect']: (self) => {
    const p = ⟦self apply: 'parallelogram'⟧;
    const w = vmag(p.v1), h = vmag(p.v2);
    ⟦self pred: Math.abs(vdot(p.v1, p.v2)) < EPS_VERTEX * w * h⟧;
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
    for (const k of ⟦self keysOf: dict⟧) {
      if (consumed.has(k)) continue;
      self.cursor = { dict, consumed: new Set(consumed).add(k) };
      return [k, ⟦self lookup: k in: dict⟧];
    }
    throw fail;
  },

  // key: — consume a specific named key. Returns the value.
  ['key:']: (self, k) => {
    const { dict, consumed } = self.cursor;
    if (consumed.has(k))             throw fail;
    if (!⟦self hasKey: k in: dict⟧)  throw fail;
    self.cursor = { dict, consumed: new Set(consumed).add(k) };
    return ⟦self lookup: k in: dict⟧;
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
        name: ⟦self apply: 'key:' with: ['name']⟧,
        age:  ⟦self apply: 'key:' with: ['age']⟧,
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
        x: parseFloat(⟦self apply: 'key:' with: ['x']⟧),
        y: parseFloat(⟦self apply: 'key:' with: ['y']⟧),
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
        const v = ⟦self apply: rule⟧;
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
        const v = ⟦self lend: grammar input: c rule: ruleName⟧;
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

// Does this receiver's vtable chain define `sel`? (No send — avoids DNU.)
hasRule = (recv, sel) => {
  let vt = recv.vtable;
  vt = typeof vt === 'string' ? vtables[vt] : vt;
  for (; vt; vt = vt._parent) if (vt[sel] !== undefined) return true;
  return false;
};

// ── RegionSubstrate ──────────────────────────────────────────────────────────
// Claim-pruning descent over a DOM region. Like ChildSetSubstrate but searches
// the whole subtree of `scope`, not just direct children — and PRUNES: when an
// element is claimed (or already consumed), its entire subtree is skipped, so a
// claimed node is opaque (the outer notation never sees inside it). This is the
// substrate that `X*` claim-stars run on for region notations (Graph, etc.).
//
// Ported from main-engine's GraphNotation>>findIn:matching:excluding:, with two
// faithful details preserved:
//   • node-opacity: a matched shape's contained subtree is not searched.
//   • the DOM Shape Protocol wrapper-hop: shapes sit inside a wrapper <g>, so a
//     claim on a shape propagates to its wrapper and we skip the wrapper's other
//     children (they belong to the same conceptual node).
//
// Cursor: { scope, consumed:Set<Element> }.  cursorKey = consumed.size
// (monotonic ⇒ good enough for the progress guard; unordered ⇒ LR dormant).
vtables.RegionSubstrate = {
  _parent: vtables.OmniMeta,

  ['initialCursor:']: (self, scope) => ({ scope, consumed: new Set() }),
  ['cursorKey:']:     (self, c)     => c.consumed.size,

  // claimMatching: — descend from scope in document order, skipping consumed-or-
  // claimed subtrees; return-and-consume the FIRST element on which the given
  // rule designator succeeds. `fail` when the region is exhausted.
  //
  // The designated vocabulary rule (Box, Arrow, ...) runs THROUGH self — same
  // grammar, same vtable chain — on a TRANSIENT candidate focus. This is the
  // "candidate-focus" compromise: the region cursor temporarily grows a `dict`
  // field pointing at the candidate, so vocabulary rules read self.cursor.dict
  // (DOMMeta-style) while region-scan state (scope, consumed) rides along. The
  // focus is strictly scoped — set, rule applied, restored — and never leaks.
  // Vocabulary rules are thus SIBLINGS in the notation library, overridable via
  // _parent, with no separate grammar and no lending (a rule that genuinely
  // needs full DOMMeta machinery can still lend explicitly).
  ['claimMatching:']: (self, designator) => {
    const selRule = (typeof designator === 'string') ? designator + 'Sel' : null;
    const sel = (selRule && hasRule(self, selRule)) ? ⟦self apply: selRule⟧ : null;
    return ⟦self
      claimFirst: (elem) => {
        // predicate: does the designator match at this element?
        // Runs the rule via transient focus; returns {value} or null.
        const { scope, consumed } = self.cursor;
        const savedCursor = self.cursor;
        self.cursor = { scope, consumed, dict: elem };
        try {
          const v = ⟦self applyRule: designator⟧;
          self.cursor = savedCursor;
          return { value: v };
        } catch (f) {
          if (f !== fail) throw f;
          self.cursor = savedCursor;
          return null;
        }
      }
      onExhausted: () => { throw fail; }
      piercing: false
      quickTest: sel ? (e => e.matches(sel)) : null
    ⟧;
  },

  // claimFirst:onExhausted:piercing:quickTest — the shared claim core. Descends the
  // region in document order. `test(elem)` returns a truthy { value } to
  // claim-here-and-stop-descent, or null to keep searching. On a claim:
  // wrapper-hops (consumes the element AND its DOM Shape Protocol wrapper root)
  // and returns test's value. On exhaustion: calls onExhausted (throw fail for
  // a required claim; return null for an optional one). quickTest is e.g. CSS selector
  //
  // `piercing` splits the two jobs opacity was doing with one mechanism:
  //   • false (STRUCTURAL, default use): a consumed element is skipped AND its
  //     whole subtree pruned — node-opacity, so an arrow inside a claimed box is
  //     never seen as an outer-graph edge.
  //   • true (ATTACHMENT): a consumed element is skipped as a CANDIDATE (can't
  //     re-claim it) but we still DESCEND into it — so a name-text inside a
  //     claimed box is reachable. The curtain lifts for looking, not for taking.
  ['claimFirst:onExhausted:piercing:quickTest:']: (self, test, onExhausted, piercing, quickTest) => {
    const { scope, consumed } = self.cursor;

    const search = (elem) => {
      const claimed = consumed.has(elem);
      if (claimed && !piercing) return null; // structural: skip AND prune
      if (!claimed && (!quickTest || quickTest(elem))) {   // cheap reject, no throw
        const hit = test(elem);
        if (hit) return { elem, value: hit.value };
      }
      for (const child of elem.children) {
        const found = search(child);
        if (found) return found;
      }
      return null;
    };

    const found = search(scope);
    if (!found) return onExhausted();

    // Wrapper-hop: consume the found element AND its wrapper root.
    const root = ⟦found.elem localRoot⟧;
    const nextConsumed = new Set(consumed).add(found.elem);
    if (root && root !== found.elem) nextConsumed.add(root);
    self.cursor = { scope, consumed: nextConsumed };

    return found.value;
  },
};

// ── NotationGrammar ──────────────────────────────────────────────────────────
// Shared machinery for any notation parsed from a region: proximity naming,
// tolerances, and the contract's vocabulary defaults. Sits between the
// substrate (cursor + claim primitives) and concrete notations.
vtables.NotationGrammar = {
  _parent: vtables.RegionSubstrate,

  ['fromDocument']: (self) => {
    window.semantics = ⟦self fromRegion: svg_parent⟧;
  },
  ['fromRegion:']: (self, scope) => match(self.vtable, scope, 'Root'), // May override

  // ---- Named: decorator combinator ----------------------------------------
  // Named(inner): claim the inner thing, then claim a name-text near it.
  // TOTAL and OPTIONAL: no nearby text ⇒ name: null (still wrapped). Consumers
  // enforce non-null if they need it. Passed as a designator via the thunk
  //   (self) => ⟦self Named: 'Box'⟧
  // The name-text, if found, is CLAIMED (consumed) — proximity-labelling is
  // exclusive; a label can name at most one thing.
  ['Named:']: (self, inner) => {
    const thing = ⟦self claimMatching: inner⟧;         // inner claims at region level
    const label = ⟦self nameTextNear: thing⟧;          // null if none
    return { vtable: 'NamedThing', name: label?.dataset.string, inner: thing };
  },
  
  // nameTextNear: — claim an unconsumed Text element Near `thing`. Returns the
  // text's string on success, or null when none is near (optional ⇒ no fail).
  // Reuses the shared claim core, so the found text + its wrapper are consumed
  // and participate in pruning identically to vertex/edge claims.
  ['nameTextNear:']: (self, thing) =>
    send(self, 'claimFirst:', (elem) => {
            const { scope, consumed } = self.cursor;
            const savedCursor = self.cursor;
            self.cursor = { scope, consumed, dict: elem };
            let text = null;
            try { text = ⟦self applyRule: 'Label'⟧; }   // is elem a text element?
            catch (f) { if (f !== fail) throw f; }
            self.cursor = savedCursor;
            if (text === null) return null;
            return ⟦self isName: text for: thing⟧ ? { value: text } : null;
          },
          'onExhausted:', () => null,   // optional: null, not fail
          'piercing:', true, // Search for labels may pierce the opacity of claimed vertices
          'quickTest:', hasRule(self, 'LabelSel')
                          ? (e => e.matches(⟦self LabelSel⟧))
                          : null),

  // candidate is Near thing iff thing's boundary is within epsilon of the
  // candidate's closest point to thing. signedDistanceToPt: is <0 inside,
  // so `<= epsilon` also accepts a candidate point sitting inside thing.
  // TODO: reuse this for connectors, not just names?
  ['isNear:to:']: (self, candidate, thing) => {
    const sd = ⟦thing signedDistanceTo: candidate⟧; // order matters...!
    return 0 <= sd && sd <= ⟦self nameEpsilon⟧;
  },

  // Could a text in this notation also be a graph vertex? When false, a text
  // near a connector is unambiguously its name and no incidence test is needed.
  ['textsCanBeVertices']: () => false,

  // A name-text must be Near `thing` — and for CONNECTORS, must not be one of
  // the vertices at its endpoints (those positions host what it connects to).
  ['isName:for:']: (self, text, thing) => {
    if (!⟦self isNear: text to: thing⟧) return false;
    if (thing.matches('.connector-wrapper')
        && ⟦self textsCanBeVertices⟧
        && ⟦thing isIncidentOn: text⟧) return false;
    return true;
  },

  // ---- Near / epsilon: overridable proximity, locally quantifiable ---------
  // A context can override `epsilon` (or `Near:of:` wholesale) to tune snapping.
  ['nameEpsilon']:           () => 20,
  ['connectToShapeEpsilon']: () => 3,
  ['connectToTextEpsilon']:  () => 15,

  // Attachment tolerance depends on what's being attached to.
  ['epsilonFor:']: (self, elt) =>
    elt.classList.contains('text-wrapper') ? ⟦self connectToTextEpsilon⟧
                                           : ⟦self connectToShapeEpsilon⟧,

  // Contract vocabulary — the normalised DOM's own primitives, overridable.
  // (Default) Label = a text paragraph in Text Canonical Form
  ['LabelSel']: () => 'g.text-wrapper',
  ['Label']: (self) => {
    const elt = self.cursor.dict;
    ⟦self pred: elt.matches(⟦self LabelSel⟧)⟧;
    return elt;
  },

  ['ShapeSel']: () => '.boundary-shape',
  ['Shape']: (self) => {
    const elt = self.cursor.dict;
    ⟦self pred: elt.matches(⟦self ShapeSel⟧)⟧;
    return elt;
  },

  ['ConnectorSel']: () => 'g.connector-wrapper',
  ['Connector']:    (self) => {
    const elt = self.cursor.dict;
    ⟦self pred: elt.matches(⟦self ConnectorSel⟧)⟧;
    return elt;
  },

  // BoxShape = a rect in Closed Canonical Form (focus rule)
  ['BoxShapeSel']: () => 'rect.boundary-shape',
  ['BoxShape']: (self) => {
    const elt = self.cursor.dict;
    ⟦self pred: elt.matches(⟦self BoxShapeSel⟧)⟧;
    return elt;
  },

  // Box(inner) — claim a box shape, then parse its interior as a fresh region.
  // The claim prunes the box's subtree from the outer parse, so outer rules
  // can't see inside; the lend gives `inner` its own scope and consumed-set.
  ['Box:']: (self, inner) => {
    const box = ⟦self claimMatching: 'BoxShape'⟧;
    return ⟦self lend: self.vtable input: ⟦box interior⟧ rule: inner⟧;
  },

  // Graph(V,E) = E* V*
  ['GraphWithVertices:andEdges:']: (self, vertexRule, edgeRule) => {
    const es = ⟦self many: () => ⟦self applyClaiming: edgeRule⟧⟧; 
    const vs = ⟦self many: () => ⟦self applyClaiming: vertexRule⟧⟧;
    return { vtable: 'GraphObject',
             nodes: vs, edges: es,
             epsilonFor: e => ⟦self epsilonFor: e⟧ }; // HACK TODO inherit
  },

  // plain name ⇒ claim it (leaf classifier); thunk ⇒ trust it to claim itself
  ['applyClaiming:']: (self, designator) =>
    (typeof designator === 'function')
      ? designator(self)                       // Named(Box) — self-claiming
      : ⟦self claimMatching: designator⟧,      // 'Box' — wrap as leaf classifier

  // BiGraph(from, via, to) — edge-driven bipartite graph.
  // Claims every `via` connector; for each, resolves its origin against `from`
  // and its target against `to` by endpoint hit-test. Endpoints are REFERENCED,
  // not claimed: several edges may share a vertex, and `to` is typically
  // unscannable. Returns [{ edge, from, to }].
  ['BiGraphFrom:via:to:']: (self, fromRule, viaRule, toRule) => {
    const edges = ⟦self many: () => ⟦self applyClaiming: viaRule⟧⟧;
    return edges.map(e => {
      const [op, tp] = ⟦e endpoints⟧;
      return { edge: e,
               from: ⟦self elementAt: op matching: fromRule⟧,
               to:   ⟦self elementAt: tp matching: toRule⟧ };
    });
  },

  // The element within connectToShapeEpsilon of `pt` satisfying focus rule `rule`.
  // Does NOT claim. Skips consumed elements — which excludes the connectors
  // themselves (each sits at distance 0 from its own endpoints).
  ['elementAt:matching:']: (self, pt, rule) => {
    const selRule = (typeof rule === 'string') ? rule + 'Sel' : null;
    const sel = (selRule && hasRule(self, selRule)) ? ⟦self apply: selRule⟧ : '*';
    const saved = self.cursor;
    const hits = [];
    for (const c of saved.scope.querySelectorAll(sel)) {
      if (saved.consumed.has(c)) continue;
      if (⟦c signedDistanceToPt: pt⟧ > ⟦self epsilonFor: c⟧) continue;
      hits.push(c);
    }
    // Containment is treeified ⇒ the DEEPEST hit is the tightest one.
    hits.sort((a, b) => depthOf(b) - depthOf(a));
    for (const c of hits) {
      self.cursor = { scope: saved.scope, consumed: saved.consumed, dict: c };
      try { const v = ⟦self applyRule: rule⟧; self.cursor = saved; return v; }
      catch (f) { if (f !== fail) throw f; self.cursor = saved; }
    }
    return null;
  },

  // Any — matches whatever it's focused on. Narrowed by AnySel to contract
  // primitives, since '*' would hit <g>s that can't answer signedDistanceToPt:.
  ['AnySel']: () => '.boundary-shape, g.text-wrapper',
  ['Any']: (self) => self.cursor.dict,
};

// The runtime object the Graph combinator produces. Eager sets (nodes, edges)
// already bound; connection resolution is lazy per edge and cached. This is the
// "semantic face" of the notation — distinct from the grammar face above.
vtables['GraphObject'] = {
  ['nodeAt:']: (self, pt) => self.nodes.find(n =>
    ⟦n signedDistanceToPt: pt⟧ <= self.epsilonFor(n)) || null,

  ['connectionsOf:']: (self, edge) => {
    if (edge._connections) return edge._connections;
    edge._connections = ⟦edge endpoints⟧.map(pt => ⟦self nodeAt: pt⟧);
    return edge._connections;
  },
};

// Node / edge wrappers: forward unknown messages (vertices, endpoints,
// signedDistanceToPt:, ...) to the wrapped DOM element.
vtables['GraphNode'] = {
  ['doesNotUnderstand:']: (self, [sel, ...args]) => sendNoKw(self.dom, sel, ...args),
};
vtables['GraphEdge'] = {
  ['doesNotUnderstand:']: (self, [sel, ...args]) => sendNoKw(self.dom, sel, ...args),
};

// NamedThing: a decorated node/edge carrying an optional name. Answers `name`;
// forwards everything else to the inner thing (which itself forwards to its DOM).
vtables['NamedThing'] = {
  ['name']: (self) => self.name,
  ['doesNotUnderstand:']: (self, [sel, ...args]) => sendNoKw(self.inner, sel, ...args),
};

// ── RegionDispatchNotation ───────────────────────────────────────────────────
// Top-level boxes only — the claim-descent prunes each claimed box's subtree.
//   rd = match(vtables.RegionDispatchNotation, svg_root, 'Root')
vtables.RegionDispatchNotation = {
  _parent: vtables.NotationGrammar,

  // Root = Named(Box)+
  ['Root']: (self) => ⟦self many1: () => ⟦self Named: 'Box'⟧⟧,

  // Box = a closed shape in Closed Canonical Form. TODO: redundant?
  ['BoxSel']: (self) => 'rect.boundary-shape',
  ['Box']: (self) => {
    const elt = self.cursor.dict;
    ⟦self pred: elt.matches(⟦self BoxSel⟧)⟧;
    return elt;
  },
};

// BoxGraph (OmniMeta version)
//   bg = match(vtables.BoxGraphOM, regionElt, 'Root')
vtables.BoxGraphOM = {
  _parent: vtables.NotationGrammar,

  // notation: boxes (optionally named) as vertices, arrows (optionally named)
  // as edges. Named(_) is passed as a thunk designator so it decorates at the
  // region level (its name-search needs the region cursor, not a candidate focus).
  // BoxGraph = Graph(Named(Box), Named(Arrow))
  ['BoxGraph']: (self) => ⟦self GraphWithVertices: (self) => ⟦self Named: 'Box'⟧
                                andEdges: (self) => ⟦self Named: 'Arrow'⟧⟧,

  // Mathcha vocabulary leaves (run on a transient candidate focus: self.cursor.dict).

  // Box = <rect>
  ['Box']: (self) => {
    const elt = self.cursor.dict;
    ⟦self pred: elt.tagName === 'rect' && elt.style.stroke === 'rgb(0, 0, 0)'⟧; // TEMP black only
    return { vtable: 'GraphNode', dom: elt };
  },

  // Arrow = <polyline|line> | <path> which isClosed, !isArrowhead
  ['Arrow']: (self) => {
    const elt = self.cursor.dict;
    ⟦self pred: ['polyline','line'].includes(elt.tagName)
              || (elt.tagName === 'path' && !⟦elt isClosed⟧ && !⟦elt isArrowhead⟧)⟧;
    return { vtable: 'GraphEdge', dom: elt };
  },

  ['Label']: (self) => {
    const elt = self.cursor.dict;
    ⟦self pred: elt.matches(ALL_LABELS)⟧; // TODO inline constant from main-engine
    return elt;
  },
};

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
  //                 | shaft:s                     => ⟦s endpoints⟧
  ['endpoints']: (self) => ⟦self or: [
    () => {
      const t = ⟦self lookahead: () => ⟦self apply: 'targetPt'⟧⟧;
      const o = ⟦self lookahead: () => ⟦self apply: 'originPt'⟧⟧;
      return [o, t];
    },
    () => {
      const h1 = ⟦self apply: 'head'⟧;
      const h2 = ⟦self apply: 'head'⟧;
      ⟦self not: () => ⟦self apply: 'head'⟧⟧;
      return [h1.tip, h2.tip];
    },
    () => {
      const s = ⟦self apply: 'shaft'⟧;
      return ⟦s endpoints⟧;
    },
  ]⟧,
 
  // arrow targetPt = head:h ~head => h.tip
  ['targetPt']: (self) => {
    const h = ⟦self apply: 'head'⟧;
    ⟦self not: () => ⟦self apply: 'head'⟧⟧;
    return h.tip;
  },
 
  // arrow targetPt: t = head:h ~head shaft:s
  //   ⟹ ⟦s orientWith: h⟧  -- the explicit symmetry-breaking step
  //      ⟦s target: t⟧      -- moves the appropriate DOM endpoint
  //      ⟦h touch: t⟧       -- moves the head's tip to the new target
  //      ⟦h lookAlong: ⟦s outwardTangentAtTarget⟧⟧  -- head aims away from shaft body
  ['targetPt:']: (self, t) => {
    const h = ⟦self apply: 'head'⟧;
    ⟦self not: () => ⟦self apply: 'head'⟧⟧;
    const s = ⟦self apply: 'shaft'⟧;
    ⟦s orientWith: h⟧;
    ⟦s target: t⟧;
    ⟦h touch: t⟧;
    ⟦h lookAlong: ⟦s outwardTangentAtTarget⟧⟧;
  },
 
  // arrow originPt = head:h ~head shaft:s  ⟹ ⟦s orientWith: h⟧; ⟦s origin⟧
  ['originPt']: (self) => {
    const h = ⟦self apply: 'head'⟧;
    ⟦self not: () => ⟦self apply: 'head'⟧⟧;
    const s = ⟦self apply: 'shaft'⟧;
    ⟦s orientWith: h⟧;
    return ⟦s origin⟧;
  },
 
  // arrow originPt: o = head:h ~head shaft:s
  //   ⟹ ⟦s orientWith: h⟧
  //      ⟦s origin: o⟧
  //      ⟦h lookAlong: vsub(h.tip, o)⟧   -- head's tip unchanged; only its angle.
  ['originPt:']: (self, o) => {
    const h = ⟦self apply: 'head'⟧;
    ⟦self not: () => ⟦self apply: 'head'⟧⟧;
    const s = ⟦self apply: 'shaft'⟧;
    ⟦s orientWith: h⟧;
    ⟦s origin: o⟧;
    ⟦h lookAlong: ⟦s outwardTangentAtTarget⟧⟧;
  },
};

// ── MathchaArrow: the adapter ────────────────────────────────────────────────
vtables.MathchaArrow = {
  _parent: vtables.HeadShaftArrow,

  ['head']:  (self) => ⟦self apply: 'childMatching:inGrammar:' with: ['head',  vtables.MathchaHeadShaftRules]⟧,
  ['shaft']: (self) => ⟦self apply: 'childMatching:inGrammar:' with: ['shaft', vtables.MathchaHeadShaftRules]⟧,
};

// ── MathchaHeadShaftRules: per-element classifiers ───────────────────────────
vtables.MathchaHeadShaftRules = {
  _parent: vtables.DOMMeta,

  // mathcha head = g transform=(col:back col:left col:tip)
  //                => {fwd: neg(back), tip: tip}
  ['head']: (self) => {
    const elt = self.cursor.dict;
    ⟦self pred: elt.tagName === 'g'⟧;
    ⟦self pred: elt.transform?.baseVal?.numberOfItems > 0⟧;
    const m    = elt.transform.baseVal[0].matrix;
    const back = [m.a, m.b];
    const tip  = [m.e, m.f];
    return { vtable: vtables.MathchaArrowhead, elt, tip, fwd: neg(back) };
  },

  // mathcha shaft = (path|polyline|line) .connection .real
  ['shaft']: (self) => {
    const elt = self.cursor.dict;
    const cl = elt.classList;
    ⟦self pred: ['path','polyline','line'].includes(elt.tagName)⟧;
    ⟦self pred: cl.contains('connection') && cl.contains('real')⟧;
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
    const e0 = ⟦self endpointAt: 0⟧;
    const e1 = ⟦self endpointAt: 1⟧;
    self.targetIdx = dist2(e0, arrowhead.tip) < dist2(e1, arrowhead.tip) ? 0 : 1;
    self.originIdx = 1 - self.targetIdx;
    return self;
  },
 
  // — oriented getters & setters (require orientWith: first) —
  ['origin']:                 (self)     => ⟦self endpointAt: self.originIdx⟧,
  ['target']:                 (self)     => ⟦self endpointAt: self.targetIdx⟧,
  ['origin:']:                (self, pt) => ⟦self endpointAt: self.originIdx put: pt⟧,
  ['target:']:                (self, pt) => ⟦self endpointAt: self.targetIdx put: pt⟧,
  ['outwardTangentAtOrigin']: (self)     => ⟦self outwardTangentAt: self.originIdx⟧,
  ['outwardTangentAtTarget']: (self)     => ⟦self outwardTangentAt: self.targetIdx⟧,
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
    ⟦self pred: elt.tagName === 'path'⟧;
    const d = ⟦self apply: 'key:' with: ['d']⟧;
    return ⟦self lend: vtables.PowerpointArrowPath input: d rule: 'arrow'⟧;
  },

  ['originPt']: (self) => { const [from, to] = ⟦self endpoints⟧; return from; },
  ['targetPt']: (self) => { const [from, to] = ⟦self endpoints⟧; return to; },
  ['isDirected']: () => true, // FOR NOW...
};

// ── PowerpointArrowPath: the literal PP arrow path-data pattern ──────────────
vtables.PowerpointArrowPath = {
  _parent: vtables.PathDataGrammar,

  // arrow = M b1 (L? _)* L? b2 Z M _ L? tip ... ⟹ { from: (b1 ~ b2), to: tip }
  // Have to cope with both implicit and explicit L's:
  // implicit is straight from PPT, paths without transform
  // explicit comes from baking transform into the path
  ['arrow']: (self) => {
    ⟦self apply: 'cmd:' with: ['M']⟧;
    const b1 = ⟦self apply: 'point'⟧;

    // `_*` — skip points, stopping at the LAST one before Z.
    // A plain `point*` here would be WRONG: PEG repetition is possessive, so it
    // would swallow b2 as well and the following `point:b2` could never match
    // (no backtracking into a `*`). The `~(point Z)` lookahead is exactly what
    // makes "stop just before the closing point" expressible — your instinct
    // that lookahead was necessary is right, and this is why.
    ⟦self many: () => {
      ⟦self not: () => { 
        ⟦self opt: () => ⟦self apply: 'cmd:' with: ['L']⟧⟧;
        ⟦self apply: 'point'⟧;
        ⟦self apply: 'cmd:' with: ['Z']⟧;
      }⟧;
      ⟦self opt: () => ⟦self apply: 'cmd:' with: ['L']⟧⟧;
      ⟦self apply: 'point'⟧;
    }⟧;

    ⟦self opt: () => ⟦self apply: 'cmd:' with: ['L']⟧⟧;
    const b2 = ⟦self apply: 'point'⟧;
    ⟦self apply: 'cmd:' with: ['Z']⟧;
    ⟦self apply: 'cmd:' with: ['M']⟧;
    ⟦self apply: 'point'⟧;
    ⟦self opt: () => ⟦self apply: 'cmd:' with: ['L']⟧⟧;
    const tip = ⟦self apply: 'point'⟧;
    // `...` — remainder deliberately unmatched; we just stop here.

    return [vmid(b1, b2), tip];
  },
};

vtables.AffinityArrowPath = {
  _parent: vtables.PathDataGrammar,

  // M b1 L tip L b2 ... => target=tip, tangent = unit(tip - (b1 ~ b2))
  ['head']: (self) => {
    ⟦self apply: 'cmd:', with: ['M']⟧;
    const b1 = ⟦self apply: 'point'⟧;
    ⟦self apply: 'cmd:', with: ['L']⟧;
    const tip = ⟦self apply: 'point'⟧;
    ⟦self apply: 'cmd:', with: ['L']⟧;
    const b2 = ⟦self apply: 'point'⟧;
    return { headTip: tip, headTangent: vnormed(vsub(tip, vmid(b1, b2))) };
  },

  // M start L end => origin=start, tangent = unit(start - end)
  ['shaft']: (self) => {
    ⟦self apply: 'cmd:', with: ['M']⟧;
    const start = ⟦self apply: 'point'⟧;
    ⟦self apply: 'cmd:', with: ['L']⟧;
    const end = ⟦self apply: 'point'⟧;
    return { shaftOrigin: start, originTangent: vnormed(vsub(start,end)) };
  },
}

vtables.MathchaVocab = {
  /*
  // 2. TEXT RECOGNITION — must SET dataset.string and add .is-paragraph
  //    (+ .is-multiline). Everything downstream reads those, so each editor's
  //    version only has to produce them from its own nesting shape.
  ['parseTextElt:']: (self, g) => ⟦g parseAsParagraph⟧,   // Mathcha: g/g/g/text

  // 3. ARROWHEAD TEST — "is this path part of an arrow's head, not a shaft?"
  ['isArrowhead:']: (self, elt) => elt.parentElement.tagName === 'g'
                    && elt.parentElement.parentElement.classList.contains('arrow-line'),

  // 4. CONNECTOR TEST — "is this an edge-ish element?"
  ['isConnector:']: (self, elt) => elt.classList.contains('connection')
                                && elt.classList.contains('real'),

  // 5. ARROW GRAMMAR — which OmniMeta arrow notation reads this editor's arrows.
  //    (Already built for all three editors — this is just the selector.)
  ['arrowGrammar']: (self) => vtables.MathchaArrow,
  */

  ['init']: () => {
    // Pre-process Mathcha SVG into a sane structure
    all('g.composite-shape').forEach(g => {
      g.classList.remove('composite-shape');
      g.classList.add('boundary-wrapper');
      g.appendChild(svgel('g', {class: 'shape-interior'}));
      const shape = g.querySelector('.real');
      if (shape) {
        shape.classList.remove('real');
        shape.classList.add('boundary-shape');
      }
    });
    all('.connection.real').forEach(e => {
      e.classList.remove('connection');
      e.classList.remove('real');
      e.classList.add('connector-shaft');
    })
    all('g.arrow-line').forEach(g => {
      g.classList.remove('arrow-line');
      g.classList.add('connector-wrapper');
      const head = g.querySelector('g');
      if (head) {
        //⟦head bakeStyles⟧;
        // TODO: connector-head
      }
    });
    all('g').forEach((self) => {
      if (self.children.length === 0) return false;
      for (let child of self.children) {
        if (child.tagName !== 'g') return false;
        for (let gchild of child.children) {
          if (gchild.tagName !== 'g') return false;
          if (gchild.firstChild.tagName !== 'text') return false;
        }
      }
      // TODO: maybe sanity check they're in y-order
      const lines = Array.from(self.children).map(line_g => {
        const runs = Array.from(line_g.children).map(run_g =>
          run_g.firstChild.textContent
        );
        return runs.join('');
      });
      self.dataset.string = lines.join('\n');
      if (self.children.length > 1) self.classList.add('is-multiline');
      self.classList.add('text-wrapper');
      return true;
    });
  },
  ['seedElements']: (self) => all('.boundary-shape, .connector-shaft, .text-wrapper'),
};

vtables.AffinityVocab = {
  ['init']: () => {
    // Pre-process AD SVG into a sane structure
    // Remove empty group <rect>s
    let rects = all('rect');
    rects.filter(r =>
      ['', 'none'].includes(r.style.stroke) && ['','none'].includes(r.style.fill)
    ).forEach(r => r.remove());
    // Remove useless empty <g>s
    let gs = all('g');
    gs.filter(g => g.children.length === 0).forEach(g => g.remove());
    // Put everything in absolute coords
    let transformeds = all('[transform]')
    transformeds.forEach(t => {
      ⟦t simplifyTransform⟧;
      ⟦t pushTransformToDescendants⟧;
    });
    // Unwrap all groups containing <rects> (later: closed shapes)
    gs = all('g > rect').map(e => e.parentElement);
    gs.forEach(g => g.replaceWith(...g.childNodes));
    // Now wrap each naked single-line <text> in a <g>
    let texts = all('svg > text');
    texts.forEach(t => {
      const g = svgel('g');
      t.replaceWith(g);
      g.appendChild(t);
    });
    // Now tag paragraphs appropriately (heuristically distinguish from other <g>s...)
    // and extract their strings
    gs = all('g');
    gs.filter(g => g.querySelector('text') && !g.querySelector('path, rect'))
      .forEach(g => {
        g.classList.add('text-wrapper');
        const texts = [...g.children].filter(c => c.tagName === 'text');
        if (texts.length > 1) {
          g.classList.add('is-multiline');
          g.dataset.string = texts.map(t => t.textContent).join('\n');
        } else g.dataset.string = texts[0].textContent;
    });
    // Now wrap each <rect> in a <g>
    rects = all('rect');
    rects.forEach(r => {
      const g = svgel('g', {class: 'boundary-wrapper'});
      r.replaceWith(g);
      g.appendChild(r);
      g.appendChild(svgel('g', {class: 'shape-interior'}));
      r.classList.add('boundary-shape');
    });
    // Now pair up all the arrowhead/shaft path pairs
    let paths = all('path');
    let pairs = [];
    for (let i=0; i<paths.length; i+=2) pairs.push([paths[i], paths[i+1]]);
    pairs.forEach(([p1,p2]) => {
      const g = svgel('g', {class: 'connector-wrapper'});
      p1.replaceWith(g);
      g.appendChild(p1); p1.classList.add('connector-head')
      const {headTip, headTangent} = match(vtables.AffinityArrowPath, attr(p1, 'd'), 'head');
      g.dataset.targetPt = legible(...headTip);
      g.dataset.targetOut = legible(...headTangent);
      g.appendChild(p2); p2.classList.add('connector-shaft');
      const {shaftOrigin, originTangent} = match(vtables.AffinityArrowPath, attr(p2, 'd'), 'shaft');
      g.dataset.originPt = legible(...shaftOrigin);
      g.dataset.originOut = legible(...originTangent);
    });
  },
  ['seedElements']: (self) => all('path, .boundary-shape, .text-wrapper'),
};

vtables.PowerpointVocab = {
  ['init']: () => {
    // Pre-process PPT into a sane structure
    // First, kill the clip <g> and <defs> with clipPath
    const clipG = some('g[clip-path');
    clipG.replaceWith(...clipG.childNodes);
    some('defs').remove();
    // For some reason, <text>s use transform attr instead of x/y. Must bake
    let texts = all('text');
    texts.forEach(t => {
      ⟦t simplifyTransform⟧;
      ⟦t bakeTransform⟧;
    });
    // Next: incredibly, I see a hyphenated line (A - B) rendered as
    // <text>A</text> <text>-</text> <text>B</text>
    // So: recognise consecutive runs of <texts>, group them into a paragraph
    // Also, recognise close-enough lines and add them to the para group
    restitchTextBackTogether = function(initialText) {
      let textElt = initialText;
      let lineBbox = textElt.getBBox();
      // Begin the paragraph <g>
      let paraG = svgel('g', {class: 'text-wrapper'});
      textElt.replaceWith(paraG);
      paraG.appendChild(textElt);
      let paraBbox = paraG.getBBox();
      const strings = [textElt.textContent];
      textElt = paraG.nextSibling;
      while (textElt?.tagName === 'text') {
        let nextBbox = textElt.getBBox();
        const { height } = lineBbox;
        const isSameLine = Math.abs(lineBbox.y - nextBbox.y) < height/2
          && (lineBbox.x+lineBbox.width) + height/2 > nextBbox.x;
        const isNewLine = (lineBbox.y + lineBbox.height) < nextBbox.y
          && (lineBbox.y+lineBbox.height) + height > nextBbox.y
          && paraBbox.x <= nextBbox.x && nextBbox.x <= (paraBbox.x+paraBbox.width);
        if (isSameLine) {
          paraG.appendChild(textElt);
          strings.push(' ' + textElt.textContent);
          lineBbox.width = nextBbox.x - lineBbox.x + nextBbox.width;
          lineBbox.height = Math.max(lineBbox.height, nextBbox.height);
          paraBbox = paraG.getBBox();
        } else if (isNewLine) {
          paraG.appendChild(textElt);
          strings.push('\n' + textElt.textContent);
          paraG.classList.add('is-multiline');
          lineBbox = nextBbox;
          paraBbox = paraG.getBBox();
        } else break;
        textElt = paraG.nextSibling;
      }
      paraG.dataset.string = strings.join('');
    }
    let text = some(':not(g) > text');
    while (text) {
      // Rewind to the first in the run, if necessary
      while (text.previousSibling?.tagName === 'text') text = text.previousSibling;
      restitchTextBackTogether(text);
      text = some(':not(g) > text');
    }
    // Now wrap each <rect> in a <g>
    let rects = all('rect');
    rects.forEach(r => {
      const g = svgel('g', {class: 'boundary-wrapper'});
      r.replaceWith(g);
      g.appendChild(r);
      g.appendChild(svgel('g', {class: 'shape-interior'}));
      r.classList.add('boundary-shape');
    });
    // Paths+rects, like texts, may have transforms to bake
    let elts = all(':not(g)[transform]');
    elts.forEach(e => {
      ⟦e simplifyTransform⟧;
      ⟦e bakeTransform⟧;
    });
    // Now wrap paths, tagging arrows as cued by magic colours
    let paths = all('path');
    paths.filter(p => ['#C00000','#385723'].includes(attr(p, 'fill')))
      .forEach(p => {
        let specialized = ⟦p specialize⟧;
        let g = specialized?.tagName === 'g' ? specialized : svgel('g');
        // If specialising broke it into a group of shapes, tag the group
        const isArrow = specialized?.tagName !== 'ellipse';
        if (specialized === null) specialized = p;
        if (specialized !== g && specialized.parentElement !== g) {
          specialized.replaceWith(g);
          g.appendChild(specialized);
        }
        if (isArrow) {
          g.classList.add('connector-wrapper');
          // Parse the *original* <path> for the endpoints
          const [originPt, targetPt] = match(vtables.PowerpointArrow, p, 'endpoints');
          g.dataset.originPt = legible(...originPt);
          g.dataset.targetPt = legible(...targetPt);
          // Heuristically tag head/shaft - works so far
          for (let c of [...g.children]) {
            if (c.tagName === 'polygon') {
              const vs = ⟦c vertices⟧;
              if (vs.length === 3) {
                c.classList.add('connector-head');
                const [b1, tip, b2] = vs;
                const targetTangent = vnormed(vsub(tip, vmid(b1, b2)));
                g.dataset.targetOut = legible(...targetTangent);
              } else {
                c.classList.add('connector-shaft');
                const [v1, v2] = vs;
                const originTangent = vnormed(vsub(v1, v2));
                g.dataset.originOut = legible(...originTangent);
              }
            } else {
              c.classList.add('connector-shaft'); // SMELL: Embedded head in this case
              const targetTangent = vnormed(vsub(targetPt, originPt));
              const originTangent = neg(targetTangent);
              g.dataset.originOut = legible(...originTangent);
              g.dataset.targetOut = legible(...targetTangent);
            }
          }
        } else {
          g.classList.add('boundary-wrapper');
          specialized.classList.add('boundary-shape');
        }
    });
    // Now wrap remaining paths in a <g>
    paths = all(':not(g) > path');
    paths.forEach(p => {
      const g = svgel('g', {class: 'boundary-wrapper'});
      p.replaceWith(g);
      g.appendChild(p);
      p.classList.add('boundary-shape');
      g.appendChild(svgel('g', {class: 'shape-interior'}));
    });
  },
  ['seedElements']: (self) => all('path, polygon, .boundary-shape, .text-wrapper'),
};