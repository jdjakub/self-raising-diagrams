# PRINCIPLES.md

The ideas behind VVE. Joel owns this file; agents read it but propose changes rather than making them. AGENTS.md turns some of these into hard rules.

## Aim: notational freedom
If you think "I'd rather express this problem, data structure or code in notation X", you should be able to use X at reasonable cost. Defining a notation must be cheap, because the right number of notations is many small, local ones rather than a few big general ones: each extra notation saves effort on every use, but costs effort to define and to switch into. Lowering the definition cost shifts that balance towards more notations.

## Augmented Diagrams
SVG diagrams, drawn in whatever editor you like, interpreted as a graphical analogue of source code according to visual syntax rules. Two kinds:
- **Static diagrams**: parsed, then macro-expanded, compiled (to further diagrams or to text) or interpreted.
- **Self-raising diagrams**: bootstrap themselves into an interactive graphical app when opened in a suitable environment (for SVG, a browser). A diagram can name its own notations, so it carries the instructions for its own interpretation.

## Tolerate the editor ecosystem
Diagrams come from editors that were never designed for this (Mathcha, Affinity Designer, PowerPoint), each with its own quirks for drawing the same thing. We absorb those quirks (via per-editor vocabularies and canonical forms) rather than demanding a special editor or a pristine input format.

## Decoration by default
Arbitrary SVG is decoration unless marked otherwise. Code is the minority, so code is what gets marked (magic red boxes); decoration needs no marking.

## Visual primitives
Once editor quirks are absorbed, every diagram is built from three primitives: **closed shapes**, **connectors** (open paths, optionally directed by arrowheads) and **text**. Notations are defined over these.

## Normalising techniques
`principles/` illustrates techniques the engine applies to the document itself. They change its encoding, not its look:
- **Maximal tag specialisation.** Each element is rewritten to the most specific SVG tag that fits it (e.g. a rectangular `<path>` becomes a `<rect>`). This puts SVG's otherwise-unused specialised tags to work, and lets messages dispatch on tag.
- **Containment as tree structure.** Spatial containment is mirrored in DOM nesting. This is invisible in the render, except that it can change depth ordering.
- Connector attachment, arrowhead direction, paragraph-text stringification and magic red boxes are the remaining entries; see ARCHITECTURE.md for how each is implemented.

## The document is the ground truth
Everything that affects a diagram's meaning lives in the SVG document. JS objects are projections of it: useful caches and interfaces, never the authoritative copy. Pure caches (derivable from geometry) may live in JS; anything not derivable, such as a user's manual override, must be written back to the document. Closing and reopening a diagram restores exactly what the user had.

**No hidden state** is the aspiration behind this: if two documents look the same, they should mean the same, so meaning never hinges on invisible differences in how the SVG happens to be encoded. It is practically unfulfillable in full. Pathological cases (re-creating a graphic as a raster of myriad tiny squares) are out of scope. Realistic but rare cases (a stroked `<rect>` versus four `<line>`s that look identical) are deprioritised, because editors don't produce the latter pattern. The priorities are the look-alikes editors really do produce: `<rect>` versus `<polygon>` (or `<path>`) for the same shape, and colours that are perceptually indistinguishable but numerically different. Be cautious wherever meaning depends on an exact colour value.

## Syntax and semantics are roles, not properties
Whether something counts as syntax or as meaning depends on which interpretation you're looking at it from. Facts form layers, ordered by how many interpreters would agree on them. At the bottom is pure geometry ("this is a rectangle"; "this path's endpoint lies inside that shape"), which belongs to the shape itself. Above it are conventional readings that most notations share but that already involve choices ("this arrow points at that box" depends on direction, proximity and selection criteria, not just geometry). At the top are facts specific to one notation ("this rectangle is a checkers square"), which belong to that notation's interpretation. Don't present a higher-layer reading as if it were geometry.

## Rules, not examples
The engine ingests rewrite rules stated with placeholders, never concrete before/after examples to generalise from. A pair of example diagrams joined by an arrow is documentation for humans. If a rule can't be stated at the level of a schema, it isn't ready to propose. (Programming-by-example is a separate research area that this project deliberately stays out of.)

## Late-bound messaging as the interaction surface
Every object, including raw DOM elements, can be sent Smalltalk-style messages from the browser console, on our terms rather than the DOM's. This is how the system is explored and debugged interactively, and it must survive any reimplementation.

## Decisions
Resolutions of conflicts between competing implementations. Newest last.

1. **Retire the classic notation layer in favour of OmniMeta; use the canonical forms everywhere.** The classic notations in `main-engine` (GraphNotation, Labeller, BoxGraph, TextGraph, DefaultMetaNotation, CodeExecutionNotation and friends) are superseded by OmniMeta grammars. All code reads and writes the canonical DOM forms (`boundary-wrapper`, `connector-wrapper`, `text-wrapper`) rather than any editor's own encoding or the older classes (`is-paragraph`, `arrow-line`, `composite-shape`, `connection`).
2. **Web standards, not a particular browser, are the ground truth.** Firefox is the main browser for hand testing and for the regression harness (Playwright's Firefox). If results differ between browsers or browser versions, the project is relying on something it shouldn't: non-standard behaviour (fix it to follow the standard), the installed fonts, or exact values from geometry functions that standards let vary (compare with tolerance instead). Each such difference is a fire to fix, never a reason to pin a browser.
3. **Magic-red boxes are a setup escape hatch into JS, re-expressed in OmniMeta.** They give JS stable names (DOM ids) and run setup code. An id is hidden state; the ID box makes it visible and authorable in the diagram.
   - **Naming.** A red box whose text starts with `#` names the shape it sits inside. Where that won't do (connectors, shapes too small to hold a box), an undirected red probe line joins the box to its target, which can be anything: a shape, a connector or a text. If a box has both a container and a probe, the probe wins.
   - **Errors, not guesses.** These are diagram errors: a box with two or more probes, a probe whose far end touches nothing or more than one thing, a box with neither container nor probe, and two boxes claiming the same name. Each is reported in the console and the name is not applied. Ambiguous probe ends may be relaxed later.
   - **Clashes.** A name drawn in a box takes priority over any id that wasn't drawn (auto ids, editor ids). The displaced element gets a fresh auto id.
   - **Code boxes** are always interpreted by Sucrose, which reads the first-line shebang; with no shebang the code is plain JS. The red arrow to a language name is retired. All ID boxes run before any code box. Code boxes run in reading order of the rendered diagram (top to bottom, then left to right), never document order, and so do the lines of text within a code box.
   - **Scaffolding.** Both kinds are deleted once they have run. The unexecuted diagram, red boxes included, is the source; the document after `init()` is a run of it, not something to save. This is a deliberate, scoped exception to hard requirement 2, to be revisited if saving a partially evolved diagram becomes a use case.
   - Class boxes stay retired; set classes from a code box.
4. **Connectors never get a direction they don't draw.** A connector with exactly one arrowhead is directed: it has an origin and a target. One with no heads, or two, has nothing that breaks its symmetry. Its canonical form records the two ends as an unordered pair (`g.connector-wrapper.is-symmetric` with `data-end-pts` and `data-end-outs`), and asking it for an origin or target fails rather than guessing. Whatever order the ends happen to be written in (file order, path order) is meaningless, and nothing may depend on it. Order supplied by context is fine, because the context breaks the symmetry, not the encoding: for example, starting from the end inside a red ID box and asking for the other end. Whether a notation treats headless and double-headed connectors differently is up to that notation; it can count the heads.

5. **A diagram names its notations with drawn `(:Name)` titles, and opening it starts it.**
   - **Box titles.** A box titled `TITLE (:Name)` has its interior parsed by `Name`, and the result is named after `TITLE`. This meta-notation is currently built into BoardGameNotation; it is extracted as the new `DefaultMetaNotation`, replacing the blue box-and-arrow one (classic, retired), which was an early experiment.
   - **Page title.** A `(:Name)` text that isn't the title of a nearby region shape names the whole diagram's notation, wherever it is drawn. Containment plays no part: whatever box the text happens to sit in (such as the page-sized white box in Tomas's PowerPoint drawings) is a coincidence, not part of the meaning. There is zero or one such title; two are a reported diagram error. Alternatives considered and rejected as noise: a distinguishing colour or border, or one box around the whole diagram so that box titles could be reused. The `(:…)` syntax won't clash with ordinary text by accident.
   - **Rule, then notation.** In a box title, `Name` is looked up first as a rule of the notation the box sits in, then as a notation; neither is a reported diagram error. So a notation built on `DefaultMetaNotation` uses titles for its own rules (BoardGameNotation's `BOARD (:BoardLegend)`) and can still host a box in any other notation. A rule beats a notation of the same name, as a local name beats a global.
   - **Results.** After the parse, the console global `semantics` holds the whole diagram's result. Under `DefaultMetaNotation` that is a table from each region's title to its result (`semantics['MOVES - REGULAR']`); regions get no globals of their own. A `(:Name)` title next to a region but with no title text before it is a reported diagram error, and that region isn't parsed (it may be a misplaced page title).
   - **Order.** `DefaultMetaNotation` parses titled regions in reading order (top to bottom, then left to right, as for code boxes), never file order. A notation whose regions depend on each other (BoardGameNotation's legend comes first) may override it until explicit ordering conventions are drafted (CLEANUP.md fire 21).
   - **Default.** With no page title, the diagram is read by `DefaultMetaNotation`: a well-known default, so a diagram of titled boxes needs no page title.
   - **Starting.** Opening the SVG runs `init()` and then parses the diagram with its notation, which changes nothing visible, so its result and any notation errors can be inspected straight away. Starting the notation (running the app) is a manual, explicit message send in the console, `send(semantics, 'start')`, with no shorthand global, so the initial state can be seen and inspected before anything runs.
   - Demos edited by hand (PowerPoint and Affinity exports) get their page title as a copy of that editor's own SVG for a text; Mathcha demos are re-exported. Never an XML-only attribute.

## Long-term direction
Distil chunks of the engine itself into diagrammatic rewrite rules and compile those back down, so that the system is increasingly expressed in its own notations. Architecture comes first; this is a direction, not a current task.
