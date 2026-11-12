// Every SVG the harness knows about, with paths relative to the repo root.
// `note` is for humans: why a fixture is expected to fail, or what it is for.
// Fire numbers refer to CLEANUP.md.
module.exports = [
  // Collaborator notations (OmniMeta; expected to work)
  { file: 'TomasNotations/checkers.svg', note: 'PowerPoint; BoardGameNotation' },
  { file: 'TomasNotations/checkers-normalized.svg', note: 'pre-normalised: init() stops early (fire 5)' },
  { file: 'TomasNotations/checkers-turkish.svg', note: 'PowerPoint; BoardGameNotation' },
  { file: 'TomasNotations/checkers-turkish-normalized.svg', note: 'pre-normalised (fire 5)' },
  { file: 'TomasNotations/cars.svg', note: 'PowerPoint; CarsNotation (unfinished: finds no cars, fire 15)' },
  { file: 'CamilleNotations/Example — animating a stack.svg', note: 'Affinity; AnimationNotation' },
  { file: 'CamilleNotations/anim-test.svg', note: 'Mathcha; AnimationNotation' },
  { file: 'CamilleNotations/Description of the notation.svg', note: 'Affinity; documentation that loads the engine' },
  { file: 'boxGraph-example.svg', note: 'Mathcha; BoxGraphOM: names never found, connections crash (fire 4)' },

  // Classic-layer demos (currently broken; fires 1, 13)
  { file: 'magic-red-id-test.svg', note: 'init() throws in the magic-red ID step (fire 1); symmetric connectors (Decision 4)' },
  { file: 'containment-stress-test.svg', note: 'init() throws in the magic-red ID step (fire 1)' },
  { file: 'notational-dispatch.svg', note: 'init() throws in the magic-red ID step (fire 1); blue meta-notation (fire 2)' },
  { file: 'solid-physics-test-2.svg', note: 'init() throws in the magic-red ID step (fire 1); then fire 6' },
  { file: 'solid-physics-test.svg', note: 'no omnimeta.js (fire 13)' },
  { file: 'hole-carving-test.svg', note: 'no omnimeta.js (fire 13)' },
  { file: 'labelGraph-example.svg', note: 'no omnimeta.js (fire 13)' },
  { file: 'id-vanilla.svg', note: 'no omnimeta.js (fires 9, 13)' },

  // Legacy, scratch and broken script references (fire 9)
  { file: 'boxGraph-bootstrap.svg', note: 'legacy engine copy' },
  { file: 'music.svg', note: 'loads missing general-containment.js' },
  { file: 'svgEdit.svg', note: 'loads missing general-containment.js' },
  { file: 'empty-console.svg', note: 'loads deleted probe.js; init() throws: no drawing, falls back to Mathcha (fire 15)' },
  { file: 'tmp.svg', note: 'scratch; init() throws on a whitespace text node (fire 15)' },

  // No scripts: documentation, notes and app assets (should just load)
  { file: 'principles/1-most-specialized-tag.svg' },
  { file: 'principles/2-dom-tree-spatial-containment.svg' },
  { file: 'principles/3-open-paths-connect-closed-shapes.svg' },
  { file: 'principles/4-open-paths-arrowhead-directed.svg' },
  { file: 'principles/5-stringify-paragraph-text.svg' },
  { file: 'principles/6-magic-red-boxes-backdoor.svg' },
  { file: 'rect-controls-wiring-diagram.svg' },
  { file: 'solid-physics-test-2-theory.svg' },
  { file: 'CamilleNotations/Extra ideas.svg' },
  { file: 'TomasNotations/CheckersApp/checkers.svg', note: 'iframe source for CheckersApp' },
  { file: 'TomasNotations/CarsApp/cars-spin.svg', note: 'iframe source for CarsApp' },
];
