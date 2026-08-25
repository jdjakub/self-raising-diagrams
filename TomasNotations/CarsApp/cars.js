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
//
//   scenery: [shapeId, ...] — shapes cloned from the referenced SVG and drawn
//            at their own position, exactly as the source SVG draws them.
//   objects: [{ id, segments, x, y }, ...] — everything that moves.
//              id       — the element's id in the referenced SVG
//              segments — the route, cut at its keyframes: one entry per leg,
//                         each PROGRESS_MAX + 1 points sampled evenly along
//                         that leg of the path (built by init, see below)
//              x, y     — where its reference point currently sits, derived
//                         from the clock rather than set by the host page
//   keyframe: which leg every object is currently driving — the index into
//             `segments`.
//   progress: how far along that leg, from 0 to PROGRESS_MAX.
//
// `keyframe`/`progress` are one shared clock, so every object reaches its own
// keyframe *k* at the same moment. Objects with fewer keyframes than others
// simply finish sooner and wait at their last stop.
//
// Time is a (keyframe, progress) pair rather than a single distance because
// legs take equal *time*, not equal distance: an object crosses a long leg
// faster than a short one, and they all meet up again at every keyframe.
//
// Unlike the checkers engine there is no grid: object coordinates are absolute
// positions in the referenced SVG's own user space.
// ---------------------------------------------------------------------------
const PROGRESS_MAX = 50;

function init(scenery, objects) {
  const prepared = objects.map(({ id, path, stops, facing = 0 }) =>
    ({ id, facing, segments: cutIntoSegments(path, stops) }));
  return { scenery, objects: positionAt(prepared, 0, 0), keyframe: 0, progress: 0 };
}

// ---------------------------------------------------------------------------
// UPDATE — pure: (state, event) -> new state.
//   'advance': move the clock on one tick.
// ---------------------------------------------------------------------------
function update(state, event) {
  switch (event.type) {
    case 'advance': {
      let { keyframe, progress } = state;
      progress += 1;
      // The last point of a leg is the first point of the next one, so roll
      // over at PROGRESS_MAX rather than past it and the motion stays even.
      if (progress >= PROGRESS_MAX) {
        keyframe += 1;
        progress = 0;
      }
      return { ...state, keyframe, progress, objects: positionAt(state.objects, keyframe, progress) };
    }
    default:
      return state;
  }
}

// Put each object where the clock says it is. An object that has run out of
// legs parks at the end of its last one.
function positionAt(objects, keyframe, progress) {
  return objects.map(object => {
    const { segments } = object;
    if (!segments || segments.length === 0) return object;

    const finished = keyframe >= segments.length;
    const leg = finished ? segments[segments.length - 1] : segments[keyframe];
    const { x, y, angle } = finished ? leg[leg.length - 1] : leg[progress];
    return { ...object, x, y, angle };
  });
}

// ---------------------------------------------------------------------------
// PRE-PROCESSING — turn an SVG path plus its keyframe markers into segments.
//
// The host page hands over the actual SVG elements; all the geometry happens
// here. For each marker we find how far along the path its nearest point lies,
// and consecutive distances give the legs of the journey: the object starts at
// the beginning of the path and drives from one keyframe to the next.
//
// Each leg is then sampled into PROGRESS_MAX + 1 points, so `progress` indexes
// straight into it and no geometry is needed at render time.
//
// The one expensive operation here is getPointAtLength: these routes are
// freehand, ~200 cubic Béziers each, and the browser walks the path from the
// start on every call, approximating each curve's arc length by subdivision.
// So the path is measured exactly once, into an evenly spaced table of points,
// and everything after that — finding keyframes, cutting legs — is arithmetic
// on that array.
// ---------------------------------------------------------------------------

// Distance between samples in the measurement table, in SVG units. Finer than
// the hand-placed markers are accurate, and far finer than the eye.
const TABLE_RESOLUTION = 5;

// How far either side of a point the heading is measured over, in SVG units.
// Bigger is steadier on freehand wobble, lazier through sharp corners.
const TANGENT_WINDOW = 40;

// A marker further than this from the path is almost certainly not on it — a
// good sign it was assigned to the wrong object by colour.
const MAX_STOP_OFFSET = 40;

function cutIntoSegments(path, stops) {
  const measured = measurePath(path);

  // Where each keyframe falls along the path, in travel order. Sorting by
  // distance means document order does not have to be travel order.
  const distances = stops
    .map(stop => nearestDistance(measured, centreOf(stop)))
    .sort((a, b) => a - b);

  // The journey starts at the path's beginning and ends at the last keyframe;
  // any tail of the path beyond it is not driven.
  const bounds = [0, ...distances];

  const segments = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    segments.push(sampleBetween(measured, bounds[i], bounds[i + 1]));
  }
  return segments;
}

// Walk the path once, at even distance intervals. Because the samples are
// evenly spaced, a distance maps straight to an index (d / step) with no
// searching. This is the only place that touches SVG geometry.
function measurePath(path) {
  const total = path.getTotalLength();
  const count = Math.max(1, Math.ceil(total / TABLE_RESOLUTION));

  const points = [];
  for (let i = 0; i <= count; i++) {
    const { x, y } = path.getPointAtLength(total * i / count);
    points.push({ x, y });
  }
  return { total, step: total / count, points };
}

// The centre of an element's bounding box — the same reference point
// placeShape() positions shapes by.
function centreOf(element) {
  const box = element.getBBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// The distance along a measured path whose point is nearest to `point`: a scan
// of the table, accurate to TABLE_RESOLUTION. Assumes the path does not cross
// itself, so there is only one nearest point to find.
function nearestDistance(measured, point) {
  const { step, points } = measured;
  let best = 0, bestOffset = Infinity;

  points.forEach((at, i) => {
    const offset = (at.x - point.x) ** 2 + (at.y - point.y) ** 2;
    if (offset < bestOffset) {
      bestOffset = offset;
      best = i;
    }
  });

  const offset = Math.sqrt(bestOffset);
  if (offset > MAX_STOP_OFFSET) {
    console.warn(`keyframe at (${Math.round(point.x)}, ${Math.round(point.y)}) is ${Math.round(offset)} from its path`);
  }
  return best * step;
}

// The point at `distance` along a measured path, interpolated between the two
// samples either side of it.
function pointAt(measured, distance) {
  const { step, points } = measured;
  const at = Math.max(0, Math.min(distance / step, points.length - 1));
  const lo = Math.floor(at);
  const hi = Math.min(lo + 1, points.length - 1);
  const t = at - lo;

  return {
    x: points[lo].x + (points[hi].x - points[lo].x) * t,
    y: points[lo].y + (points[hi].y - points[lo].y) * t,
  };
}

// The direction the path is heading at `distance`, in degrees clockwise from
// east — the angle to point a moving object along.
//
// Measured across a window rather than between neighbouring samples: these are
// freehand paths, so consecutive samples wobble and a tight tangent makes the
// object twitch. Widening the window trades responsiveness on sharp corners
// for steadiness everywhere else.
function angleAt(measured, distance) {
  const { step, points } = measured;
  const span = Math.max(1, Math.round(TANGENT_WINDOW / step));
  const centre = Math.max(0, Math.min(Math.round(distance / step), points.length - 1));

  const from = points[Math.max(0, centre - span)];
  const to = points[Math.min(points.length - 1, centre + span)];
  return Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
}

// One leg of the journey: evenly spaced points from `from` to `to`, each with
// the direction the path is heading there.
//
// The angle is sampled at every point rather than at the keyframes and
// interpolated, which keeps the object pointing along the road through bends
// between keyframes — and, since nothing interpolates angles, sidesteps the
// wrap-around at +/-180 entirely.
function sampleBetween(measured, from, to) {
  const points = [];
  for (let i = 0; i <= PROGRESS_MAX; i++) {
    const distance = from + (to - from) * i / PROGRESS_MAX;
    points.push({ ...pointAt(measured, distance), angle: angleAt(measured, distance) });
  }
  return points;
}

// ---------------------------------------------------------------------------
// Look up a shape *by id in the referenced SVG document* and clone it into the
// live game SVG — either where the source SVG draws it (cloneShape) or at a
// location of our choosing (placeShape).
//
// Point the game at a different SVG that defines the same ids and you get a
// different-looking game with no code changes.
// ---------------------------------------------------------------------------
function cloneShape(rulesDoc, shapeId) {
  const source = rulesDoc.getElementById(shapeId);
  if (!source) {
    console.warn(`shape "${shapeId}" not found in referenced SVG`);
    return null;
  }
  const clone = document.importNode(source, true);
  clone.removeAttribute('id'); // avoid duplicate ids in the live game SVG
  return h('g', {}, [clone]);
}

// Clone a shape, move it so its reference point lands on (x, y), and turn it
// by `rotation` degrees about that point. A shape's reference point is the
// centre of its bounding box in the referenced SVG, so placing a shape at its
// own reference point reproduces the source SVG exactly (getBBox() ignores
// stroke width, but that cancels out on the round trip).
function placeShape(rulesDoc, shapeId, x, y, rotation = 0) {
  const g = cloneShape(rulesDoc, shapeId);
  if (!g) return null;
  const box = rulesDoc.getElementById(shapeId).getBBox();
  const dx = x - (box.x + box.width / 2);
  const dy = y - (box.y + box.height / 2);

  // Read right to left: centre the shape first, then spin it about (x, y).
  const spin = rotation ? `rotate(${rotation}, ${x}, ${y}) ` : '';
  g.setAttribute('transform', `${spin}translate(${dx}, ${dy})`);
  return g;
}

// Copy the referenced SVG's <defs> into the game SVG. Cloned shapes carry
// references *into* defs — the background rect is filled with url(#pattern1),
// and that pattern in turn <use>s the embedded image #img0 — and those
// references only resolve within the document the shape now lives in.
//
// Ids are deliberately kept here (unlike cloneShape, which strips them): they
// are what url(#...) and href="#..." resolve against. The referenced SVG is in
// an iframe, so it is a separate document and nothing clashes.
function cloneDefs(rulesDoc) {
  return [...rulesDoc.querySelectorAll('defs')].map(defs => document.importNode(defs, true));
}

// ---------------------------------------------------------------------------
// VIEW — (state, dispatch, rulesDoc) -> SVGElement.
// Copies the referenced SVG's <defs>, draws the scenery where the source SVG
// draws it, then the objects at their own locations. All cloned by id.
// ---------------------------------------------------------------------------
function view(state, dispatch, rulesDoc) {
  const [width, height] = viewportOf(rulesDoc);

  // Defs first, so patterns/gradients/images referenced by the shapes resolve.
  const nodes = cloneDefs(rulesDoc);
  for (const shapeId of state.scenery) {
    const g = cloneShape(rulesDoc, shapeId);
    if (g) nodes.push(g);
  }
  // `facing` is the direction the shape is drawn pointing in the source SVG,
  // so the turn needed is the difference between that and its heading.
  for (const { id, x, y, angle, facing } of state.objects) {
    const g = placeShape(rulesDoc, id, x, y, angle - facing);
    if (g) nodes.push(g);
  }

  return h('svg', { width, height, viewBox: `0 0 ${width} ${height}` }, nodes);
}

// The game canvas matches the referenced SVG's own size, so replacing the SVG
// with a differently-sized one needs no code change.
function viewportOf(rulesDoc) {
  const root = rulesDoc.documentElement;
  const viewBox = root.getAttribute('viewBox');
  if (viewBox) {
    const [, , w, h] = viewBox.split(/[\s,]+/).map(Number);
    if (w && h) return [w, h];
  }
  return [Number(root.getAttribute('width')) || 1280,
          Number(root.getAttribute('height')) || 720];
}

// ---------------------------------------------------------------------------
// RUNTIME — the Elm-like loop. Holds state, exposes dispatch, and re-renders
// by replacing the entire SVG. `rulesDoc` is the referenced SVG the view reads
// shapes from.
//
// Returns `dispatch` so the host page can drive the loop from outside — a
// timer, a button, anything — the same way the view drives it from inside.
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
  return dispatch;
}

// The engine ends here. Game-specific setup (the scenery list) and the
// startGame() entry point live in the host page (cars.html).
