/* ### UTILITIES ### */

// For entering the debugger in a JS console statement. Add it as a dummy param
// or use it to wrap a param in a function call so it evaluates first.
// E.g: I want to step through the execution of `foo(1, 2, 3)`.
// So I put: `foo(1, 2, DEBUG(3))` or `foo(1, 2, 3, DEBUG())`.
DEBUG = (x) => { debugger; return x; };
// `last([1,2,3])` = 3, `last([1,2,3], 2)` = 2
last = (arr, n) => arr[arr.length-(n || 1)];
// Interpose anywhere in an expression to transparently probe its value.
// E.g. `foo(1, bar(x)*baz(y))` - I wonder what the 2nd argument is.
// So I put: `foo(1, log(bar(x)*baz(y)))`
log = (...args) => { console.log(...args); return last(args); };

attr_single = (elem, key, val_or_func) => {
  let old;
  if (key === 'textContent') old = elem.textContent;
  else old = elem.getAttribute(key);

  let value = typeof(val_or_func) === 'function' ? val_or_func(old) : val_or_func;
  if (key === 'textContent') elem.textContent = value;
  else if (value !== undefined) elem.setAttribute(key, value);

  return old;
};

// e.g. attr(rect, {stroke_width: 5, stroke: 'red'})
//      attr(rect, 'stroke', 'red')
//      attr(rect, 'height', h => h+32)
//      attr(rect, {fill: 'orange', height: h => h+32})
attr = (elem, key_or_dict, val_or_nothing) => {
  if (typeof(key_or_dict) === 'string') {
    let key = key_or_dict;
    let value = val_or_nothing;
    return attr_single(elem, key, value);
  } else {
    let dict = key_or_dict;
    for (let [k,v_or_f] of Object.entries(dict)) {
      let key = k.replace('_','-');
      attr_single(elem, key, v_or_f);
    }
  }
}

nums = (arr) => arr.map(x => +x);
attrs = (el, ...keys) => keys.map(k => attr(el, k));
props = (o,  ...keys) => keys.map(k => o[k]);

svg_parent = document.querySelector('svg'); // Default parent for new SVG elements
svg = svg_parent;

create_element = (tag, attrs, parent, namespace) => {
  let elem = document.createElementNS(namespace, tag);
  if (attrs !== undefined) attr(elem, attrs);
  if (parent === undefined) parent = svg_parent;
  parent.appendChild(elem);
  return elem;
};

// e.g. rect = svgel('rect', {x: 5, y: 5, width: 5, height: 5}, svg)
svgel = (tag, attrs, parent) => create_element(tag, attrs, parent, 'http://www.w3.org/2000/svg');

whereis = (pt_or_x,maybe_y) => {
  let [cx,cy] = [pt_or_x, maybe_y];
  if (cy === undefined) {
    [cx,cy] = pt_or_x;
  }
  return svgel('circle', {cx, cy, r: 5, style: 'fill: magenta', class: 'debug-pt'});
}

whereare = (pts) => pts.forEach(pt=>whereis(pt));

cleardbgpts = () => all('.debug-pt').forEach(pt=>pt.remove());

showpts = pts => pts.map(pt => pt.map(x=>x.toPrecision(3)).join(',')).join(' ');

// Used to ensure no "3.68564e-14" stuff cluttering up the inspector
// Revisit in future if tiny numbers ever become relevant
legible = (...nums) => nums.map(n => Math.abs(n) < 0.001 ? 0 : +n.toFixed(3));

function isNearIdentity(matrix, eps = 1e-3) {
  const {a, b, c, d} = matrix;
  return Math.abs(a - 1) < eps &&
         Math.abs(b) < eps &&
         Math.abs(c) < eps &&
         Math.abs(d - 1) < eps;
}

inTopToBottomOrder = (a, b) => {
  if (a === b) return 0;
  return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : -1;
}

depthOf = el => {
  let d = 0;
  while (el.parentElement) {
    d++;
    el = el.parentElement;
  }
  return d;
};

toJSish = function(obj, indent = 0) {
  let s = JSON.stringify(obj, null, indent)
    .replace(/"([a-zA-Z_$][a-zA-Z0-9_$]*)":/g, '$1: ')
    .replace(/(":)(?=(?:[^"]*"[^"]*")*[^"]*$)/g, '$1 ');
  s = s.replace(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g, ', ');
  s = s.replace(/\{(?=(?:[^"]*"[^"]*")*[^"]*$)(?!\})/g, '{ ');
  s = s.replace(/(?<!\{)\}(?=(?:[^"]*"[^"]*")*[^"]*$)/g, ' }');
  return s;
}

vadd = ([a, b], [c, d]) => [a+c, b+d];
vsub = ([a, b], [c, d]) => [a-c, b-d];
vdot = ([a, b], [c, d]) => a*c + b*d;
vwedge = ([a, b], [c, d]) => a*d - b*c;
vmul = (k, [a,b]) => [k*a, k*b];
vcmul = ([ka,kb],[a,b]) => [ka*a,kb*b];
vmax = (x, [a,b]) => [Math.max(x,a),Math.max(x,b)];
dist2 = ([x,y],[z,w]) => (z-x)**2 + (w-y)**2;
vnormed = v => vmul(1/Math.sqrt(vdot(v,v)), v);
vswap = ([x,y]) => [y,x];
vmag = v => Math.sqrt(vdot(v,v));
vmid = (u,v) => vmul(0.5, vadd(u, v));

vinbasis = (e1,e2) => v => {
  const e1_w_e2 = vwedge(e1, e2);
  const v_w_e1 = vwedge(v, e1);
  const v_w_e2 = vwedge(v, e2);
  return [v_w_e2 / e1_w_e2, -v_w_e1 / e1_w_e2];
};

isvec = (...xs) => xs.every(x => x instanceof Array);

// Polymorphic arith functions to which Descartes compiles
add2 = (a, b) => isvec(a, b) ? vadd(a, b) : (a+b);
sum = (x, ...xs) => xs.reduce(add2, x);
add = sum;
sub2 = (a, b) => isvec(a, b) ? vsub(a, b) : (a-b);
sub = (x, ...xs) => xs.reduce(sub2, x);
dot = vdot;
wedge = (x, ...xs) => xs.reduce(vwedge, x);
mul2 = (a, b) => isvec(a) ? vmul(b,a) : isvec(b) ? vmul(a,b) : (a*b);
mul = (x, ...xs) => xs.reduce(mul2, x);
div2 = (a, b) => mul2(1/b, a);
div = (x, ...xs) => xs.reduce(div2, x);
neg = x => mul2(-1, x);
mag = x => isvec(x) ? vmag(x) : Math.abs(x);
// TODO: the rest

vtoa = ([x,y]) => x + ',' + y;
atov = s => s ? s.split(',').map(Number.parseFloat) : undefined;

currentScope = document;
restrictScope = function(element) {
  const oldScope = currentScope;
  currentScope = element;
  return oldScope;
}
all = selector => Array.from(currentScope.querySelectorAll(selector));
some = selector => {
  const tmp = all(selector);
  if (tmp.length === 0) return null;
  return tmp[0];
}
// wrapped so that FF doesn't display an annoying warning when typing
// in console "empty thing passed to getElementById" due to eager preview
byId = id => id ? document.getElementById(id) : undefined;

// Thanks https://stackoverflow.com/a/65090521
cloneNode = function(node, tag) {
  const clone = svgel(tag, {});
  for (const attr of node.attributes)
    clone.setAttributeNode(attr.cloneNode());
  while (node.firstChild)
    clone.appendChild(node.firstChild);
  return clone;
}

replaceTag = function(node, tag) {
  const clone = cloneNode(node, tag);
  node.replaceWith(clone);
  return clone;
}

addSetAttr = function(obj, prop, newItem) {
  if (obj[prop] === undefined) obj[prop] = ' ';
  if (obj[prop].indexOf(' '+newItem+' ') === -1)
    obj[prop] += newItem + ' ';
}

setAttrHas = function(obj, prop, item) {
  return obj[prop] === undefined || obj[prop].indexOf(' '+item+' ') !== -1;
}

removeFromSetAttr = function(obj, prop, item) {
  obj[prop] = obj[prop].replace(' '+item+' ', ' ');
}

setAttrToArray = function(setAttr) {
  return setAttr ? setAttr.trim().split(' ') : [];
}

// Mathcha SVG outputs simple shapes as paths and multiline text as separate text elements...
// Gotta recognise basic shapes. Computer Vector Vision
const CMD_ARITY = { M:2, m:2, L:2, l:2, C:6, c:6, Q:4, q:4, S:4, s:4, T:2, t:2 };
const NUM_RE = /[+-]?(?:\d+\.\d+|\.\d+|\d+)(?:[eE][+-]?\d+)?/g;
// Handles implicit cmds (M p1 p2 p3 ... => M p1 L p2 L p3 ...)
// and annoying delimiters (e.g. M12-5-4 6 => M 12 -5 -4 6)
parsePath = d =>
  [...d.matchAll(/([MLCQSTZmlcqstz])([^MLCQSTZmlcqstz]*)/g)]
  .flatMap(([_, cmd, args]) => {
    if (cmd === 'Z' || cmd === 'z') return [[cmd]];
    const nums = (args.match(NUM_RE) || []).map(Number);
    const arity = CMD_ARITY[cmd];
    const groups = [];
    for (let i = 0; i < nums.length; i += arity) {
      groups.push(nums.slice(i, i + arity));
    }
    const implicitCmd = cmd === 'M' ? 'L' : cmd === 'm' ? 'l' : cmd;
    return groups.map((g, i) => {
      const pts = [];
      for (let j = 0; j < g.length; j += 2) pts.push([g[j], g[j+1]]);
      return [i === 0 ? cmd : implicitCmd, ...pts];
    });
  });

extractPathCmds = function(pathElt) {
  const d = pathElt.getAttribute('d').trim();
  const cmds = parsePath(d);
  const opcodes = cmds.map(c => c[0]).join('');
  const unwrap = arr => arr.length === 1 ? arr[0] : arr.length ? arr : [];
  const xs = cmds.map(cmd => unwrap(cmd.slice(1).map(p => p[0])));
  const ys = cmds.map(cmd => unwrap(cmd.slice(1).map(p => p[1])));
  return [opcodes,xs,ys];
}

/*
<path class="real"
d=" M_,cy
    C_,_ _,_ cx,ty
    ___"
style="stroke-width: 1px;
           fill: none;
           fill-opacity: 1;"/>
---
<circle class="real"
cx="#{cx}" cy="#{cy}" r="#{cy-ty}"
style="stroke-width: 1px;
           stroke: #141313;
           fill: none;
           fill-opacity: 1;"/>
*/
// Tested via Mathcha and Powerpoint
extractEllipse = function(pathElt) {
  const [opcodes,xs,ys] = extractPathCmds(pathElt);
  if (opcodes !== 'MCCCCZ') return;
  const cy = ys[0];
  const cx = xs[1][2];
  const ty = ys[1][2];
  const r = cy-ty;
  // Now check that the other 3 "radii" are equal; don't circlify ellipses
  const lx = xs[0];
  const lr = cx-lx;
  const rx = xs[2][2];
  const rr = rx-cx;
  let isEllipse = true;
  if (Math.abs(rr - lr) > 0.01) isEllipse = false; // SMELL epsilon
  const by = ys[3][2];
  const br = by - cy;
  if (Math.abs(br - r) > 0.01) isEllipse = false; // SMELL espilon
  if (isEllipse) return {cx, cy, rx: legible(lr), ry: legible(r)};
  else return null;
}

// TY Claude
function isPointInPolygon(pt, poly) {
  // HACK! so that points ON the edge count as inside, suck point by epsilon towards center
  const center = vmul(1/poly.length, poly.reduce((sum,v) => vadd(sum,v)));
  const pt_to_center = vsub(center, pt);
  const small_delta = vmul(0.00001, pt_to_center);
  const [x,y] = vadd(pt, small_delta);
  let inside = false;
  // Cast a ray from the point to the right (along +x direction)
  // Count how many times it crosses polygon edges
  for (let i=0, j=poly.length-1; i<poly.length; j=i++) {
    // each poly edge [i,j] = [0,-1], [1,0], [2,1], etc...
    const [xi,yi] = poly[i]; const [xj,yj] = poly[j];
    // Check if the edge crosses the horizontal ray from the point
    // The edge must:
    // 1. Have one vertex above and one below the point's y coordinate
    // 2. Intersect the ray to the right of the point
    const ray_y_from_i = y - yi;
    const j_y_from_i = yj - yi;
    const j_x_from_i = xj - xi;
    const edge_x_per_y = j_x_from_i / j_y_from_i;
    const isect_x_from_i = ray_y_from_i * edge_x_per_y;
    const isect_x = xi + isect_x_from_i;
    const mightIntersect = (yi > y) !== (yj > y);
    const intersect = mightIntersect && isect_x >= x;
    if (intersect) inside = !inside;
  }
  return inside;
}

function closest_pt_on_line_seg(pt, seg_p1, seg_p2) {
  const p1_to_pt = vsub(pt, seg_p1);
  const p1_to_p2 = vsub(seg_p2, seg_p1);
  const denom = vdot(p1_to_p2, p1_to_p2);
  if (denom === 0) return seg_p1;
  let pt_proj_0_to_1 = vdot(p1_to_pt, p1_to_p2) / denom;
  pt_proj_0_to_1 = Math.min(Math.max(pt_proj_0_to_1, 0), 1); // Clamp [0,1]
  const closest_pt = vadd(seg_p1, vmul(pt_proj_0_to_1, p1_to_p2));
  return closest_pt;
}

function distance2_pt_to_line_seg(pt, seg_p1, seg_p2) {
  const p = closest_pt_on_line_seg(pt, seg_p1, seg_p2);
  const pt_to_p = vsub(p, pt);
  return vdot(pt_to_p, pt_to_p);
}

function distance2_line_seg_to_seg(seg1_p1, seg1_p2, seg2_p1, seg2_p2) {
  const seg1_p1_to_seg2 = distance2_pt_to_line_seg(seg1_p1, seg2_p1, seg2_p2);
  const seg1_p2_to_seg2 = distance2_pt_to_line_seg(seg1_p2, seg2_p1, seg2_p2);
  const seg2_p1_to_seg1 = distance2_pt_to_line_seg(seg2_p1, seg1_p1, seg1_p2);
  return Math.min(seg1_p1_to_seg2, seg1_p2_to_seg2, seg2_p1_to_seg1);
}

function closest_line_seg_to_pt(pt, segs) {
  let min_dist2_so_far = Infinity;
  let closest_seg_so_far = null;
  for (const seg of segs) {
    const d2 = distance2_pt_to_line_seg(pt, seg[0], seg[1]);
    if (d2 < min_dist2_so_far) {
      min_dist2_so_far = d2;
      closest_seg_so_far = seg;
    }
  }
  return closest_seg_so_far;
}

function distance2_line_segs_to_segs(segs1, segs2) {
  let min_dist2_so_far = Infinity;
  for (const seg1 of segs1) {
    for (const seg2 of segs2) {
      const d2 = distance2_line_seg_to_seg(seg1[0], seg1[1], seg2[0], seg2[1]);
      if (d2 < min_dist2_so_far) min_dist2_so_far = d2;
    }
  }
  return min_dist2_so_far;
}

function explode_poly_segs(points, closed=true) {
  const segs = [];
  for (let i=1; i<points.length; i++) {
    segs.push([points[i-1], points[i]]);
  }
  if (closed) segs.push([last(points), points[0]]);
  return segs;
}

function normal_for_seg([p1,p2]) {
  const [vx,vy] = vnormed(vsub(p2,p1));
  return [-vy,vx];
}

polysFromPath = function(cmds) {
  const polys = [];
  let vertices = null;

  cmds.forEach(([c,v]) => {
    switch (c) {
      case 'M':
        vertices = [ v ];
        polys.push(vertices);
        break;
      case 'm':
        vertices = [ vertices ? vadd(last(vertices), v) : v ];
        polys.push(vertices);
        break;
      case 'L': vertices.push(v); break;
      case 'l': vertices.push(vadd(last(vertices),v)); break;
      case 'Z': case 'z': break;
    }
  });

  return polys;
}

Array.prototype.thatWhichMinimizes = function(funcToMinimize) {
  let min_so_far = [null,Infinity];
  for (let x of this) {
    const value = funcToMinimize(x);
    if (value < min_so_far[1]) min_so_far = [x,value];
  }
  return min_so_far[0];
}

Array.prototype.thatWhichMaximizes = function(funcToMaximize) {
  let max_so_far = [null,-Infinity];
  for (let x of this) {
    const value = funcToMaximize(x);
    if (value > max_so_far[1]) max_so_far = [x,value];
  }
  return max_so_far[0];
}

// TY Claude
function closestPointOnPath(path, [px,py], coarseSamples = 50, refinements = 10) {
  const totalLength = path.getTotalLength();
  
  function distAt(t) {
    const pt = path.getPointAtLength(t);
    const dx = pt.x - px;
    const dy = pt.y - py;
    return dx * dx + dy * dy;
  }
  
  // Coarse pass
  let bestT = 0;
  let bestDist = Infinity;
  for (let i = 0; i <= coarseSamples; i++) {
    const t = (i / coarseSamples) * totalLength;
    const dist = distAt(t);
    if (dist < bestDist) {
      bestDist = dist;
      bestT = t;
    }
  }
  
  // Refine with golden section search
  const phi = (1 + Math.sqrt(5)) / 2;
  let lo = Math.max(0, bestT - totalLength / coarseSamples);
  let hi = Math.min(totalLength, bestT + totalLength / coarseSamples);
  
  for (let i = 0; i < refinements; i++) {
    const mid1 = hi - (hi - lo) / phi;
    const mid2 = lo + (hi - lo) / phi;
    if (distAt(mid1) < distAt(mid2)) {
      hi = mid2;
    } else {
      lo = mid1;
    }
  }
  
  const finalT = (lo + hi) / 2;
  const finalPt = path.getPointAtLength(finalT);
  
  return {
    point: [finalPt.x, finalPt.y],
    d2: distAt(finalT)
  };
}

// Clip polygon `subject` against the half-plane defined by the directed edge
// from `edgeA` to `edgeB`.  Points on or to the left of (edgeA→edgeB) are
// considered "inside".  Returns the clipped polygon (possibly empty).
function clip_poly_by_half_plane(subject, edgeA, edgeB) {
  if (subject.length === 0) return [];

  // Signed "which side" test.  Positive ⟹ left of / on the directed edge.
  const side = (pt) => {
    const [ex, ey] = vsub(edgeB, edgeA);   // edge direction
    const [px, py] = vsub(pt,    edgeA);   // pt relative to edge start
    return ex * py - ey * px;              // 2-D cross product
  };

  // Intersection of segment (a→b) with the infinite line through edgeA→edgeB.
  const intersect = (a, b) => {
    const [dx, dy] = vsub(b, a);
    const [ex, ey] = vsub(edgeB, edgeA);
    let denom = ex * dy - ey * dx;
    denom = -denom; // HACK! Empirically needed to work ... what's wrong...
    // Parallel lines — caller guarantees this won't be reached when denom ≈ 0
    const t = (ex * (a[1] - edgeA[1]) - ey * (a[0] - edgeA[0])) / denom;
    return vadd(a, vmul(t, [dx, dy]));
  };

  const output = [];
  for (let i = 0; i < subject.length; i++) {
    const current  = subject[i];
    const previous = subject[(i + subject.length - 1) % subject.length];
    const currentInside  = side(current)  >= 0;
    const previousInside = side(previous) >= 0;

    if (previousInside && currentInside) {
      // Both inside: keep current.
      output.push(current);
    } else if (previousInside && !currentInside) {
      // Leaving: emit the crossing point.
      output.push(intersect(previous, current));
    } else if (!previousInside && currentInside) {
      // Entering: emit crossing point then current.
      output.push(intersect(previous, current));
      output.push(current);
    }
    // Both outside: emit nothing.
  }
  return output;
}

// Return the intersection polygon of two convex polygons, or null if they
// do not overlap.  Both polygons must be given as arrays of [x, y] vertices
// in *counter-clockwise* order (the standard mathematical convention).
// (Mathcha exports clockwise polygons, so callers may need to reverse first —
//  see convex_poly_verts_ccw below.)
//
// Algorithm: Sutherland-Hodgman.  Clip the subject polygon successively
// against each directed edge of the clip polygon.  Each edge defines a
// half-plane; a convex polygon is the intersection of its half-planes.
function convex_polys_intersection(polyA, polyB) {
  // polyA is the subject; polyB supplies the clipping half-planes.
  let clipped = polyA.slice();

  for (let i = 0; i < polyB.length; i++) {
    if (clipped.length === 0) return null;   // Clipped away entirely.
    const edgeA = polyB[i];
    const edgeB = polyB[(i + 1) % polyB.length];
    clipped = clip_poly_by_half_plane(clipped, edgeA, edgeB);
  }

  return clipped.length === 0 ? null : clipped;
}

// Helper: ensure a polygon's vertices are in CCW order.
// Pass the result to convex_polys_intersection when your source (e.g. Mathcha)
// gives CW vertices.
function convex_poly_verts_ccw(verts) {
  // Compute the signed area via the shoelace formula.
  // Positive ⟹ already CCW; negative ⟹ CW, so reverse.
  let signed_area = 0;
  for (let i = 0; i < verts.length; i++) {
    const [x1, y1] = verts[i];
    const [x2, y2] = verts[(i + 1) % verts.length];
    signed_area += (x1 * y2 - x2 * y1);
  }
  return signed_area >= 0 ? verts.slice() : verts.slice().reverse();
}

// Returns true if open segments (p1,p2) and (p3,p4) intersect (excluding shared endpoints).
function line_segs_intersect(p1, p2, p3, p4) {
  const d1 = vsub(p2, p1);
  const d2 = vsub(p4, p3);
  const denom = d1[0]*d2[1] - d1[1]*d2[0];   // cross product of direction vectors
  if (Math.abs(denom) < 1e-10) return false;   // parallel or collinear — treat as non-intersecting
  const d3 = vsub(p3, p1);
  const t = (d3[0]*d2[1] - d3[1]*d2[0]) / denom;
  const u = (d3[0]*d1[1] - d3[1]*d1[0]) / denom;
  return t > 0 && t < 1 && u > 0 && u < 1;    // strict: endpoints touching not counted
}

// Returns true if segment (p1, p2) intersects polygon `poly` (given as [x,y] vertex array).
// "Intersects" includes the segment being fully inside the polygon.
// `poly` is assumed closed; vertices need not be in any particular winding order.
function line_seg_intersects_poly(p1, p2, poly) {
  const edges = explode_poly_segs(poly, /*closed=*/true);
  if (edges.some(([a, b]) => line_segs_intersect(p1, p2, a, b))) return true;
  return isPointInPolygon(p1, poly);
}

// Returns the [x,y] point where the ray (origin: ray_start, direction: ray_dir)
// first hits an edge of `poly`, or null if it misses entirely.
// Works from inside or outside the polygon.
function rayPolyHit(poly, ray_start, ray_dir) {
  let best_t = Infinity;

  for (const [a, b] of explode_poly_segs(poly, /*closed=*/true)) {
    const edge = vsub(b, a);
    const denom = ray_dir[0]*edge[1] - ray_dir[1]*edge[0];
    if (Math.abs(denom) < 1e-10) continue;   // ray parallel to edge

    const d = vsub(a, ray_start);
    const t = (d[0]*edge[1]  - d[1]*edge[0])  / denom;  // ray parameter
    const u = (d[0]*ray_dir[1] - d[1]*ray_dir[0]) / denom;  // edge parameter

    if (t > 1e-10 && u >= 0 && u <= 1 && t < best_t) best_t = t;
  }

  return best_t === Infinity ? null : vadd(ray_start, vmul(best_t, ray_dir));
}


// TY Claude
bezEval = function(p0,c1,c2,p1,t) {
  const mt = 1-t;
  return [
    mt*mt*mt*p0[0] + 3*mt*mt*t*c1[0] + 3*mt*t*t*c2[0] + t*t*t*p1[0],
    mt*mt*mt*p0[1] + 3*mt*mt*t*c1[1] + 3*mt*t*t*c2[1] + t*t*t*p1[1]
  ];
}

// chord-length parameterisation of pts[first..last], normalised to [0,1]
chordParams = function(pts, first, last) {
  const u = [0];
  for (let i = first+1; i <= last; i++) u.push(u[u.length-1] + vmag(vsub(pts[i], pts[i-1])));
  const total = u[u.length-1];
  return u.map(x => x/total);
}

// least-squares fit of one cubic to pts[first..last] with given end tangents
generateBezier = function(pts, first, last, u, tHat1, tHat2) {
  const p0 = pts[first], p1 = pts[last];
  const n = last - first + 1;
  let c00=0, c01=0, c11=0, x0=0, x1=0;
  for (let i = 0; i < n; i++) {
    const t = u[i], mt = 1-t;
    const b0 = mt*mt*mt, b1 = 3*mt*mt*t, b2 = 3*mt*t*t, b3 = t*t*t;
    const a0 = vmul(b1, tHat1), a1 = vmul(b2, tHat2);
    c00 += vdot(a0,a0); c01 += vdot(a0,a1); c11 += vdot(a1,a1);
    const tmp = vsub(pts[first+i], vadd(vmul(b0+b1, p0), vmul(b2+b3, p1)));
    x0 += vdot(a0, tmp); x1 += vdot(a1, tmp);
  }
  const det = c00*c11 - c01*c01;
  let alphaL, alphaR;
  if (Math.abs(det) < 1e-12) { alphaL = alphaR = 0; }
  else { alphaL = (x0*c11 - x1*c01)/det; alphaR = (c00*x1 - c01*x0)/det; }
  // degenerate solution -> Wu/Barsky heuristic
  const segLen = vmag(vsub(p1,p0));
  if (alphaL < 1e-6*segLen || alphaR < 1e-6*segLen) alphaL = alphaR = segLen/3;
  return [p0, vadd(p0, vmul(alphaL, tHat1)), vadd(p1, vmul(alphaR, tHat2)), p1];
}

maxError = function(pts, first, last, bez, u) {
  let maxDist = 0, splitAt = Math.floor((first+last)/2);
  for (let i = first+1; i < last; i++) {
    const q = bezEval(bez[0],bez[1],bez[2],bez[3], u[i-first]);
    const dist = vmag(vsub(q, pts[i]));
    if (dist > maxDist) { maxDist = dist; splitAt = i; }
  }
  return [maxDist, splitAt];
}

fitCubic = function(pts, first, last, tHat1, tHat2, tol, out) {
  if (last - first === 1) {   // only two points: straight-line heuristic
    const d = vmag(vsub(pts[last], pts[first]))/3;
    out.push([vadd(pts[first], vmul(d,tHat1)), vadd(pts[last], vmul(d,tHat2)), pts[last]]);
    return;
  }
  const u = chordParams(pts, first, last);
  const bez = generateBezier(pts, first, last, u, tHat1, tHat2);
  const [err, splitAt] = maxError(pts, first, last, bez, u);
  if (err < tol) { out.push([bez[1], bez[2], bez[3]]); return; }
  // split at worst point; centred-difference tangent there
  const tHatC = vnormed(vsub(pts[splitAt-1], pts[splitAt+1]));
  fitCubic(pts, first, splitAt, tHat1, tHatC, tol, out);
  fitCubic(pts, splitAt, last, vmul(-1,tHatC), tHat2, tol, out);
}

/**
 * fitPathElement(pathElt, tolerance, sampleSpacing) -> new "d" string
 *
 * Simplifies and de-jitters a hand-drawn path by fitting cubic Beziers
 * adaptively: one long segment across a large smooth sweep, several short
 * ones through a tight turn. Segment placement follows curvature, not arc
 * length, so the output has no more segments than the shape actually needs.
 *
 * - tolerance: the only perceptual knob. Maximum distance (in path units)
 *   the simplified curve may stray from the original. Jitter with amplitude
 *   below this is absorbed for free — the fit is not obliged to chase
 *   deviations it is permitted to ignore — while genuine large-scale shape
 *   is preserved to within the same bound. Raising it yields fewer, longer
 *   segments and a looser fit; lowering it tracks the original more closely
 *   at the cost of more segments. Start around the visual amplitude of the
 *   jitter you want gone and adjust by eye.
 *
 * - sampleSpacing (default tolerance/2): arc-length distance between samples
 *   taken off the original path before fitting. Purely a numerical-accuracy
 *   knob, not a perceptual one — it must be fine enough that the sample set
 *   still describes the shape, but making it finer does not add segments to
 *   the output (segment count is governed by tolerance alone). Rarely needs
 *   changing; lower it only if the original has detail finer than the
 *   default resolves.
 *
 * Note: sharp corners in the input are rounded off, as tangents at split
 * points are estimated assuming continuity. Fine for hand-drawn motion
 * paths; not for shapes with intentional hard corners.
 */
fitPathElement = function(pathElt, tolerance, sampleSpacing = tolerance/2) {
  const total = pathElt.getTotalLength();
  const n = Math.max(3, Math.floor(total/sampleSpacing));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const pt = pathElt.getPointAtLength(i*total/n);
    pts.push([pt.x, pt.y]);
  }
  const out = [];
  fitCubic(pts, 0, pts.length-1,
           vnormed(vsub(pts[1], pts[0])),
           vnormed(vsub(pts[pts.length-2], pts[pts.length-1])),
           tolerance, out);
  let d = `M ${legible(pts[0][0])} ${legible(pts[0][1])} `;
  out.forEach(([c1,c2,p1]) => {
    const o = legible(c1[0],c1[1],c2[0],c2[1],p1[0],p1[1]);
    d += `C ${o[0]} ${o[1]}, ${o[2]} ${o[3]}, ${o[4]} ${o[5]} `;
  });
  return d;
}