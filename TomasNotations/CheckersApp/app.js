'use strict';

// ---------------------------------------------------------------------------
// Tiny SVG element helper.
//   h('g', { transform: 't(...)', onclick: fn }, [children])
// Keys starting with 'on' become event listeners; everything else is an
// attribute. Keeps `view` declarative without a virtual DOM.
// ---------------------------------------------------------------------------
const SVG_NS = 'http://www.w3.org/2000/svg';

function h(tag, attrs = {}, children = []) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      el.setAttribute(key, value);
    }
  }
  for (const child of children) {
    el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

// ---------------------------------------------------------------------------
// MODEL — the whole game state is one plain object.
//   board:  array of [x, y, shapeId] triples — the static squares to draw.
//   pieces: array of [x, y, kind]    triples — the movable checker pieces.
//   rules:  array of move rules (see the rule-matching section below).
//   transforms: array of { piece, region, transform } — a `piece` landing in
//              `region` becomes `transform` (e.g. king promotion).
//   areas:  { regionName: [[x, y], ...] } — the cells each region covers.
//   wildcard: prefix marking wildcard tokens in rules (e.g. "any-"): "any-2"
//              matches any piece sharing the "-2" suffix (regular-2, king-2).
//   combinations: a state machine over rule `label`s. A move is a sequence of
//              rule applications the machine accepts (see applicableMoves).
//   selection: null, or { x, y, moves } — the piece the user picked and the
//              moves available to it (each { tx, ty, ghost, pieces }).
//   Both shapeId and kind are ids of elements in the referenced SVG.
// ---------------------------------------------------------------------------
function init(board, pieces, rules, transforms, areas, wildcard, combinations) {
  return { board, pieces, rules, transforms, areas, wildcard, combinations, selection: null };
}

// ---------------------------------------------------------------------------
// UPDATE — pure: (state, event) -> new state.
//   'click-piece'  { x, y }:      select the piece and gather its moves
//                                 (clicking the already-selected piece clears).
//   'commit-move'  { x, y, rule }: apply `rule` around (x, y), clear selection.
//   'deselect':                   clear any current selection.
// ---------------------------------------------------------------------------
function update(state, event) {
  switch (event.type) {
    case 'click-piece': {
      const { x, y } = event;
      const sel = state.selection;
      if (sel && sel.x === x && sel.y === y) {
        return { ...state, selection: null }; // toggle off
      }
      return { ...state, selection: { x, y, moves: applicableMoves(state, x, y) } };
    }
    case 'commit-move': {
      // The chosen move already carries the fully-resolved board (the whole
      // rule sequence applied and promotions settled) — just swap it in.
      return { ...state, pieces: event.pieces, selection: null };
    }
    case 'deselect':
      return state.selection ? { ...state, selection: null } : state;
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// RULE MATCHING
//
// A rule is { piece, before, after }. `before`/`after` are arrays of
// [x, y, content] triples with content being a piece kind or null (empty).
// Coordinates are *relative*: the rule's anchor is the cell in `before` whose
// content equals `rule.piece`, and all coordinates are interpreted relative to
// that anchor. When a piece is clicked, we align the anchor onto the clicked
// cell and test/apply every cell in the rule at the corresponding board cell.
//
// Kept deliberately small and location-oriented so more rules (jumps, kings,
// multi-cell patterns) can be added without touching the matching logic.
// ---------------------------------------------------------------------------

// The kind of piece occupying (x, y), or null if the cell is empty.
function pieceAt(pieces, x, y) {
  const found = pieces.find(([px, py]) => px === x && py === y);
  return found ? found[2] : null;
}

// Is (x, y) an actual board cell? (Works for non-rectangular boards too.)
function onBoard(board, x, y) {
  return board.some(([bx, by]) => bx === x && by === y);
}

// The [x, y] in `before` that holds the rule's own piece — the alignment anchor.
function ruleAnchor(rule) {
  const entry = rule.before.find(([, , content]) => content === rule.piece);
  return entry ? [entry[0], entry[1]] : null;
}

// Map a rule-relative cell onto the board, given the clicked cell (cx, cy)
// and the rule's anchor (ax, ay).
function toBoardCell(rx, ry, ax, ay, cx, cy) {
  return [cx + rx - ax, cy + ry - ay];
}

// Does the actual cell content satisfy a rule's expected `want`?
//   null                    -> the cell must be empty
//   "<wildcard><suffix>"    -> any piece sharing that suffix (e.g. "any-2"
//                              matches "regular-2" and "king-2")
//   anything else           -> an exact kind match
function contentMatches(actual, want, wildcard) {
  if (want == null) return actual === null;
  if (actual === null) return false;
  if (wildcard && want.startsWith(wildcard)) {
    const suffix = want.slice(wildcard.length);
    return actual === suffix || actual.endsWith('-' + suffix);
  }
  return actual === want;
}

// Does `rule` match the current board when its anchor is placed on (cx, cy)?
// Every cell in `before` must map onto a real board cell whose content
// satisfies the expected token (see contentMatches).
function ruleMatches(state, rule, cx, cy) {
  const anchor = ruleAnchor(rule);
  if (!anchor) return false;
  const [ax, ay] = anchor;
  return rule.before.every(([rx, ry, want]) => {
    const [bx, by] = toBoardCell(rx, ry, ax, ay, cx, cy);
    return onBoard(state.board, bx, by) &&
      contentMatches(pieceAt(state.pieces, bx, by), want, state.wildcard);
  });
}

// Apply `rule` around (cx, cy): overwrite each cell named in `after` with its
// new content (null clears the cell). Returns a new pieces array.
function applyRule(state, rule, cx, cy) {
  const [ax, ay] = ruleAnchor(rule);
  const changes = rule.after.map(([rx, ry, content]) => {
    const [bx, by] = toBoardCell(rx, ry, ax, ay, cx, cy);
    return { x: bx, y: by, content };
  });

  // Drop any piece sitting on a touched cell, then add the non-null results.
  const untouched = state.pieces.filter(([px, py]) => !changes.some(c => c.x === px && c.y === py));
  const added = changes.filter(c => c.content !== null).map(c => [c.x, c.y, c.content]);
  return [...untouched, ...added];
}

// Where the rule's own piece ends up (its destination cell on the board), by
// finding it in `after` and mapping through the same anchor alignment.
function ruleTarget(rule, cx, cy) {
  const [ax, ay] = ruleAnchor(rule);
  const dest = rule.after.find(([, , content]) => content === rule.piece);
  return dest ? toBoardCell(dest[0], dest[1], ax, ay, cx, cy) : null;
}

// All moves available to the piece at (x, y).
//
// A move is a *sequence* of rule applications accepted by the `combinations`
// state machine (transitions are [fromState, ruleLabel, toState]). Starting in
// the machine's initial state with the piece at (x, y), we follow every
// transition whose label has a rule that applies to the piece at its current
// location; applying it moves the same piece on (the anchor's new position is
// read back via ruleTarget). Whenever we enter a terminal state we have a
// legal final position — recorded with the fully-resolved board.
//
// Each result: { tx, ty, ghost, pieces } where `pieces` is the board after the
// whole sequence and promotions, and `ghost` is the kind to preview at (tx,ty).
function applicableMoves(state, x, y) {
  const fsm = state.combinations;
  const byCell = new Map();  // "tx,ty" -> result (dedupe overlapping endpoints)
  const seen = new Set();    // visited (machineState, location, board) — halts loops

  const record = (pieces, px, py) => {
    const settled = promoteAll(pieces, state.transforms, state.areas);
    const key = px + ',' + py;
    if (!byCell.has(key)) {
      byCell.set(key, { tx: px, ty: py, ghost: pieceAt(settled, px, py), pieces: settled });
    }
  };

  const walk = (machineState, pieces, px, py) => {
    const visitKey = machineState + '@' + px + ',' + py + '#' + JSON.stringify(pieces);
    if (seen.has(visitKey)) return;
    seen.add(visitKey);

    for (const [from, label, to] of fsm.transitions) {
      if (from !== machineState) continue;
      for (const rule of state.rules) {
        if (rule.label !== label) continue;
        const local = { ...state, pieces };
        if (!ruleMatches(local, rule, px, py)) continue;
        const target = ruleTarget(rule, px, py);
        if (!target) continue;
        const next = applyRule(local, rule, px, py);
        const [nx, ny] = target;
        if (fsm.terminal.includes(to)) record(next, nx, ny);
        walk(to, next, nx, ny);
      }
    }
  };

  walk(fsm.initial, state.pieces, x, y);
  return [...byCell.values()];
}

// ---------------------------------------------------------------------------
// PROMOTION — a piece landing in a region transforms into another kind.
// Data-driven from `transforms` ({ piece, region, transform }) and `areas`
// ({ region: [[x, y], ...] }). No movement logic here; movement rules for the
// promoted kinds are added separately.
// ---------------------------------------------------------------------------

// The kind that `kind` becomes if it sits on (x, y); unchanged if no transform
// applies there.
function promotedKind(kind, x, y, transforms, areas) {
  for (const t of transforms) {
    const region = areas[t.region] || [];
    if (t.piece === kind && region.some(([ax, ay]) => ax === x && ay === y)) {
      return t.transform;
    }
  }
  return kind;
}

// Re-evaluate every piece's kind against the promotion rules. Idempotent:
// already-promoted pieces aren't listed as a transform source, so they stay.
function promoteAll(pieces, transforms, areas) {
  return pieces.map(([x, y, kind]) => [x, y, promotedKind(kind, x, y, transforms, areas)]);
}

// Look up a shape *by id in the referenced SVG document*, clone it, and place
// it centered in cell (x, y). Returns a <g>, or null if the id is missing.
// opts: { onClick, opacity }. Swap in a different SVG (with the same ids) and
// you get a different-looking game with no code changes.
function placeShape(rulesDoc, shapeId, x, y, S, opts = {}) {
  const source = rulesDoc.getElementById(shapeId);
  if (!source) {
    console.warn(`shape "${shapeId}" not found in referenced SVG`);
    return null;
  }
  // Clone across documents (importNode adopts the node into this document).
  const clone = document.importNode(source, true);
  clone.removeAttribute('id'); // avoid duplicate ids in the live game SVG

  // Neutralise the shape's own position (box.x/box.y) and center it in the
  // cell (shapes such as pieces are smaller than a square).
  const box = source.getBBox();
  const dx = x * S + (S - box.width) / 2 - box.x;
  const dy = y * S + (S - box.height) / 2 - box.y;

  const attrs = { transform: `translate(${dx}, ${dy})` };
  if (opts.opacity != null) attrs.opacity = opts.opacity;
  if (opts.onClick) {
    attrs.onclick = opts.onClick;
    attrs.style = 'cursor: pointer';
  }
  return h('g', attrs, [clone]);
}

// ---------------------------------------------------------------------------
// VIEW — (state, dispatch, rulesDoc) -> SVGElement.
// Draws board squares, then pieces, then the selection overlay (halo + ghost
// destinations). Everything is cloned from the referenced SVG by id.
// ---------------------------------------------------------------------------
function view(state, dispatch, rulesDoc) {
  console.log("%cSTATE: %O", "color:#80a030;", state);
  // Cell size is taken from a board square itself, so the grid adapts to
  // whatever the referenced SVG uses.
  const firstShape = rulesDoc.getElementById(state.board[0][2]);
  const S = firstShape ? firstShape.getBBox().width : 46;

  const nodes = [];

  // Board squares (bottom layer). No handler: a click here bubbles to the svg
  // and deselects.
  for (const [x, y, shapeId] of state.board) {
    const g = placeShape(rulesDoc, shapeId, x, y, S);
    if (g) nodes.push(g);
  }

  // Pieces. Clicking one selects it (stopPropagation so it doesn't deselect).
  for (const [x, y, kind] of state.pieces) {
    const g = placeShape(rulesDoc, kind, x, y, S, {
      onClick: (e) => { e.stopPropagation(); dispatch({ type: 'click-piece', x, y }); },
    });
    if (g) nodes.push(g);
  }

  // Selection overlay (top layer): a halo on the picked piece and a translucent
  // ghost on each destination. Clicking a ghost commits that move.
  if (state.selection) {
    const { x, y, moves } = state.selection;
    nodes.push(h('rect', {
      x: x * S, y: y * S, width: S, height: S,
      fill: 'none', stroke: '#2563eb', 'stroke-width': 3, 'pointer-events': 'none',
    }));
    for (const { tx, ty, ghost, pieces } of moves) {
      const g = placeShape(rulesDoc, ghost, tx, ty, S, {
        opacity: 0.45,
        onClick: (e) => { e.stopPropagation(); dispatch({ type: 'commit-move', pieces }); },
      });
      if (g) nodes.push(g);
    }
  }

  const size = 8 * S;
  return h('svg', {
    width: size, height: size, viewBox: `0 0 ${size} ${size}`,
    onclick: () => dispatch({ type: 'deselect' }),
  }, nodes);
}

// ---------------------------------------------------------------------------
// RUNTIME — the Elm-like loop. Holds state, exposes dispatch, and re-renders
// by replacing the entire SVG. `rulesDoc` is the referenced SVG the view reads
// shapes from.
// ---------------------------------------------------------------------------
function run(mount, app, rulesDoc) {
  let state = app.init();

  function dispatch(event) {
    state = app.update(state, event);
    render();
  }

  function render() {
    mount.replaceChildren(app.view(state, dispatch, rulesDoc));
  }

  render();
}

// The engine ends here. Game-specific setup (board, pieces, rules, transforms,
// areas) and the startGame() entry point live in the host page (index.html).
