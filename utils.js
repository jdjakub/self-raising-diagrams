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

svg_parent = document.documentElement; // Default parent for new SVG elements

create_element = (tag, attrs, parent, namespace) => {
  let elem = document.createElementNS(namespace, tag);
  if (attrs !== undefined) attr(elem, attrs);
  if (parent === undefined) parent = svg_parent;
  parent.appendChild(elem);
  return elem;
};

// e.g. rect = svgel('rect', {x: 5, y: 5, width: 5, height: 5}, svg)
svgel = (tag, attrs, parent) => create_element(tag, attrs, parent, 'http://www.w3.org/2000/svg');

vadd = ([a, b], [c, d]) => [a+c, b+d];
vsub = ([a, b], [c, d]) => [a-c, b-d];
vdot = ([a, b], [c, d]) => a*c + b*d;
vmul = (k, [a,b]) => [k*a, k*b];
vcmul = ([ka,kb],[a,b]) => [ka*a,kb*b];
vmax = (x, [a,b]) => [Math.max(x,a),Math.max(x,b)];
dist2 = ([x,y],[z,w]) => (z-x)**2 + (w-y)**2;
vnormed = v => vmul(1/Math.sqrt(vdot(v,v)), v);
vswap = ([x,y]) => [y,x];

vtoa = ([x,y]) => x + ' ' + y;
atov = s => s ? s.split(' ').map(Number.parseFloat) : undefined;

currentScope = document;
restrictScope = function(element) {
  const oldScope = currentScope;
  currentScope = element;
  return oldScope;
}
all = selector => Array.from(currentScope.querySelectorAll(selector));
some = selector => all(selector)[0];
byId = id => document.getElementById(id.trim());

replaceTag = function(node, tag) {
  // Thanks https://stackoverflow.com/a/65090521
  const clone = svgel(tag, {});
  // Copy all attributes (style etc.)
  for (let j=node.attributes.length-1; j>=0; j--)
    clone.setAttributeNode(node.attributes[j].cloneNode());
  while (node.firstChild) {
    clone.appendChild(node.firstChild);
  }
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
parsePath = d => // TY Copilot. NB: Doesn't support H,V,A
    [...d.matchAll(/([MLCQSTZmlcqstz])([^MLCQSTZmlcqstz]*)/g)]
    .map(([_, cmd, args]) => {
      if (cmd === 'Z') return [cmd];
      const nums = args.trim().split(/[\s,]+/).map(Number);
      const pts = [];
      for (let i = 0; i < nums.length; i += 2) {
        pts.push([nums[i], nums[i + 1]]);
      }
      return [cmd, ...pts];
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
extractCircle = function(circPathElt) {
  const [opcodes,xs,ys] = extractPathCmds(circPathElt);
  if (opcodes !== 'MCCCCZ') return;
  const cy = ys[0];
  const cx = xs[1][2];
  const ty = ys[1][2];
  const r = cy-ty;
  return {cx, cy, r};
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
  let pt_proj_0_to_1 = vdot(p1_to_pt,p1_to_p2) / vdot(p1_to_p2,p1_to_p2);
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

polyFromPath = function(cmds) {
  const vertices = [ [0,0] ];
  const penPos = (newPos) => {
    if (newPos) vertices[vertices.length-1] = newPos;
    else return vertices[vertices.length-1];
  }
  const penPosRel = (delta) => {
    vertices[vertices.length-1] = vadd(vertices[vertices.length-1], delta);
  }
  cmds.forEach(([c,v]) => {
    switch (c) {
      case 'M': penPos(v); break;
      case 'm': penPosRel(v); break;
      case 'L': vertices.push(v); break;
      case 'l': vertices.push(vadd(last(vertices),v)); break;
    }
  });
  return vertices;
}

Array.prototype.thatWhichMinimizes = function(funcToMinimize) {
  let min_so_far = [null,Infinity];
  for (let x of this) {
    const value = funcToMinimize(x);
    if (value < min_so_far[1]) min_so_far = [x,value];
  }
  return min_so_far[0];
}