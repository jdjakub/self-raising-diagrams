# CLAUDE.md

## What this is
Augmented Diagrams / Vector Vision Engine (VVE): SVG diagrams drawn in ordinary
editors (mainly Mathcha.io; also Affinity Designer, PowerPoint exports) are
parsed according to visual syntax rules and treated as a graphical analogue of
source code. Static diagrams are parsed, then macro-expanded, compiled or
interpreted. Self-raising diagrams bootstrap themselves into an interactive app
when opened in a browser. See PRINCIPLES.md for the ideas; ARCHITECTURE.md for
the implementation map.

## How Joel works with you
- Joel does not read the code. He specifies features at the level of ideas and
  tests the results by hand in Firefox. Explain changes in terms of behaviour
  and architecture, not code.
- For anything non-trivial, propose a plan first and wait for approval. Flag
  any plan step that touches a hard requirement (below) or changes architecture.
- Keep ARCHITECTURE.md current as part of every change that alters structure.
  It is how future sessions (and Joel) recover the map.
- Run the regression suite before declaring a task done (see Testing).
- Prose: concise, British spelling. Code: American spelling.

## Hard requirements (never trade away)
1. **Console messaging.** In the Firefox console, Joel selects an element and
   types e.g. `send($0, 'containsPt:', [10, 20])` to send it messages defined
   in our vtables, bypassing the native DOM API. `send`, `sendNoKw` and the
   vtable dispatch must stay global and must work on raw DOM elements. Do not
   replace this with native JS classes, prototypes on DOM interfaces, or
   anything that clashes with native DOM behaviour.
2. **The document is the ground truth.** Any state affecting a diagram's
   meaning lives in the SVG document; JS objects are projections/caches.
   Distinguish pure caches (derivable from geometry; may live JS-side) from
   semantic state such as user overrides (must be persisted to the DOM as
   annotations). Never use DOM annotations for both purposes indistinguishably.
   For self-raising diagrams, meaning-affecting JS state mirrors to the DOM at
   commit points; reloading the SVG must restore exactly what the user had.
3. **Capture queries before mutating.** When code both queries and mutates the
   document, capture the query results first and use the captured values.
4. **Schemas, not examples.** The engine ingests rewrite rules stated with
   meta-variables. Concrete before/after diagrams are documentation for humans.
   Never propose having the engine induce rules from examples
   (programming-by-example is out of scope).
5. **Works over `file://`.** No web server, no bundler required at runtime.
   SVGs load scripts via `<script href="...">`.

## JSTalk
`*.jstalk.js` files are JS plus Smalltalk-style sends:
`⟦recv sel: a with: b⟧` → `send(recv, 'sel:', a, 'with:', b)`;
unary `⟦recv foo⟧` → `send(recv, 'foo')`; `⟦super sel: a⟧` → `supr('sel:', a)`.
Methods that super-send are wrapped in `needsSuper(...)` and take `supr` as
their first parameter.
- Where a `.jstalk.js` exists, edit only it, never the generated `.js`. Then
  run `./compile-jstalk` (no arguments) and commit both files.
- `compile-jstalk` hardcodes its file list. When adding a new `.jstalk.js`,
  add a matching line to it.
- Files with no `.jstalk.js` counterpart (e.g. `utils.js`, `lang-*.js`,
  `bracket-hole-carving.js`) are plain JS; edit directly.
- LF line endings everywhere (enforced by `.gitattributes`); never write CRLF.

## Conventions
- Vtables: uppercase names; `_parent` chains for inheritance; DOM elements
  dispatch via `vtables.byTag[tagName]`. Instances are built by sending
  constructor messages to objects with explicit vtable fields.
- Rule/selector names in Smalltalk keyword style (`Before:After:`). `Root` is
  the start rule in every notation vtable.
- Return raw elements; add wrapper objects only when they add a message.
- Wrap every number written to an SVG attribute in `legible()`.
- `{[` / `]}` delimit JS holes in SweetTalk.
- Substantial functions get a usage-oriented doc comment in perceptual/user
  terms; don't expose internal parameters to callers.
- Code meant for pasting into the browser console (examples in comments,
  debugging snippets) uses compiled JS (no JSTalk) and bare top-level
  assignments (no `const`/`let`/`var`), so it can be re-pasted.

## Repo map
- `main-engine.jstalk.js`: dispatch (`send` etc.), core vtables, pipeline.
  (Formerly `general-containment`.)
- `omnimeta.jstalk.js`: OmniMeta, the substrate-neutral OMeta for DOM/vector
  matching.
- `utils.js`: geometry and DOM helpers.
- `lang-sweettalk.js`, `lang-descartes.js`, `*.ometa*`, `bracket-hole-carving.js`:
  the textual DSL stack.
- `TomasNotations/`, `CamilleNotations/`: notations and apps by collaborators
  (checkers, cars, animation). Treat their SVGs as test fixtures.
- `principles/`: diagrams illustrating the core parsing principles.
- `old-approaches/`: archive. Read for history only; do not modify.
- `JSTalk/`: transpiler (`jstalk2js.pl`) and VS Code extension.
- `issues.txt`: Joel's own issue/idea log. `README.md` is stale (describes
  `old-approaches`); don't trust it as current.

## Testing
TODO: headless snapshot harness (Playwright + Firefox over `file://`): load each
example SVG, run its pipeline, serialise the resulting document, diff against
committed snapshots. Firefox rendering is the ground truth; screenshots
can supplement snapshot diffs for visual cases.
