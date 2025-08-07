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
vmax = (x, [a,b]) => [Math.max(x,a),Math.max(x,b)];

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
or
d=" Mxo,yo L_,_ L_,_ L_,_ L_,_ (...) Lxt,yt"
---
arrow's origin is [xo,yo]
arrow's target is [xt,yt]
*/
extractArrow = function(arrowGroupElt) {
  const shaftPathElt = arrowGroupElt.querySelector('path.real');
  const [opcodes,xs,ys] = extractPathCmds(shaftPathElt);
  if (opcodes[0] !== 'M') return;
  for (let i=1; i<opcodes.length; i++) if (opcodes[i] !== 'L') return;
  const [xo,yo,xt,yt] = [xs[0],ys[0],last(xs),last(ys)];
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

rectDist2ToRect = function(bbA,bbB) {
  // Thanks https://stackoverflow.com/a/65107290
  const a_min = [bbA.x,bbA.y];
  const a_max = [bbA.x+bbA.width, bbA.y+bbA.height];
  const b_min = [bbB.x,bbB.y];
  const b_max = [bbB.x+bbB.width, bbB.y+bbB.height];
  const u = vmax(0, vsub(a_min,b_max));
  const v = vmax(0, vsub(b_min,a_max));
  return vdot(u,u)+vdot(v,v);
}

rectInsideRect = function(bbIn,bbOut) {
  const [rinx,riny] = vsub([bbIn.x,bbIn.y],[bbOut.x,bbOut.y]);
  return 0 < rinx && rinx < bbOut.width  && bbIn.width < bbOut.width
      && 0 < riny && riny < bbOut.height && bbIn.height < bbOut.height;
}

RECT_NAME_MAX_DISTANCE = 20;
findClosestRectName = function(telts, bbox) {
  const dist2s = telts.map(t => ({
    element: t, dist2: rectDist2ToRect(t.getBBox(), bbox)
  })).filter(d => d.dist2 < RECT_NAME_MAX_DISTANCE**2);
  if (dist2s.length === 0) return;
  const closest = dist2s.reduce((min,d) => min.dist2 < d.dist2 ? min : d);
  return closest.element;
}

nearestRectCorner = function(pt,bbox) {
  const corners = explodeRect(bbox).map(c => ({
    coords: c, dist2: dist2(pt,c)
  }));
  return corners.reduce((min,c) => min.dist2 < c.dist2 ? min : c).coords;
}

addSetAttr = function(obj, prop, newItem) {
  if (obj[prop] === undefined) obj[prop] = ' ';
  if (obj[prop].indexOf(' '+newItem+' ') === -1)
    obj[prop] += newItem + ' ';
}

setAttrHas = function(obj, prop, item) {
  return obj[prop] === undefined || obj[prop].indexOf(' '+item+' ') !== -1;
}

pass = {};

pass.idArrows = function() {
  arrows = Array.from(
    document.querySelectorAll('.arrow-line'),
    g => ({element: g, ...extractArrow(g)})
  );
  arrows.forEach((a,i) => {
    a.element.id = 'a'+(i+1);
    // TODO: extracted info in dataset
  });
}

pass.idLabels = function() {
  document.querySelectorAll('text').forEach((t,i) => { t.id = 't'+(i+1); });
}

pass.labelArrows = function() {
  telts = arrows.map(a => findClosestTextElt(a.origin));

  // Annotate with label/arrow linkages
  telts.forEach((telt,i) => {
    const t = telt.element;
    const a = arrows[i];
    a.element.dataset.label = t.id;
    t.dataset.labelFor = a.element.id;

    // Visualise this pass
    const [x1,y1] = a.origin;
    const [tl,tr,br,bl] = explodeRect(t.getBBox());
    const [x2,y2] = vmul(0.5, vadd(tl,br));
    svgel('line', {style: 'stroke:rgb(0, 195, 255)', x1, y1, x2, y2},
      t.parentElement);
  });
}

pass.normalizeRects = function() {
  // TODO: PASS: normalise rect paths (to rect elements) and ID them
  rects = Array.from(document.querySelectorAll('path.real'))
    .filter(r => !r.classList.contains('connection'));
  rects = rects.map((pathRect,i) => {
    const params = extractRect(pathRect);
    // Create a <rect> to replace the <path>
    const actualRect = svgel('rect', {
      x: params[0], y: params[1], width: params[2], height: params[3]
    });
    actualRect.id = 'r'+(i+1); // ID each rect
    // Copy all attributes (style etc.)
    for (let j=pathRect.attributes.length-1; j>=0; j--)
      actualRect.setAttributeNode(pathRect.attributes[j].cloneNode());
    actualRect.attributes.removeNamedItem('d'); // ... except the path geom
    pathRect.parentElement.replaceChild(actualRect,pathRect);
    return { element: actualRect, params, obj: {} };
  });
}

pass.annotateContainments = function() {
  document.querySelectorAll('text').forEach(t => {
    const container = rects.find(r => rectInsideRect(t.getBBox(), r.element.getBBox()));
    if (container) {
      addSetAttr(container.element.dataset, 'contains', t.id);
      t.dataset.containedIn = container.element.id;
    }
  });
}

pass.annotateArrowConnections = function() {
  findRectContainingPt = coords => rects.find(r => containsPt(r.params,coords));

  o_rects = arrows.map(a => findRectContainingPt(a.origin));
  t_rects = arrows.map(a => findRectContainingPt(a.target));

  arrows.forEach((a,i) => {
    const origin = o_rects[i];
    const target = t_rects[i];
    a.element.dataset.origin = origin.element.id;
    a.element.dataset.target = target.element.id;
  });
}

pass.nameBoxesIfApplicable = function() {
  box_telts = Array.from(document.querySelectorAll(
    'text:not([data-label-for]):not([data-contained-in])'
  ));
  rects.forEach(r => {
    const rbb = r.element.getBBox();
    const t = findClosestRectName(box_telts, rbb);
    if (t) {
      r.element.dataset.label = t.id;
      t.dataset.labelFor = r.element.id;

      // Visualise this pass
      const [tl,tr,br,bl] = explodeRect(t.getBBox());
      const [x1,y1] = vmul(0.5, vadd(tl,br));
      const [x2,y2] = nearestRectCorner([x1,y1],rbb);
      svgel('line', {style: 'stroke:rgb(0, 195, 255)', x1, y1, x2, y2},
        t.parentElement);

      // PASS: generate JS obj graph
      r.obj.name = t.textContent;
    }
  });
}

main = function() {
  pass.idArrows();
  pass.idLabels();
  pass.labelArrows();
  pass.normalizeRects();
  pass.annotateContainments();
  pass.annotateArrowConnections();
  pass.nameBoxesIfApplicable();

// PASS: generate JS obj graph
telts.forEach((telt,i) => {
  const label = telt.element.textContent;
  const origin = o_rects[i].obj;
  const target = t_rects[i].obj;
  origin[label] = target;  
});

objs = {};
nextObj = 1;
ensureName = str => str ? str : 'anon'+(nextObj++);
rects.forEach(r => { objs[ensureName(r.obj.name)] = r.obj; });

// Test it
assert = (c, s) => { if (!c) throw "Assertion failure: "+s; };
if (rects.length > 4) { // assume it's id-simple.svg
  const names = 'Object Vtable Primitive Number Boolean String Null Undefined'.split(' ');
  names.forEach(n => assert(objs[n].name === n, n+'.name'));
  names.forEach(n => assert(objs[n].vtable === objs.Vtable, n+'.vtable'))
  assert(objs.Vtable.parent === objs.Object, 'Vtable.parent');
  assert(objs.Primitive.parent === objs.Object);
  names.forEach((n,i) => i > 2 ? assert(objs[n].parent === objs.Primitive, n+'.parent') : null);
  assert(Object.keys(objs.Object.log).length === 0);
  assert(Object.keys(objs.Primitive.log).length === 0);
}
return objs;
}