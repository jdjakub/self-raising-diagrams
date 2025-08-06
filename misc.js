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

svg_parent = document.body; // Default parent for new SVG elements

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

/* ### MAIN ### */

// Mathcha SVG outputs simple shapes as paths and multiline text as separate text elements...
// Gotta recognise basic shapes. Computer Vector Vision

extractPathCmds = function(pathElt) {
  const d = pathElt.getAttribute('d')
  const clauses = d.split(' ').filter(c => c.length > 0);
  const cmds = clauses.map(c => [c[0], c.substr(1).split(',').map(s => Number.parseFloat(s))]);
  const opcodes = cmds.map(c => c[0]).join('');
  const xs = cmds.map(c => c[1][0]);
  const ys = cmds.map(c => c[1][1]);
  return [opcodes,xs,ys];
}

/*
<path class="real" d=" Mlx,ty Lrx,ty Lrx,by Llx,by Z" />
---
<rect x="lx" y="ty"
  width="rx-lx" height="by-ty" />
*/
extractRect = function(rectPathElt) {
  const [opcodes,xs,ys] = extractPathCmds(rectPathElt);
  if (opcodes !== 'MLLLZ') return;
  if (xs[0] !== xs[3]) return;
  if (ys[0] !== ys[1]) return;
  if (xs[1] !== xs[2]) return;
  if (ys[2] !== ys[3]) return;
  
  const [lx,ty,rx,by] = [xs[0],ys[0],xs[1],ys[2]];
  return [lx,ty,rx-lx,by-ty];
}

/*
<g class="arrow-line">
  <path class="real" d=" Mxo,yo Lxt,yt" />
</g>
---
arrow's origin is [xo,yo]
arrow's target is [xt,yt]
*/
extractArrow = function(arrowGroupElt) {
  const shaftPathElt = arrowGroupElt.querySelector('path.real');
  const [opcodes,xs,ys] = extractPathCmds(shaftPathElt);
  if (opcodes !== 'ML') return;
  const [xo,yo,xt,yt] = [xs[0],ys[0],xs[1],ys[1]];
  return {origin: [xo,yo], target: [xt,yt]};
}

explodeRect = function(r) {
  const [lx,rx,ty,by] = [r.x,r.x+r.width,r.y,r.y+r.height];
  return [[lx,ty],[rx,ty],[rx,by],[lx,by]];
}

dist2 = ([x,y],[z,w]) => (z-x)**2 + (w-y)**2;

dist2ToRect = function(bbox,[x,y]) {
  // Thanks https://stackoverflow.com/a/18157551
  // TODO: make it work when inside
  const [l,r,t,b] = [bbox.x,bbox.x+bbox.width,bbox.y,bbox.y+bbox.height];
  const dx = Math.max(l - x, 0, x - r);
  const dy = Math.max(t - y, 0, y - b);
  return dx*dx + dy*dy;
}

findClosestTextElt = function(origin) {
  const ts = document.querySelectorAll('text');
  const bboxes = Array.from(ts, t => [t, t.getBBox()]);
  const dist2s = bboxes.map(([t,bb]) => ({
    element: t, dist2: dist2ToRect(bb,origin)
  }));
  const closestPt = dist2s.reduce((min,d) => min.dist2 < d.dist2 ? min : d);
  return closestPt;
}

// Arrows which Mathcha snaps to rect edges ought to count as "inside" the rect.
// However, their coords are about 2px short.
CONTAINS_PT_EPSILON = 3;
containsPt = function([lx,ty,w,h],[x,y]) {
  const [relx,rely] = [x-lx,y-ty];
  const [propx,propy] = [relx/w,rely/h];
  const ex = CONTAINS_PT_EPSILON/w;
  const ey = CONTAINS_PT_EPSILON/h;
  return -ex < propx && propx < 1+ex && -ey < propy && propy < 1+ey;
}

main = function(){

arrows = Array.from(
  document.querySelectorAll('.arrow-line'),
  g => ({element: g, ...extractArrow(g)})
);

telts = arrows.map(a => findClosestTextElt(a.origin));

rects = Array.from(document.querySelectorAll('path.real'))
  .filter(r => !r.classList.contains('connection'))
  .map(path => ({element: path, params: extractRect(path), obj: {}}));

findRectContainingPt = coords => rects.find(r => containsPt(r.params,coords));

o_rects = arrows.map(a => findRectContainingPt(a.origin));
t_rects = arrows.map(a => findRectContainingPt(a.target));

telts.forEach((telt,i) => {
  const label = telt.element.textContent;
  const origin = o_rects[i].obj;
  const target = t_rects[i].obj;
  origin[label] = target;  
});

objs = rects.map(r => r.obj);
return objs;
}