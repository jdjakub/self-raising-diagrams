# AGENTS.md (CLAUDE.md is a symlink to this file)

## What this is
Augmented Diagrams / Vector Vision Engine (VVE): SVG diagrams drawn in ordinary editors (mainly Mathcha.io; also Affinity Designer, PowerPoint exports) are parsed according to visual syntax rules and treated as a graphical analogue of source code. Static diagrams are parsed, then macro-expanded, compiled or interpreted. Self-raising diagrams bootstrap themselves into an interactive app when opened in a browser. See PRINCIPLES.md for the ideas; ARCHITECTURE.md for the implementation map.

## How Joel works with you
- Joel does not read the code. He specifies features at the level of ideas and tests the results by hand in Firefox. Explain changes in terms of behaviour and architecture, not code.
- For anything non-trivial, propose a plan first and wait for approval. Flag any plan step that touches a hard requirement (below) or changes architecture.
- Keep ARCHITECTURE.md current as part of every change that alters structure. It is how future sessions (and Joel) recover the map.
- Run the regression suite before declaring a task done (see Testing). There is none yet; until there is, say so when reporting, and list exactly what Joel should check by hand in Firefox.
- Prose: concise, British spelling. Code: American spelling.
- Text docs (Markdown, notes): never hard-wrap lines. Joel reads in variable-width windows, so each paragraph or list item is one long line that the viewer soft-wraps. Line breaks are only for structure (headings, list items, table rows, blank lines between paragraphs) and inside code blocks, where formatting matters.

## Hard requirements (never trade away)
1. **Console messaging.** In the Firefox console, Joel selects an element and types e.g. `send($0, 'containsPt:', [10, 20])` to send it messages defined in our vtables, bypassing the native DOM API. `send`, `sendNoKw` and the vtable dispatch must stay global and must work on raw DOM elements. Do not replace this with native JS classes, prototypes on DOM interfaces, or anything that clashes with native DOM behaviour. Known gap: only tags with a `vtables.byTag` entry dispatch (`path polyline line polygon rect ellipse circle text tspan g`); `send` on any other element (`<svg>`, `<defs>`, ...) currently crashes with a TypeError instead of `doesNotUnderstand:`.
2. **The document is the ground truth.** Any state affecting a diagram's meaning lives in the SVG document; JS objects are projections/caches. Distinguish pure caches (derivable from geometry; may live JS-side) from semantic state such as user overrides (must be persisted to the DOM as annotations). Never use DOM annotations for both purposes indistinguishably. For self-raising diagrams, meaning-affecting JS state mirrors to the DOM at commit points; reloading the SVG must restore exactly what the user had.
3. **Capture queries before mutating.** When code both queries and mutates the document, capture the query results first and use the captured values.
4. **Schemas, not examples.** The engine ingests rewrite rules stated with meta-variables. Concrete before/after diagrams are documentation for humans. Never propose having the engine induce rules from examples (programming-by-example is out of scope).
5. **Works over `file://`.** No web server, no bundler required at runtime. SVGs load scripts via `<script href="...">`. Known gap (unverified): the HTML apps in `TomasNotations/*App/` read an iframe's `contentDocument`, which Firefox probably blocks over `file://`.

## JSTalk
`*.jstalk.js` files are JS plus Smalltalk-style sends: `⟦recv sel: a with: b⟧` → `send(recv, 'sel:', a, 'with:', b)`; unary `⟦recv foo⟧` → `send(recv, 'foo')`; `⟦super sel: a⟧` → `supr('sel:', a)`. Methods that super-send are wrapped in `needsSuper(...)` and take `supr` as their first parameter.
- Where a `.jstalk.js` exists, edit only it, never the generated `.js`. Then run `./compile-jstalk` (no arguments) and commit both files.
- `compile-jstalk` hardcodes its file list. When adding a new `.jstalk.js`, add a matching line to it.
- Files with no `.jstalk.js` counterpart (e.g. `utils.js`, `lang-*.js`, `bracket-hole-carving.js`, `boxGraph-bootstrap.js`, `svgEdit.js`, and the app `.js` files under `TomasNotations/*App/`) are plain JS; edit directly.
- LF line endings everywhere (enforced by `.gitattributes`); never write CRLF.

## Conventions
- Vtables: uppercase names; `_parent` chains for inheritance; DOM elements dispatch via `vtables.byTag[tagName]`. Instances are built by sending constructor messages to objects with explicit vtable fields.
- Rule/selector names in Smalltalk keyword style (`Before:After:`). In OmniMeta notations, `Root` is the default start rule (`NotationGrammar`'s `fromRegion:` matches it). Not every notation has one yet: BoardGameNotation overrides `fromRegion:`, and BoxGraphOM's top rule is `BoxGraph`.
- Return raw elements; add wrapper objects only when they add a message.
- Wrap every number written to an SVG attribute in `legible()`.
- `{[` / `]}` delimit JS holes in SweetTalk.
- Substantial functions get a usage-oriented doc comment in perceptual/user terms; don't expose internal parameters to callers.
- Code meant for pasting into the browser console (examples in comments, debugging snippets) uses compiled JS (no JSTalk) and bare top-level assignments (no `const`/`let`/`var`), so it can be re-pasted.

## Repo map
- `main-engine.jstalk.js`: dispatch (`send` etc.), DOM/geometry vtables, the `init()` pipeline, and the *classic* notation layer (GraphNotation, Labeller, BoxGraph, DefaultMetaNotation, CodeExecutionNotation, ...). The classic layer is being retired in favour of OmniMeta: don't extend it. (Formerly `general-containment`; some old SVGs still load that name.)
- `omnimeta.jstalk.js`: OmniMeta, the substrate-neutral OMeta for DOM/vector matching, plus the editor vocabularies (MathchaVocab, AffinityVocab, PowerpointVocab) that `init()` needs. An SVG must load `omnimeta.js` for `init()` to work.
- `utils.js`: geometry and DOM helpers; sets `svg_parent` at load.
- `lang-sweettalk.js`, `lang-descartes.js`, `bracket-hole-carving.js`: the textual DSL stack. `sweettalk.ometa` and `descartes.ometa.txt` are reference grammars only; nothing loads them.
- `TomasNotations/`, `CamilleNotations/`: notations and apps by collaborators (checkers, cars, animation). Treat their SVGs as test fixtures.
- `principles/`: diagrams illustrating the core parsing principles. Their XML snippets show pre-canonical encodings (`composite-shape`, `arrow-line`, `is-paragraph`, `data-connects`); ARCHITECTURE.md §4 has the current forms.
- `old-approaches/`: archive. Read for history only; do not modify.
- `JSTalk/`: transpiler (`jstalk2js.pl`) and VS Code extension.
- `issues.txt`: Joel's own issue/idea log. `README.md` is stale (describes `old-approaches`); don't trust it as current.

## Testing
Regression harness in `tests/` (Playwright + Firefox over `file://`; dev-only, nothing at runtime depends on it). Web standards are the ground truth, not a particular browser (PRINCIPLES.md Decisions 2).
- Run: `cd tests && npm test`. It compares each fixture's results with the snapshots committed in `tests/snapshots/`.
- After an intended change: `npm run update-snapshots`, then show Joel the snapshot diff in behavioural terms and let him approve it before committing. Never update snapshots just to make a failure go away.
- Fixtures are listed in `tests/fixtures.js`. A snapshot records what currently happens, including known failures, so fixing a broken fixture shows up as a snapshot change.
- Needs Node 20 or newer, installed via nvm. The system Node (18) is too old. If `node --version` shows 18 in your shell, prefix commands with `. ~/.nvm/nvm.sh && nvm use default &&`.
- First-time setup needs network access, which the agent sandbox lacks, so Joel runs it in an ordinary terminal: `cd tests && npm install && npx playwright install firefox`.
- Stages: smoke (every SVG loads; does `init()` run?), then notation results, then normalised-DOM snapshots, plus a check that every generated `.js` matches its `.jstalk.js` (so forgetting `./compile-jstalk` fails the suite). Snapshot reports must not contain auto-generated ids (`e411`, `t41`): use `__el`/`__canon` in `tests/lib.js`, or `canonIds`.
