# ARCHITECTURE.md

Implementation map of VVE. Read PRINCIPLES.md for the ideas. Mapped by static reading of the code at `d92680c`; **nothing here has been run in Firefox**. Markers: **[inferred]** = deduced, not confirmed from code; **[stale]** = code that no longer agrees with the rest of the system.

## 1. Load order and globals
SVGs load plain scripts via `<script href>` in this order (see `prepare`): `utils.js` → `bracket-hole-carving.js` → `lang-sweettalk.js` → `lang-descartes.js` → `main-engine.js` → `omnimeta.js` → optional notation file (e.g. `TomasNotations/board-game-notation.js`). Everything is a bare global. `utils.js` sets `svg_parent` to the first `<svg>` at load time. Collaborator SVGs are wrapped in `<!DOCTYPE html><html><body>` so the Inspector highlights elements (issues.txt, "POST-PROCESSING").

**Nothing runs automatically.** No SVG has inline script or `onload`. The user types `init()` in the console, then whatever the notation needs (§7). `main-engine.js` does install one live handler at load: `svg_parent.onmouseup`, which shows drag handles (`exposeGeometryControls`) when global `tool === 'select'`.

`init()` lives in main-engine but needs the editor vocabularies, which live in **omnimeta.js**. SVGs that don't load omnimeta.js cannot run `init()` (§8).

## 2. Dispatch (`main-engine.jstalk.js`, top)
- `send(recv, 'a:', x, 'b:', y)` joins keywords → `sendNoKw(recv, 'a:b:', x, y)`.
- `sendNoKw` picks the vtable: `recv.tagName` → `vtables.byTag[tagName]`; a 2-element Array → `vtables.point`; `recv.vtable` as a string → `vtables[name]`, otherwise the object itself.
- `sendNoKwFrom` walks `_parent` until it finds the selector. If nothing does, it re-sends `doesNotUnderstand:` with `[selector, ...args]`. If that is missing too, it throws `[recv, " didn't understand: ", ...]`.
- Super: `needsSuper(fn)` marks a method. It then gets `supr` first, which re-sends starting from the parent of the vtable where the method was found.
- Wrappers (`GraphNotation-Node`, `NamedThing`, `MathchaArrowShaft`, ...) are `{vtable, dom|elt|inner, ...}`. Their `doesNotUnderstand:` passes the message on to the wrapped element, so geometry messages reach the DOM.
- Only tags with a `byTag` entry dispatch: `path polyline line polygon rect ellipse circle text tspan g`. On `<svg>`, `<html>`, `<defs>`, `<script>` etc. `send` crashes with a TypeError (undefined vtable) rather than DNU.

## 3. Vtable hierarchy
```
DOM / geometry (main-engine)           OmniMeta (omnimeta + notation files)
geometric                              OmniMeta
├─ point            ([x,y] arrays)     ├─ SeqSubstrate ─ CharGrammar ─ NumberGrammar
└─ domNode                             │  │                └ PathDataGrammar ─ PowerpointArrowPath
   ├─ byTag.path                       │  │                                  └ AffinityArrowPath
   │  ├─ polyline ─ line               │  └─ VertexGrammar        (unused by any notation)
   │  │  └ polygon ─ rect              ├─ DictSubstrate ─ DOMAttrSubstrate ─ DOMMeta
   │  └─ ellipse ─ circle              │        DOMMeta ─ MathchaHeadShaftRules, PowerpointArrow
   ├─ byTag.text ─ tspan               ├─ ChildSetSubstrate ─ HeadShaftArrow ─ MathchaArrow
   └─ byTag.g                          └─ RegionSubstrate ─ NotationGrammar
Polygon (computed, no DOM)                  ├─ RegionDispatchNotation, BoxGraphOM
                                            ├─ BoardGameNotation, CarsNotation
"Classic" notations (main-engine)           └─ AnimationNotation
GraphNotation ─ EdgeDrivenGraphNotation  Runtime objects: GraphObject, GraphNode,
GraphNotation-Common ─ -Node, -Edge        GraphEdge, NamedThing, AnimationController,
Labeller                                   AbstractArrowShaft ─ MathchaArrowShaft,
LabelledGraph ─ BoxGraph, TextGraph,       AbstractArrowhead ─ MathchaArrowhead
   DefaultMetaNotation, CodeExecutionNotation
LabelledGraph-Node ─ DefaultMetaNotation-Region, CodeExecutionNotation-Box
LabelledGraph-Edge; ActiveButton; compilers JS, Sucrose, JS{[SweetTalk]}
EditorVocab ─ (set by learnEditor) MathchaVocab | AffinityVocab | PowerpointVocab
```
The tag chain is the "maximal specialisation" ladder: each `specialize` returns a replacement element with a more specific tag, or null. Examples: straight `path` → `polygon`/`polyline`; 4-point `polygon` → `rect` (axis-aligned, corners TL,TR,BR,BL, with a horizontal-flip retry for PowerPoint); 2-point `polyline` → `line`; curved `path` → `ellipse` → `circle`. A path with several sub-polygons becomes a `<g>` of polygons.

The `EditorVocab` comment says it sits "in every notation's `_parent` chain". It doesn't: only `init()` uses it, via `{vtable: EditorVocab}`.

## 4. Pipeline: `init()` (main-engine, end of file)
1. Create `nilElem` (`<g id="nil">`). `learnEditor()` picks the editor from `data-exported-from`, or by guessing: `svg.role-diagram-draw-area` means Mathcha; the `serif` namespace means Affinity; `<defs>` means PowerPoint. It then points `EditorVocab._parent` at that vocabulary.
2. If `svg[data-normalized]` is set, stop (the file was already normalised).
3. **Vocab `init`** (omnimeta.js) rewrites the editor's XML into canonical forms:
   - Closed: `g.boundary-wrapper > (.boundary-shape, g.shape-interior)`
   - Open: `g.connector-wrapper[data-origin-pt, data-target-pt, data-origin-out, data-target-out] > (.connector-shaft, .connector-head?)`
   - Text: `g.text-wrapper[.is-multiline][data-string]`

   Per editor:
   - Mathcha: merges the text sub-SVG and renames `composite-shape`/`arrow-line`/`.connection.real`. Arrow endpoints come from `MathchaArrow`. Text is g/g/g/text runs joined by line.
   - Affinity: pushes transforms down into the geometry, unwraps groups, and pairs head+shaft paths with `AffinityArrowPath`.
   - PowerPoint: bakes transforms, stitches split `<text>` runs back into paragraphs geometrically, and treats paths with `MAGIC_ARROW_COLORS` fills as arrows (`PowerpointArrowPath`).
4. `seedElements` → specialise each element up to 10 times → give it an id → record it in global `everything`.
5. **Containment** (`findTightestContainerIn:`): the tightest enclosing shape wins; one drawn above the current pick (`covers:`) also wins. Each element is then moved into its container's `.shape-interior` (`reroot`), and the temporary `data-contained-in`/`data-contains` are deleted.
6. **Magic-red ID boxes**: a magic-red rect whose text starts with `#` renames its container, or the target of an undirected red probe line. If the new id is taken, the two ids swap. Used boxes are marked `.done` and removed.
7. **Code boxes**: `CodeExecutionNotation` finds the red rects. A red arrow from a rect to a text names a compiler (default `JS`; also `Sucrose` = SweetTalk/Descartes holes via `compile_with_directive`). It then runs `compileRegion:` on the rect's interior and `eval`s the result.

Other PRINCIPLES.md entries: **connector attachment** = `path connections` (writes `data-connects`/`-connectors`), `GraphNotation-Edge connections`, OmniMeta `GraphObject connectionsOf:`/`elementAt:matching:`. **Arrowhead direction** = `HeadShaftArrow` + `AbstractArrowShaft orientWith:` (the shaft end nearer the head tip is the target). **Stringification** = vocab `init` (`data-string`). **Magic red** = steps 6–7.

**[stale] The classic layer predates the canonical forms** (commit `2ef5577` "Towards canonical DOM"). Steps 6–7, `BoxGraph`, `TextGraph`, `DefaultMetaNotation`, `ActiveButton` and the `JS`/`Sucrose` compilers still look for `.is-paragraph`, `.connection` and `.arrow-line`, which no vocabulary produces any more. `idSetterBoxes` calls `.querySelector('.is-paragraph').dataset` on every magic-red rect, so `init()` throws a TypeError on a diagram with one (confirmed on notational-dispatch by the smoke test). The classic `isDirected` is always false for the same reason. The OmniMeta notations are unaffected by this.

**Step 3 also has a bug on the OmniMeta side**: MathchaVocab asks `MathchaArrow` for `tangents`, which only handles one-headed arrows. A plain line or double-headed arrow makes `init()` throw `match(...) is null` (confirmed: magic-red-id-test, containment-stress-test, solid-physics-test-2). CLEANUP.md fire 12.

## 5. Two notation layers
**Decision (Joel):** the classic layer is being retired in favour of OmniMeta, and canonical forms are to be used everywhere. Until it is gone, both exist:
- **Classic** (main-engine), built via `send({vtable:'X'}, 'fromRegion:', scope)`: `GraphNotation` claims nodes and doesn't look inside them; `EdgeDrivenGraphNotation` adds a candidate as a node when an edge endpoint hits it; `Labeller` greedily pairs labels with the nearest labellable and draws magenta "LLL" lines into the DOM, from which `LabelledGraph` names things; `DefaultMetaNotation` reads blue boxes (box → text arrow = notation name) and `instantiateAll` creates globals named after the boxes.
- **OmniMeta** (omnimeta.js + notation files): PEG-style grammars where each rule is a vtable method. Entry point: `match(grammar, input, rule)` (null on failure), or `NotationGrammar fromDocument` (sets `window.semantics`), which defaults to `match(..., 'Root')`.

## 6. OmniMeta substrates
A match is `m = {vtable: grammar, cursor, memo}`. All mutable state lives on `m`; grammars are meant to be shared and stateless. Backtracking = restore `m.cursor` + throw `fail`. **Invariant:** the cursor rolls back on backtrack; mutation of other objects does not. A *Substrate* owns a cursor type (`initialCursor:`, `cursorKey:`); a *Grammar* reuses one. Combinators: `or: opt: not: lookahead: many: many1: pred:`. There is no memo or left recursion yet (`apply:` is a plain send). `many:` guards against looping by checking that `cursorKey:` changed.

| Substrate | Cursor | Primitives |
|---|---|---|
| SeqSubstrate | `{stream, idx}` | `anything`, `exactly:`, `end` (strings, token lists, vertex lists) |
| DictSubstrate / DOMAttrSubstrate | `{dict, consumed:Set<key>}` | `anyKey`, `key:` (JS object keys / DOM attributes) |
| DOMMeta | same, `dict` = current element | `parent`, `firstChild`, `nthChild:`, `querySelector:`, `findFirstMatching:` |
| ChildSetSubstrate | `{parent, consumed:Set<Element>}` | `anyChild`, `childWhere:`, `childMatching:inGrammar:` (children as an unordered set) |
| RegionSubstrate | `{scope, consumed:Set<Element>}` (+ transient `dict`) | `claimMatching:`, `claimFirst:onExhausted:piercing:quickTest:` |

`NotationGrammar` (on RegionSubstrate) supplies the shared combinators:
- `Named:` claims a thing, then claims an optional label near it. The label search can see inside claimed boxes.
- `Box:` claims a box, then parses its interior with a separate match.
- `GraphWithVertices:andEdges:` (E* then V*); `BiGraphFrom:via:to:` (only references the endpoints, doesn't claim them); `claimAll:near:within:`.
- Tunable distances `nameEpsilon` 20, `connectToShapeEpsilon` 3, `connectToTextEpsilon` 15.
- Default element rules (`Label`, `Shape`, `Connector`, `BoxShape`, `Any`), each with an optional `<Rule>Sel` CSS selector used as a cheap pre-filter.

### claimMatching: vs lend:
| | `claimMatching: rule` | `lend: grammar input: x rule: r` |
|---|---|---|
| Match object | same `m`, same grammar chain | new child match (`matchStrict`), fresh memo and cursor from *grammar*'s `initialCursor:` |
| Input | searches `cursor.scope` in document order | anything: string, element, vertex array, ... |
| How the rule runs | on each candidate in turn: `cursor` briefly gains `dict = candidate`, then is restored | the foreign start rule on its own cursor |
| Effect on caller | **consumes** the hit and its wrapper (`localRoot`); later claims skip that whole subtree (opacity); undone on backtrack | none: the child's claims stay invisible to the caller; only the value comes back |
| Failure | `fail` when the region is exhausted | child's `MATCH_FAILED` is re-thrown as `fail` |
| Purpose | claim elements within one region, without overlap | cross cursor types (attribute string → path grammar), or parse a sub-region in isolation |

They combine in `Box:` (claim, then lend the box's `interior` to `self.vtable`): the outer parse can't see in, and the inner parse starts with an empty consumed-set. `BoardGameNotation Before:After:` *references* boxes (`boxAt:`, no claim) before lending, so one box can serve several arrows **[inferred purpose]**. `lend:` takes rule *names* only: a thunk would break `apply:`. It doesn't pass grammar parameters on yet (the comment says this is planned).

## 7. Collaborator notations: wiring and launch
All three are `NotationGrammar` subclasses, loaded as the last `<script>` of their SVGs. Every compiled `.js` matches what `compile-jstalk` produces from its `.jstalk.js` today (checked).

**BoardGameNotation** (`TomasNotations/board-game-notation.jstalk.js`, PowerPoint).
- `fromRegion:` replaces `Root`: it takes the first `<g>`'s interior (the page background rect **[inferred]**) and runs `RegionDispatchNotation` (`Named(Box)+`). Each box title `NAME (:Rule)` picks that box's rule: `BoardLegend` (parsed first), `BoardState` (second), `MoveSpec`, `TransformSpec`, `CombosSpec`.
- Pieces are identified by `similarShapes` against the legend's examples; zones by a hardcoded `stroke-width` selector.
- Side effect: installs `boardPieces`/`boardZones` closures on the shared vtable, breaking the stateless-grammar rule. Bug: `findIndex` returns -1 for a missing region, which the `i >= length` checks never catch.
- Launch, as the diagram instructs, in `TomasNotations/checkers.svg`: `init()` (my addition **[inferred]**); `send({vtable:'BoardGameNotation'}, 'fromDocument')`; `send({vtable:'BoardGameNotation'}, 'exportJSForApp')`. The last returns JS source, pasted by hand into `CheckersApp/index.html` (the Turkish rules are the active block now).
- `*-normalized.svg` have `data-normalized`, so `init()` stops at step 2; they probably parse without it **[inferred]**.
- `testCheckers` (Tomas's own assertions) now fails, because it hardcodes auto-ids that have shifted. The harness runs a port of it that compares ids by order of appearance; that passes on the raw and normalised files.

**CarsNotation** (`cars-notation.jstalk.js`, PowerPoint `cars.svg`; unfinished: on cars.svg it currently finds no cars, see CLEANUP.md fire 15). `Root = Car* RoadPath* Arrow*`. `Car` = a 9-vertex polygon plus exactly 2 circles within 10px (`claimAll:near:within:`). `RoadPath` = a path with stroke-width `1.33333px` plus 10-vertex polygon markers within 2px. Launch: `init()`; `send({vtable:'CarsNotation'}, 'fromDocument')` **[inferred, the file gives no instructions]**. `CarsApp/` does **not** use it: `cars.html` reads hardcoded ids from the script-free `cars-spin.svg` in an iframe.

**AnimationNotation** (`CamilleNotations/animation-notation.jstalk.js`; Affinity SVGs, except Mathcha `anim-test.svg`).
- `Root`: a green (`rgb(45,184,10)`) arrow from a green label names its target element. Red (`rgb(184,10,10)`) boxes each hold a `SeqGraph = Graph(Text, Named(SeqArrow))`; texts can be vertices, so the name-vs-endpoint test is on.
- Compiles to an `AnimationController` (`byEvent`, `cmdsByState`). Commands: `opacity stroke scale text wait anim`. Events: `click`, `click N`, `Ns`.
- Launch: `init()`; `send({vtable:'AnimationNotation'}, 'fromDocument')`; `send(semantics, 'beginSlideshow')`; click **[inferred]**.

**Apps**: `CheckersApp/index.html` + `app.js` and `CarsApp/cars.html` + `cars.js` are standalone Elm-style HTML pages. They read their SVG through `iframe.contentDocument`. The comment says "works over http://". Firefox's default file:// policy gives each file its own origin, so this probably returns null over file://, against hard requirement 5 **[inferred]**.

## 8. Which SVGs exercise what
| File | Editor | Exercises | Notes |
|---|---|---|---|
| principles/1–6 | Mathcha | documentation only (no scripts) | show the *old* encodings (`composite-shape`, `arrow-line`, `is-paragraph`, `data-connects`) |
| boxGraph-example | Mathcha | vocab, containment, BoxGraph / BoxGraphOM (`match(vtables.BoxGraphOM, svg_parent, 'BoxGraph')`) | no red boxes, so `init()` should succeed |
| labelGraph-example | Mathcha | TextGraph | no omnimeta.js → `init()` fails |
| containment-stress-test, magic-red-id-test | Mathcha | containment, ID boxes, JS / SweetTalk code boxes, ID swaps | [stale] §4 |
| notational-dispatch | Mathcha | DefaultMetaNotation → BoxGraph/TextGraph, Sucrose box, `asJSOG` | [stale] §4 |
| hole-carving-test | Mathcha | SweetTalk holes, meta-dispatch, `asJS` | no omnimeta.js |
| solid-physics-test(-2) | Mathcha | SweetTalk+Descartes, `Polygon intersectWith:`, `vupd` vector arrows | -1 has no omnimeta.js; -2 [stale] |
| id-vanilla | Mathcha | the ID object model (commented-out code at the end of main-engine) | no omnimeta.js |
| boxGraph-bootstrap | Mathcha | legacy: loads boxGraph-bootstrap.js *and* main-engine.js; the second overwrites `vtables` | legacy |
| music, svgEdit | Mathcha | load missing `general-containment.js` | broken |
| empty-console | none | console sandbox; loads deleted `probe.js` | 404 for one script |
| tmp, rect-controls-wiring-diagram, solid-physics-test-2-theory, CamilleNotations/Extra ideas | — | scratch / design notes | |
| TomasNotations/checkers(-turkish)(-normalized), cars | PowerPoint | PowerpointVocab, BoardGame/Cars notations | §7 |
| CheckersApp/checkers.svg, CarsApp/cars-spin.svg | PowerPoint | no scripts; iframe sources for the apps | |
| Camille Description, Example stack, anim-test | Affinity / Mathcha | AffinityVocab, AnimationNotation | |

## 9. Orientation / shoelace sign convention
- Both implementations sum `xᵢ·yᵢ₊₁ − xᵢ₊₁·yᵢ`: `shoelaceArea` (omnimeta, halved) and `convex_poly_verts_ccw` (utils, not halved). SVG's y axis points down, so a **positive sum means clockwise as seen on screen**. Check: `rect vertices` gives TL,TR,BR,BL and a sum of +2wh.
- `utils.js` calls positive "CCW" (the maths name, y up), so `convex_poly_verts_ccw` really returns screen-clockwise vertices. Its note "Mathcha exports clockwise polygons, so callers may need to reverse" misleads: on-screen-clockwise input is already positive and is left alone.
- `clip_poly_by_half_plane` counts cross ≥ 0 as inside. The comment says "left of edge"; on screen that's the right-hand side, i.e. the interior of a positive polygon, so the code is consistent. `denom = -denom // HACK` is in fact correct: t = −cross(e, a−A) / cross(e, d) **[inferred by derivation]**.
- `normal_for_seg` rotates (vx,vy) to (−vy,vx): **inward** on screen for positive polygons.
- `VertexGrammar` canonical order: start at the lex-min vertex (lowest x, then y), reverse if the sum is negative. So screen-clockwise from the left(-top) vertex; for an axis-aligned rect, TL,TR,BR,BL.
- The Mathcha arrowhead matrix (columns: look back, look left; `MathchaArrowhead lookAlong:`) is a separate convention, unrelated to this sign.

## 10. `_claimedLabels` caching
- `Labeller run` sets `_claimedLabels`, `_claimedLabellables` and `_drawnLines` on the Labeller JS object, replacing them on every run (no invalidation).
- Only `attachmentGraph` reads them, building a new `GraphNotation` over the lines just drawn (compared by `l.dom || l`, since wrappers are re-created per call). Owners keep that object (`self.boxAttachments`, `self.arrowAttachments`) and its own `_nodes`/`_edges` cache serves `nameFromAttachments`.
- Claims are **not** passed between passes via `_claimedLabels`: `unclaimedLabels()` re-derives them from the DOM (a label is taken if any `g.attachment-line > line` endpoint lies inside its box). So the magenta lines in the document are the lasting record, and running `run` twice draws duplicates **[inferred]**.
- Contrast OmniMeta `Named:`: a claimed label lives only in the cursor's `consumed` Set, undone on backtrack and never written to the DOM.

## 11. Document vs JS state (hard requirement 2)
The DOM mixes, unmarked: geometry-derivable caches (`data-origin-pt` etc., `data-string`, `data-connects`/`-connectors`/`origin`/`target`, auto ids, LLL lines); meaningful state (ids set by `#` boxes); and pipeline progress (`data-normalized`). JS-only properties on elements: `pieceName`, `zone`, `js_func`, `_connections`, and the animation's `animState`/`timerId`/ `activeAnim`. The last three change what the user sees but are never written back, so a reload resets the animation **[inferred]**.

## 12. Regression harness (`tests/`)
Playwright driving its own Firefox build over `file://`. It is dev-only: no SVG loads anything from `tests/`, and runtime stays dependency-free. Commands and the snapshot-approval rule are in AGENTS.md "Testing".
- `fixtures.js`: every tracked SVG outside `old-approaches/`, each with a note on what it is or why it fails.
- `lib.js`: shared helpers (open a fixture, record errors, turn page values into JSON, scrub machine paths).
- `specs/smoke.spec.js` (stage 1): for every fixture, records its `<script href>` references and whether each file exists, any page or console errors, and whether `init()` exists and what it returned or threw.
- `snapshots/<spec>/<fixture>.json`: committed results. A failing fixture's snapshot records the failure, so a fix shows up as a snapshot diff.
- `specs/notations.spec.js` (stage 2): launches each collaborator notation as a person would in the console and records its result as a readable text report: checkers (all four files, plus the `testCheckers` port against `expected/tomas-checkers.json`), cars, both animation diagrams (with a simulated click-and-wait playback on a fake clock), and BoxGraphOM. Reports avoid auto-ids: elements are described by appearance (`rect @30,40 90x80 fill=...`), and any remaining ids become `#1`, `#2`, ... in order of appearance.
- `specs/normalisation.spec.js` (stage 3): the whole `<svg>` tree after `init()`, one element per line, for one diagram per editor (Mathcha boxGraph-example, Affinity animating-a-stack, PowerPoint checkers), headed by counts of the canonical forms. Auto-ids show as `id=auto`, attributes are sorted, decimals rounded to 2 places, and values over 500 characters (except paragraph text) shortened to a fingerprint.
- `specs/generated.spec.js`: every `.jstalk.js` is listed in `compile-jstalk` and its committed `.js` is exactly the transpiler's output. Runs Perl, no browser.
- `expected/`: hand-written or extracted expectations, as opposed to generated snapshots (currently Tomas's `testCheckers` strings).
