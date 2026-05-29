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
      const before = send(self, 'cursorKey:', self.cursor);
      let v;
      try { v = thunk(); }
      catch (f) { if (f !== fail) throw f; break; }   // normal end of repetition
      // Consumption-implies-progress: a successful iteration that didn't advance
      // the cursor would loop forever. The cursor-key guard is the generic,
      // substrate-neutral termination net.
      if (send(self, 'cursorKey:', self.cursor) === before)
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
    const r = match(grammar, input, rule);
    if (r === MATCH_FAILED) throw fail;
    return r;
  },
  ['lend:input:rule:with:']: (self, grammar, input, rule, args) => {
    const r = match(grammar, input, rule, args);
    if (r === MATCH_FAILED) throw fail;
    return r;
  },
};

// ── Entry point ──────────────────────────────────────────────────────────────
match = function(grammar, input, startRule, args) {
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
// (letter, spaces, token, fromTo, ... also belong here — same cursor.)
vtables.CharGrammar = {
  _parent: vtables.SeqSubstrate,

  ['digit']: (self) => {
    const r = send(self, 'apply:', 'anything');
    send(self, 'pred:', typeof r === 'string' && r >= '0' && r <= '9');
    return r;
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