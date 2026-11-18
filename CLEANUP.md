# CLEANUP.md

Inventory of fires: stale claims, legacy/new conflicts, broken files and dead code. These come from a static read of the code at `a12ce7e`, checked against the harness's smoke test (stage 1; results in `tests/snapshots/smoke.spec.js/`). Items marked **[confirmed]** or **[refuted]** were checked that way; **[inferred]** items are still unverified. Section numbers (§) refer to ARCHITECTURE.md.

## How the list is ranked
Hottest first. A fire is hotter when:
1. it needs **your** judgement (an agent can't settle it alone);
2. it blocks other fires or the retirement of the classic layer;
3. it puts a hard requirement or a stated principle at stake;
4. it breaks something now, or misleads whoever reads the code next.

Mechanical fires with an obvious fix sink to the bottom, however many there are. Each fire lists:
- **Prediction**: my guess at what you'll decide.
- **Confidence**: how sure I am of that guess.
- **Decision**: **JOEL** means it needs your call; *agent* means an agent can do it once approved.

---

## Burning: needs your judgement

### 1. Magic-red boxes live only in the classic layer, and they're broken (**done**)
- **What**: ID boxes (`#name`) and code boxes were steps 6–7 of `init()`, built on classic `EdgeDrivenGraphNotation`/`CodeExecutionNotation`. They looked for `.is-paragraph` and `.connection`, which no editor vocabulary produces any more (§4), so `init()` crashed on all four magic-red demos.
- **Decided** (PRINCIPLES.md Decision 3): re-express both box kinds in OmniMeta. Containment or a red probe line names the target (probe wins); ambiguous or missing targets and clashing boxes are reported errors; a drawn name beats any undrawn id; code boxes always go through Sucrose (no shebang = plain JS) in reading order; both kinds are deleted after running, as setup scaffolding. A connector's name lands on the whole connector (`g.connector-wrapper`), not its shaft.
- **Done**: `MagicRedNotation` (omnimeta.js) replaces the classic code, which is deleted. All four demos now finish `init()`; `tests/specs/magic-red.spec.js` reports the names, errors and code-box outcomes for each. A code box with no `//!` line runs as plain JS without calling Sucrose, so a diagram needn't load the Sucrose scripts unless its code uses them.
- **Remaining**: the demos' own code still assumes names sit on arrow shafts: magic-red-id-test's code boxes (`a.parentElement`, `#bidi-arrow connections`) and solid-physics-test-2's top box (`#vec-delta targetPt`, `#bar endpoints`; fire 6). They need redrawing in Mathcha once fire 6 settles how code reads arrows; containment-stress-test's class boxes then move into a code box. `magic-red-errors.svg` covers each error case. See also fires 19 and 20.

### 20. Some red boxes should stay visible
- **What**: Decision 3 treats every magic-red box as setup scaffolding and deletes it after `init()`. But in solid-physics-test-2 the physics code is worth keeping on screen while debugging, in space that is otherwise wasted. So some red boxes are meant to disappear and others to stay.
- **Question**: how does a diagram say which? For example a second magic colour, a marker in the box, or a per-diagram setting. Hard requirement 2 applies: a box that stays is part of the document, so whatever it did must still be reproducible on reload.
- **Decision**: JOEL, later.

### 2. No single way for a diagram to name its notation and start itself (**decided**; plan agreed, step 1 done)
- **Plan** (one commit per step, harness after each):
  1. Delete the classic blue `DefaultMetaNotation` (and its region vtable), `meta_boxgraph_init`, the blue-colour helpers, `ActiveButton` and `vtables.JS`. notational-dispatch stays known-broken until Joel re-exports it. **Done**: its code box now fails (`DefaultMetaNotation` is undefined), as the harness records. `EdgeDrivenGraphNotation`, left unused, is deleted too.
  2. New OmniMeta `DefaultMetaNotation`, extracted from BoardGameNotation's region dispatch (replacing `RegionDispatchNotation`): titled regions in reading order, looking through untitled boxes (this retires BoardGameNotation's "first `<g>`" hack), rule-then-notation lookup, results keyed by title, and reported errors (nameless title, unknown name, two regions with one title).
  3. BoardGameNotation rebuilt on it, keeping its legend-then-board-state order (fire 21).
  4. On open: `init()`, then the parse (page title, else `DefaultMetaNotation`) into `semantics`; two page titles are an error. `send(semantics, 'start')` runs the app: AnimationNotation begins its slideshow; `DefaultMetaNotation` starts each region that has a `start`.
  5. Page titles in the demos: the agent copies each editor's own text SVG into the PowerPoint and Affinity exports (checkers ×4 including `-normalized`, cars, animating-a-stack); Joel re-exports the Mathcha ones (anim-test, boxGraph-example, notational-dispatch).
  6. Harness launch scripts reduced to "open, read `semantics`", with snapshot changes shown to Joel; ARCHITECTURE.md §4, §5, §7 and this fire updated.
- **Decided** (PRINCIPLES.md Decision 5): drawn `(:Name)` titles. A box titled `TITLE (:Name)` is parsed by `Name`: (b) is extracted from BoardGameNotation as the new `DefaultMetaNotation`, assumed when there is no page title, and (a) is retired. A bare `(:Name)` text on the page names the whole diagram's notation. Opening the SVG runs `init()` automatically; starting the notation is a manual console command. `ActiveButton` goes with (a). Rejected: a red code box as the launcher (works today, but the notation is named in code and vanishes after running), and an SVG attribute written by `prepare` (invisible in the drawing).
- **What**: there are five conflicting mechanisms:
  - (a) blue box + blue arrow to a name text (`DefaultMetaNotation`, classic, broken);
  - (b) `NAME (:Rule)` box titles (`BoardGameNotation` via `RegionDispatchNotation`);
  - (c) a red code box that does the dispatch itself (notational-dispatch, hole-carving-test);
  - (d) console commands written as text in the diagram (checkers);
  - (e) nothing at all (cars, animation; launch is guesswork, §7).
- **Consequence**: nothing is actually self-raising. `init()` never runs on load, and every demo needs its own console incantation. PRINCIPLES.md says "a diagram can name its own notations", but there is no agreed way to do it.
- **Prediction**:
  - One OmniMeta region-dispatch notation in which a region names its notation visually: (a) re-expressed in OmniMeta, with (b) as the in-title shorthand.
  - The whole diagram declares its top notation the same way.
  - `init()` runs automatically on load, then dispatches.
- **Confidence**: low-medium. (a) vs (b) is a taste call.
- **Decision**: JOEL. **Blocks**: the uniform harness entry point. Until then, the harness uses per-fixture launch scripts.

### 21. Regions that depend on each other have no explicit order
- **What**: Decision 5 parses titled regions in reading order by default. Checkers has implicit dependencies: the legend must be parsed first (it defines the pieces), then the board state (it defines the zones), so BoardGameNotation reorders its regions in code. Nothing in the diagram says so.
- **Question**: what explicit, drawn convention lets a diagram state such dependencies?
- **Decision**: JOEL, later.

### 3. Hard requirement 2 has no convention, so caches and meaning are mixed
- **What**:
  - Derivable caches (`data-origin-pt`, `data-string`, `data-connects`, auto ids, the magenta labelling lines) sit in the DOM unmarked, next to meaning (ids set by `#` boxes).
  - Caches go stale: `vupd` and the drag handles move geometry without updating `data-*-pt`.
  - `init()` deletes the used red boxes; that is now deliberate (Decision 3: red boxes are setup scaffolding, scoped exception to requirement 2). `exposeGeometryControls` rewraps elements in a `<g>` (its own comment warns "will break lots of stuff").
  - Animation state (`animState` etc.) changes what you see but lives only in JS (§11).
- **Why it's hot**: the harness must choose what to snapshot. If a serialised DOM is full of caches, every harmless change shows up as noise.
- **Prediction**:
  - Pure caches move to JS (e.g. a `WeakMap` keyed by element), or carry a marked prefix such as `data-cache-*` and are thrown away before saving.
  - Unprefixed `data-*` is reserved for meaning.
  - Loading never deletes content.
  - Self-raising runtime state (animation position) is written to the DOM at commit points.
- **Confidence**: medium.
- **Decision**: JOEL. **Blocks**: the final snapshot format; phase 1 starts with snapshots that ignore caches.

### 4. Two labelling semantics: Labeller vs `Named:`
- **What**:
  - Classic `Labeller` matches labels globally: closest pair first, arrows labelled at their origin, single-line texts only.
  - OmniMeta `Named:` matches in document order, first come first served, using the whole connector and any text.
  - Retiring the classic layer silently changes which label names which thing.
  - `BoxGraphOM Label` still uses the classic constant `ALL_LABELS` (`.is-paragraph`), so OmniMeta BoxGraph names are never found **[confirmed]**: every box and arrow in boxGraph-example comes out unnamed.
  - Separately, asking BoxGraphOM which boxes an arrow connects crashes **[confirmed]**: the graph object passes the *named wrapper* to `epsilonFor:`, which expects a raw element. It works in notations whose vertices aren't `Named:` (checkers' combos graph, the animation sequences).
- **Prediction**: keep `Named:`'s structure but make the matching independent of document order (closest first among candidates). Document order is invisible in the picture, so depending on it breaks "no hidden state". Single-line vs multi-line becomes a per-notation `LabelSel`.
- **Confidence**: medium.
- **Decision**: JOEL.

### 5. Which files are sources and which are derived?
- **What**:
  - `*-normalized.svg` are committed outputs of `init()`.
  - `CheckersApp/checkers.svg` is a script-free copy.
  - `CarsApp/cars-spin.svg` is a hand-edited variant of `cars.svg` with ids added.
  - `exportJSForApp` output is pasted by hand into `CheckersApp/index.html`, which holds three rule blocks, two of them commented out.
  - `testCheckers` hardcodes auto-generated ids (`e409`) that appear in no committed file. **[confirmed]**: it now fails on `checkers.svg` because two elements were added and the ids shifted by two; every section's *meaning* is unchanged. The harness ports it with ids compared by order of appearance, and it passes on both the raw and normalised files.
  - The normalised files are faithful: raw and `-normalized` checkers (and the Turkish pair) give identical results, exported app code included **[confirmed]**.
- **Prediction**:
  - Raw editor exports are the sources.
  - Normalised files become harness snapshots, regenerated and diffed rather than hand-kept.
  - Each app loads a generated `.js` data file via `<script src>`, which also fixes fire 7.
  - `testCheckers` becomes a harness test.
- **Confidence**: medium.
- **Decision**: JOEL. Collaborators' files may need their consent.

### 6. Arrows: reading and editing still assume raw Mathcha structure
- **What**:
  - After normalisation, classic `path originPt`/`targetPt`/`isArrowhead`/ `isDirected` re-parse Mathcha's classes, which normalisation has removed. So `isDirected` is always false.
  - `vupd`, used by solid-physics-test-2 to move vector arrows, also needs the raw classes, so it is broken.
  - Canonical `connector-wrapper` is read-only: nothing can move its endpoints. Affinity and PowerPoint arrows have no setter at all.
  - The commented-out MathchaVocab protocol (`isArrowhead:`, `isConnector:`, `arrowGrammar`) and the `EditorVocab` comment describe a design (the vocabulary owns editor quirks) that the code doesn't follow.
- **Prediction**:
  - Reading uses `connector-wrapper` data only.
  - Arrow editing is new work, deferred until after cleanup; solid-physics-test-2 goes on the known-broken list until then.
  - The commented protocol is deleted.
- **Confidence**: medium.
- **Decision**: JOEL (is arrow editing in scope now?).

### 7. HTML apps probably break hard requirement 5
- **What**: `CheckersApp`/`CarsApp` read `iframe.contentDocument`. The code comment says "works over http://". Firefox's default `file://` policy gives each file its own origin, so this probably returns null **[inferred]**.
- **Prediction**: apps are in scope for requirement 5. Fix via fire 5's generated data file.
- **Confidence**: medium.
- **Decision**: JOEL. Verify first.

### 8. Notations keep global, mutable state
- **What**:
  - `BoardGameNotation` installs `boardPieces`/`boardZones` closures on the *shared* vtable during a parse, which breaks OmniMeta's stateless-grammar rule.
  - Results go to `window.semantics`.
  - The pipeline uses globals: `everything`, `nextId`, `idSetterGraph`, `codeExec`, `metaNotation`, `tool`.
  - For pre-normalised files `everything` stays empty, which breaks anything that reads it.
- **Prediction**: a per-parse child vtable (`_parent: BoardGameNotation`) carries the legend and zones. That means letting `lend:` pass grammar parameters on, which the code comment already plans. Pipeline globals become a returned result.
- **Confidence**: medium.
- **Decision**: JOEL (a small architectural change), then agent.

### 9. Legacy demos: which ideas are still alive?
One quick call per file:

| File | Prediction | Conf. |
|---|---|---|
| `boxGraph-bootstrap.svg/.js` (older copy of the engine; overwrites `vtables`) | move to `old-approaches/` | high |
| `svgEdit.svg/.js` (superseded by `exposeGeometryControls`; loads missing file) | move to `old-approaches/` | high |
| `solid-physics-test.svg` (v1; v2 supersedes it) | move to `old-approaches/` | medium |
| `id-vanilla.svg` + commented-out ID object model at the end of main-engine | archive the SVG; delete the commented code | low (may be a live idea) |
| `music.svg` (idea sketch; loads missing `general-containment.js`) | keep as notes, strip scripts | low |
| `tmp.svg` | delete | medium |
| `hole-carving-test.svg`, `labelGraph-example.svg` | keep, fix scripts (fire 13), add to harness | medium |
| `empty-console.svg` | keep, drop the `probe.js` tag | high |
| notes-only SVGs (`solid-physics-test-2-theory`, `rect-controls-wiring-diagram`, Camille `Extra ideas`) | keep as is | high |

**Decision**: JOEL (fast).

### 10. The principles diagrams show retired encodings
- **What**: `principles/1–6` show `composite-shape`, `arrow-line`, `is-paragraph`, `data-connects`, `data-origin`. Readers learn the wrong forms. AGENTS.md now warns about this.
- **Prediction**: you redraw the XML snippets in canonical forms; agents can't easily re-export from Mathcha.
- **Confidence**: medium.
- **Decision**: JOEL. These are your documents.

### 11. README.md is stale
- **What**: it describes `general-containment.js` and `sweettalk-js-transpiler.js`.
- **Prediction**: replace it with a short public README: what VVE is, how to open a demo, and links to PRINCIPLES/ARCHITECTURE.
- **Confidence**: high.
- **Decision**: JOEL (it's the public face), then agent.

---

## Smouldering: agent can do it once you approve

### 12. Mathcha arrows with zero or two heads crash normalisation (**done**)
- **What**: found by the smoke test, and it's on the OmniMeta side we're keeping. MathchaVocab's `init` asks `MathchaArrow` for each connector's outward `tangents`. That rule demands exactly one arrowhead, while the `endpoints` rule next to it already handles zero and two. A plain line or a double-headed arrow therefore makes `match` return null, and `init()` throws `match(...) is null` **[confirmed]**: magic-red-id-test and containment-stress-test (a double-headed arrow), solid-physics-test-2 (a headless red probe line).
- **Why it's high in this section**: any Mathcha diagram with a plain line or a double arrow can't be normalised at all. That hides fire 1's own crash, and it keeps those demos out of the harness.
- **Also found**: MathchaVocab never marks a Mathcha arrowhead `.connector-head` (a TODO), so after normalisation a one-headed Mathcha arrow can't be told from a plain line. Affinity and PowerPoint only recognise one-headed arrows; their plain lines aren't connectors at all (out of scope for now).
- **Decided** (PRINCIPLES.md Decision 4): one-headed arrows keep origin/target unchanged. Connectors with no heads or two get a separate symmetric form, `g.connector-wrapper.is-symmetric` with `data-end-pts` and `data-end-outs`, whose written order is meaningless. Asking a symmetric connector for origin/target fails: a grammar rule that needs a directed arrow doesn't match it, and code outside a parse gets a clear error. Mathcha heads get marked `.connector-head`. The rejected alternative was "origin = first point in the path", a direction invented from hidden file order.
- **Done**: implemented as decided. The three demos now get past normalisation and stop at fire 1; magic-red-id-test is in the normalisation snapshots (3 headless probe lines and a double-headed arrow come out symmetric).

### 13. Broken or inconsistent script lists
- **What**:
  - `labelGraph-example`, `id-vanilla`, `hole-carving-test` and `solid-physics-test` (plus `boxGraph-bootstrap`) don't load `omnimeta.js`, so `init()` throws `didn't understand: init` **[confirmed]**.
  - `music`/`svgEdit` load the missing `general-containment.js`.
  - `empty-console` loads the deleted `probe.js`.
  - `prepare` doesn't add the HTML wrapper that issues.txt says is required.
- **Prediction**: one standard script block, inserted by an updated `prepare`.
- **Confidence**: high.
- **After**: fire 9 (don't fix files that are about to be archived).

### 14. Hard requirement 1 gap: elements without a vtable crash
- **What**: `send` on `<svg>`, `<defs>`, etc. throws a TypeError, not `doesNotUnderstand:` (§2). The smoke test doesn't exercise this, so it's still **[inferred]** (from code, high).
- **Prediction**: elements with no `byTag` entry fall back to `vtables.domNode`.
- **Confidence**: high.
- **Note**: this touches a hard requirement, so it gets a plan first.

### 15. Dead or broken code

| Item | Prediction | Conf. |
|---|---|---|
| `BoardGameNotation` `findIndex` guards never fire | fix (`i < 0`) | high |
| `BoxGraphOM Box` "TEMP black only" | resolve with fire 4 | medium |
| `VertexGrammar` (unused) | keep: issues.txt plans rect recognition with it | medium |
| `TextGraph asJS`, `BoxGraph asJSOG` (classic; `ActiveButton` deleted in fire 2) | port or drop with the retirement | medium |
| untracked, gitignored `svgEdit-old.js`, `geometry.js` | local only; you may delete | high |
| `CarsNotation` finds no cars on cars.svg: each car's wheels are a circle *and* an ellipse (drawn slightly unequal), but the rule wants two circles. Roads now measure distance along the curve (not its bounding box), so they claim the markers along them, but where the two routes run within 2px the first road also claims the other road's markers **[confirmed]** | it's unfinished ("try cars"); ask Tomas before touching it | medium |
| `g encloses:` uses `firstChild`, which can be a whitespace text node with no vtable; `init()` on tmp.svg throws `resolverParent is undefined` **[confirmed]** | use `firstElementChild` | high |
| The Mathcha and Affinity importers delete "useless empty `<g>`s", including the `<g id="nil">` placeholder `init()` has just created; PowerPoint keeps it **[confirmed]** | create the placeholder after the importer runs, or exempt it | high |
| `learnEditor` falls back to MathchaVocab for unknown documents, so `init()` on a page with no drawing (empty-console) throws **[confirmed]** | fail with a clear message, or do nothing, when no editor is recognised | high |

### 16. Misleading comments
- `EditorVocab`: "in every notation's `_parent` chain". It isn't in any.
- `utils.js`: "CCW" means shoelace-positive, which is clockwise on screen. "Mathcha polygons may need reversing" is wrong (§9).
- `clip_poly_by_half_plane`: "HACK" on a sign flip that is actually correct.
- MathchaVocab comment: "must SET … `.is-paragraph`".
- `init()` comment: the typo `data-target=pt`.

**Prediction**: correct them all. **Confidence**: high.

### 17. `legible()` convention not followed in old code
- **Where**: `drawLLL:to:`, `createControls`, `line vertexAt:put:` and others.
- **Prediction**: fix whatever survives the retirement. Most of it disappears with the classic layer.
- **Confidence**: high. Lowest priority.

### 18. issues.txt mixes settled history with live issues
- **What**: for example, the "annotations on the `<g>` or the shape?" question, which canonical forms have since answered.
- **Prediction**: leave it; it's your log. At most you mark entries as settled.
- **Decision**: JOEL, whenever.

### 19. A Mathcha polygon is never normalised
- **What**: in magic-red-id-test and containment-stress-test, the big pentagon stays as Mathcha drew it (`g.shape > polygon.real`), not in Closed Canonical Form, so containment never sees it **[confirmed]**. The `#p1` ID box inside it therefore has no container and is reported as an error.
- **Prediction**: MathchaVocab's `init` misses this encoding of a closed polygon; teach it, and `#p1` names the pentagon.
- **Confidence**: medium (cause not yet traced).

---

## Order of work
Each step is one small commit (or a few) on its own branch. You read the summary and try the result before the next step. The harness comes before any deletion or refactor.

**Phase 1: regression harness (no engine changes)**
0. *Your approval needed.* Node + Playwright as a **dev-only** dependency in `tests/`. Runtime stays dependency-free, so requirement 5 is unaffected. Caveats:
   - Playwright drives its own patched Firefox build, not your Firefox, so your hand testing stays the ground truth.
   - Installing it needs network access (`npm`, Playwright's browser download), which the sandbox may block.
1. **Smoke test** every SVG over `file://` (**done**). Record script-load errors, whether `init()` throws, and console errors. This turns every [inferred] item here into confirmed or refuted. Broken fixtures are recorded as *known-failing*, so fixing one shows up as a visible change.
2. **Semantic tests for the working OmniMeta notations** (**done**; `specs/notations.spec.js`):
   - `checkers.svg`: the `testCheckers` assertions, plus a snapshot of `exportJSForApp`.
   - `checkers-turkish.svg`, and both `-normalized` files.
   - `cars.svg`: `CarsNotation` output.
   - Camille's `Example — animating a stack.svg` and `anim-test.svg`: the controller tables, plus a simulated click sequence checking element styles.
   - `boxGraph-example.svg`: BoxGraphOM. This should expose the fire 4 names bug.

   Results are serialised with DOM references replaced by ids.
3. **Normalisation snapshots** (**done**; `specs/normalisation.spec.js`): the serialised DOM after `init()`, one fixture per editor (Mathcha, Affinity, PowerPoint). Until fire 3 is decided, caches stay in, but auto-ids are blanked, attributes sorted and long decimals rounded, so diffs stay about meaning.
4. **Generated-file check** (**done**; `specs/generated.spec.js`): every `.jstalk.js` is listed in `compile-jstalk`, and its committed `.js` matches the transpiler's output.
5. One command (**done**): `cd tests && npm test`, documented in AGENTS.md "Testing".

**Phase 2: your decisions, hottest first.** Fires 1–5, then 6–8, one per sitting. For each, I'd draft two or three concrete options with consequences, so you only have to choose. Each choice is recorded under "Decisions" in PRINCIPLES.md.

**Phase 3: safe mechanical cleanup**, harness green after each step: fires 12 (done), 15, 16, 14 (after its plan), 13 (after fire 9's triage), 17.

**Phase 4: port classic capabilities to OmniMeta**, following phase 2: magic-red boxes (1, done), dispatch and launch (2), labelling (4), arrows (6). Each port adds harness tests for the Mathcha demos it revives.

**Phase 5: delete.** Remove the classic layer from main-engine and archive the legacy demos (9). Update ARCHITECTURE.md.

**Phase 6: agent-friendliness (low-hanging fruit)**:
- The test command in AGENTS.md.
- A uniform launch (falls out of fire 2), so "run this demo" becomes scriptable.
- Possibly a hook that runs `compile-jstalk` and the harness before a commit.
- Splitting `main-engine` by role (dispatch / geometry vtables / pipeline). That's an architectural change, so it gets a plan first.

## Checked and fine
- All five generated `.js` files match their `.jstalk.js` sources.
- Line endings are LF throughout.
- `old-approaches/` is untouched.
- The OmniMeta notations already use the canonical forms.
