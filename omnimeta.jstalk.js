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
      const before = ⟦self cursorKey: self.cursor⟧;
      let v;
      try { v = thunk(); }
      catch (f) { if (f !== fail) throw f; break; }   // normal end of repetition
      // Consumption-implies-progress: a successful iteration that didn't advance
      // the cursor would loop forever. The cursor-key guard is the generic,
      // substrate-neutral termination net.
      if (⟦self cursorKey: self.cursor⟧ === before)
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
};

// ── CharGrammar: character-specific matchers on SeqSubstrate ─────────────────
// (letter, spaces, token, fromTo, ... also belong here — same cursor.)
vtables.CharGrammar = {
  _parent: vtables.SeqSubstrate,

  ['digit']: (self) => {
    const r = ⟦self apply: 'anything'⟧;
    ⟦self pred: typeof r === 'string' && r >= '0' && r <= '9'⟧;
    return r;
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

// ── AbstractArrow ────────────────────────────────────────────────────────────
// Abstract grammar over a <g>'s children-as-multiset. Leaves `head` and `shaft`
// abstract; concrete grammars override. The endpoints rule uses the
// classify-then-project pattern we settled on: targetPt/originPt are
// inspections (under `lookahead:`) that share one classification of the head,
// so the original sketch's structure is preserved exactly.
vtables.AbstractArrow = {
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

  // arrow originPt = head:h ~head shaft:s => {
  //   const eps = ⟦s endpoints⟧;
  //   const ds  = eps.map(p => |p - h.tip|);
  //   return eps[ds[0] < ds[1] ? 1 : 0];   // the path-endpoint FARTHER from h.tip
  // }
  ['originPt']: (self) => {
    const h   = ⟦self apply: 'head'⟧;
    ⟦self not: () => ⟦self apply: 'head'⟧⟧;
    const s   = ⟦self apply: 'shaft'⟧;
    const eps = ⟦s endpoints⟧;
    return dist2(eps[0], h.tip) < dist2(eps[1], h.tip) ? eps[1] : eps[0];
  },
};

// ── MathchaArrow: the adapter ────────────────────────────────────────────────
vtables.MathchaArrow = {
  _parent: vtables.AbstractArrow,

  ['head']:  (self) => ⟦self apply: 'childMatching:inGrammar:'
                             with: ['head',  vtables.MathchaHeadShaftRules]⟧,
  ['shaft']: (self) => ⟦self apply: 'childMatching:inGrammar:'
                             with: ['shaft', vtables.MathchaHeadShaftRules]⟧,
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
    return { tip, fwd: neg(back) };
  },

  // mathcha shaft = path .connection .real
  // (Returns the element itself; `endpoints` is answered by byTag['path']
  // and inherited automatically by polyline/line/polygon shafts.)
  ['shaft']: (self) => {
    const elt = self.cursor.dict;
    const cl = elt.classList;
    ⟦self pred: ['path','polyline','line'].includes(elt.tagName)⟧;
    ⟦self pred: cl.contains('connection') && cl.contains('real')⟧;
    return elt;
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