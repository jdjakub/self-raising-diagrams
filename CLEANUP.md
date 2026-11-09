# CLEANUP.md

Inventory of fires: stale claims, legacy/new conflicts, broken files and dead code. These come from a static read of the code at `a12ce7e`. Nothing has been run in Firefox, so the first job of the test harness is to confirm or refute every **[inferred]** item. Section numbers (§) refer to ARCHITECTURE.md.

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

### 1. Magic-red boxes live only in the classic layer, and they're broken
- **What**: ID boxes (`#name`) and code boxes are steps 6–7 of `init()`, built on classic `EdgeDrivenGraphNotation`/`CodeExecutionNotation`. They look for `.is-paragraph` and `.connection`, which no editor vocabulary produces any more (§4).
- **Consequence**: `init()` should crash on every diagram with a magic-red box (magic-red-id-test, containment-stress-test, notational-dispatch, solid-physics-test-2) **[inferred, high]**. This is the backdoor described in `principles/6`, and the classic layer can't be retired until it has an OmniMeta replacement.
- **Hard requirement 2**: `removeDone()` *deletes* the used boxes from the document. Saving after `init()` therefore loses diagram content.
- **Questions for you**:
  - Keep swap-on-clash for ids?
  - Keep "ID boxes run before code boxes"?
  - Should used boxes be removed, or kept and hidden?
  - Is the red arrow that picks the compiler (`JS`, `Sucrose`) still the syntax you want?
- **Prediction**: re-express both box kinds as an OmniMeta notation that `init()` runs, keeping the current semantics. Used boxes get hidden, not removed. The `compileRegion:` compilers stay as they are, but read `text-wrapper`.
- **Confidence**: medium (that direction); low (the details).
- **Decision**: JOEL. **Blocks**: 2, 12, retirement of the classic layer, and every Mathcha demo.

### 2. No single way for a diagram to name its notation and start itself
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

### 3. Hard requirement 2 has no convention, so caches and meaning are mixed
- **What**:
  - Derivable caches (`data-origin-pt`, `data-string`, `data-connects`, auto ids, the magenta labelling lines) sit in the DOM unmarked, next to meaning (ids set by `#` boxes).
  - Caches go stale: `vupd` and the drag handles move geometry without updating `data-*-pt`.
  - `init()` deletes content (fire 1). `exposeGeometryControls` rewraps elements in a `<g>` (its own comment warns "will break lots of stuff").
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
  - `BoxGraphOM Label` still uses the classic constant `ALL_LABELS` (`.is-paragraph`), so OmniMeta BoxGraph names are never found **[inferred, high]**.
- **Prediction**: keep `Named:`'s structure but make the matching independent of document order (closest first among candidates). Document order is invisible in the picture, so depending on it breaks "no hidden state". Single-line vs multi-line becomes a per-notation `LabelSel`.
- **Confidence**: medium.
- **Decision**: JOEL.

### 5. Which files are sources and which are derived?
- **What**:
  - `*-normalized.svg` are committed outputs of `init()`.
  - `CheckersApp/checkers.svg` is a script-free copy.
  - `CarsApp/cars-spin.svg` is a hand-edited variant of `cars.svg` with ids added.
  - `exportJSForApp` output is pasted by hand into `CheckersApp/index.html`, which holds three rule blocks, two of them commented out.
  - `testCheckers` hardcodes auto-generated ids (`e409`) that appear in no committed file.
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
| `hole-carving-test.svg`, `labelGraph-example.svg` | keep, fix scripts (fire 12), add to harness | medium |
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

### 12. Broken or inconsistent script lists
- **What**:
  - `labelGraph-example`, `id-vanilla`, `hole-carving-test` and `solid-physics-test` don't load `omnimeta.js`, so `init()` cannot run.
  - `music`/`svgEdit` load the missing `general-containment.js`.
  - `empty-console` loads the deleted `probe.js`.
  - `prepare` doesn't add the HTML wrapper that issues.txt says is required.
- **Prediction**: one standard script block, inserted by an updated `prepare`.
- **Confidence**: high.
- **After**: fire 9 (don't fix files that are about to be archived).

### 13. Hard requirement 1 gap: elements without a vtable crash
- **What**: `send` on `<svg>`, `<defs>`, etc. throws a TypeError, not `doesNotUnderstand:` (§2).
- **Prediction**: elements with no `byTag` entry fall back to `vtables.domNode`.
- **Confidence**: high.
- **Note**: this touches a hard requirement, so it gets a plan first.

### 14. Dead or broken code

| Item | Prediction | Conf. |
|---|---|---|
| `JS{[SweetTalk]}` calls undefined `HOLE_DELIMS`/`compile_nested_holes` | delete (Sucrose covers it) | high |
| `BoardGameNotation` `findIndex` guards never fire | fix (`i < 0`) | high |
| `AnimationController` sets the attribute `transform_origin` | fix to `transform-origin`; tell Camille | medium |
| `BoxGraphOM Box` "TEMP black only" | resolve with fire 4 | medium |
| `VertexGrammar` (unused) | keep: issues.txt plans rect recognition with it | medium |
| `ActiveButton`, `TextGraph asJS`, `BoxGraph asJSOG` (classic) | port or drop with the retirement | medium |
| untracked, gitignored `svgEdit-old.js`, `geometry.js` | local only; you may delete | high |

### 15. Misleading comments
- `EditorVocab`: "in every notation's `_parent` chain". It isn't in any.
- `utils.js`: "CCW" means shoelace-positive, which is clockwise on screen. "Mathcha polygons may need reversing" is wrong (§9).
- `clip_poly_by_half_plane`: "HACK" on a sign flip that is actually correct.
- MathchaVocab comment: "must SET … `.is-paragraph`".
- `init()` comment: the typo `data-target=pt`.

**Prediction**: correct them all. **Confidence**: high.

### 16. `legible()` convention not followed in old code
- **Where**: `drawLLL:to:`, `createControls`, `line vertexAt:put:` and others.
- **Prediction**: fix whatever survives the retirement. Most of it disappears with the classic layer.
- **Confidence**: high. Lowest priority.

### 17. issues.txt mixes settled history with live issues
- **What**: for example, the "annotations on the `<g>` or the shape?" question, which canonical forms have since answered.
- **Prediction**: leave it; it's your log. At most you mark entries as settled.
- **Decision**: JOEL, whenever.

---

## Order of work
Each step is one small commit (or a few) on its own branch. You read the summary and try the result before the next step. The harness comes before any deletion or refactor.

**Phase 1: regression harness (no engine changes)**
0. *Your approval needed.* Node + Playwright as a **dev-only** dependency in `tests/`. Runtime stays dependency-free, so requirement 5 is unaffected. Caveats:
   - Playwright drives its own patched Firefox build, not your Firefox, so your hand testing stays the ground truth.
   - Installing it needs network access (`npm`, Playwright's browser download), which the sandbox may block.
1. **Smoke test** every SVG over `file://`. Record script-load errors, whether `init()` throws, and console errors. This turns every [inferred] item here into confirmed or refuted. Broken fixtures are recorded as *known-failing*, so fixing one shows up as a visible change.
2. **Semantic tests for the working OmniMeta notations**:
   - `checkers.svg`: the `testCheckers` assertions, plus a snapshot of `exportJSForApp`.
   - `checkers-turkish.svg`, and both `-normalized` files.
   - `cars.svg`: `CarsNotation` output.
   - Camille's `Example — animating a stack.svg` and `anim-test.svg`: the controller tables, plus a simulated click sequence checking element styles.
   - `boxGraph-example.svg`: BoxGraphOM. This should expose the fire 4 names bug.

   Results are serialised with DOM references replaced by ids.
3. **Normalisation snapshots**: the serialised DOM after `init()`, one fixture per editor (Mathcha, Affinity, PowerPoint). Caches are excluded or sorted until fire 3 is decided.
4. **Generated-file check**: `compile-jstalk` output matches the committed `.js`. I checked this by hand; the harness makes it permanent.
5. One command, e.g. `./run-tests`, written into AGENTS.md "Testing".

**Phase 2: your decisions, hottest first.** Fires 1–5, then 6–8, one per sitting. For each, I'd draft two or three concrete options with consequences, so you only have to choose. Each choice is recorded under "Decisions" in PRINCIPLES.md.

**Phase 3: safe mechanical cleanup**, harness green after each step: fires 14, 15, 13 (after its plan), 12 (after fire 9's triage), 16.

**Phase 4: port classic capabilities to OmniMeta**, following phase 2: magic-red boxes (1), dispatch and launch (2), labelling (4), arrows (6). Each port adds harness tests for the Mathcha demos it revives.

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
