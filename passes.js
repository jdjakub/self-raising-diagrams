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
dist2 = ([x,y],[z,w]) => (z-x)**2 + (w-y)**2;

vtoa = ([x,y]) => x + ' ' + y;
atov = s => s ? s.split(' ').map(Number.parseFloat) : undefined;

all = selector => Array.from(document.querySelectorAll(selector));
byId = id => document.getElementById(id);

// ### MAIN ###

// Mathcha SVG outputs simple shapes as paths and multiline text as separate text elements...
// Gotta recognise basic shapes. Computer Vector Vision
parsePath = d => // TY Copilot
    [...d.matchAll(/([MLCZ])([^MLCZ]*)/g)].map(([_, cmd, args]) => {
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
  return {originPt: [xo,yo], targetPt: [xt,yt]};
}

pass = {};

// .arrow-line gets id, .is-arrow, originPt, targetPt
pass.idArrows = function() {
  log('Identifying arrows.');
  const arrows = all('.arrow-line');
  arrows.forEach((a,i) => {
    a.id = 'a'+(i+1);
    a.classList.add('is-arrow');
    const {originPt, targetPt} = extractArrow(a);
    a.dataset.originPt = vtoa(originPt);
    a.dataset.targetPt = vtoa(targetPt);
  });
}

// DOM -> JS
getArrow = function(domElement) {
  const a = domElement;
  let a_js = a.jsdata;
  if (a_js === undefined) a.jsdata = a_js = { dom: a };
  // Set by idArrows
  a_js.originPt = atov(a.dataset.originPt);
  a_js.targetPt = atov(a.dataset.targetPt);
  // Set by annotateArrowConnections
  a_js.originLabelId = a.dataset.originLabel;
  a_js.targetLabelId = a.dataset.targetLabel;
  if (a_js.originLabelId) a_js.originLabel = getLabel(byId(a_js.originLabelId));
  if (a_js.targetLabelId) a_js.targetLabel = getLabel(byId(a_js.targetLabelId));
  return a_js;
}

getArrows = () => all('.is-arrow').map(getArrow);

// text gets id, .is-label
pass.idLabels = function() {
  log('Identifying labels.');
  const texts = all('text');
  texts.forEach((t,i) => {
    t.id = 't'+(i+1);
    t.classList.add('is-label');
  });
}

// DOM -> JS
getLabel = function(domElement) {
  const l = domElement;
  let l_js = l.jsdata;
  if (l_js === undefined) l.jsdata = l_js = { dom: l };
  return l_js;
}

getLabels = () => all('.is-label').map(getLabel);

/*
Mathcha outputs multiline text boxes ("paragraphs") as a para <g> containing
line <g>s containing "run" <g>s (for runs of different formatting). A single-line
single-format label looks like:
<g> (paragraph)
  <g> (line)
    <g> (run)
      <text ...>labelText</text></g></g></g>

A multi-line, multi-format paragraph like this:
<g>
  <g>
    <g> <text>This is line 1.</text> </g>
  </g>
  <g>
    <g> <text Courier New>code</text> </g>
    <g> <text>in line 2</text> </g>
  </g>
</g>

Should get stitched into the string:
`This is line 1.
code in line 2`
*/
// Requires: idLabels
// Each paragraph <g> with >1 child <g> gets .is-multiline and data-string
pass.annotateParagraphs = function() {
  log('Annotating paragraphs.');
  const labels = getLabels();
  labels.forEach(l => {
    const line_g = l.dom.parentElement.parentElement;
    if (!line_g.previousSibling) { // First line
      const para_g = line_g.parentElement;
      if (para_g.children.length > 1) { // Multiple lines
        para_g.classList.add('is-multiline');
        // TODO: maybe sanity check they're in y-order
        const lines = Array.from(para_g.children).map(line_g => {
          const runs = Array.from(line_g.children).map(run_g =>
            run_g.firstChild.textContent
          );
          return runs.join(' ');
        });
        para_g.dataset.string = lines.join('\n');
      }
    }
  });
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

pass.normalizeRects = function() {
  log('Normalizing rect <path>s to <rect>s.');
  const rects = all('path.real')
    .filter(r => !r.classList.contains('connection'));
  rects.forEach((pathRect,i) => {
    const params = extractRect(pathRect);
    if (!params) return;
    // Create a <rect> to replace the <path>
    const actualRect = replaceTag(pathRect, 'rect');
    attr(actualRect, {
      x: params[0], y: params[1], width: params[2], height: params[3]
    });
    actualRect.id = 'r'+(i+1); // ID each rect
    actualRect.attributes.removeNamedItem('d'); // ... except the path geom
  });
}

// DOM -> JS
getRect = function(domElement) {
  const r = domElement;
  let r_js = r.jsdata;
  if (r_js === undefined) r.jsdata = r_js = { dom: r };
  r_js.topLeft = [+r.getAttribute('x'), +r.getAttribute('y')];
  r_js.extent = [+r.getAttribute('width'), +r.getAttribute('height')];
  r_js.botRight = vadd(r_js.topLeft, r_js.extent);
  r_js.center = vmul(0.5, vadd(r_js.topLeft, r_js.botRight));
  // Set by annotateContainments
  if (r.dataset.contains)
    r_js.contains = new Set(r.dataset.contains.trim().split(' ').map(byId));
  else
    r_js.contains = new Set();
  return r_js;
}

getRects = () => all('rect').map(getRect);

rectInsideRect = function(bbIn,bbOut) {
  const [rinx,riny] = vsub([bbIn.x,bbIn.y],[bbOut.x,bbOut.y]);
  return 0 < rinx && rinx < bbOut.width  && bbIn.width < bbOut.width
      && 0 < riny && riny < bbOut.height && bbIn.height < bbOut.height;
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

// Requires: idLabels, idArrows, normalizeRects
// Some labels/arrows get containedIn a rect
// forall (Label|Arrow) t, Rect r. t inside: r => t containedIn: r
pass.annotateContainments = function() {
  log('Annotating containment relationships.');
  const labels = getLabels();
  const rects = getRects();
  const arrows = getArrows();
  const perItem = t => {
    const container = rects.find(r => rectInsideRect(t.dom.getBBox(), r.dom.getBBox()));
    if (container) {
      addSetAttr(container.dom.dataset, 'contains', t.dom.id);
      t.dom.dataset.containedIn = container.dom.id; // Persistent
    }
  }
  labels.forEach(perItem);
  arrows.forEach(perItem);
}

pass.annotateAllContainments = function() {
  log('Annotating containment relationships.');
  const labels = getLabels();
  const rects = getRects();
  const arrows = getArrows();
  const perItem = t => {
    const containers = rects.filter(r => r !== t && rectInsideRect(t.dom.getBBox(), r.dom.getBBox()));
    containers.forEach(r => {
      addSetAttr(r.dom.dataset, 'contains', t.dom.id);
      addSetAttr(t.dom.dataset, 'containedIn', r.dom.id);
    });
  }
  labels.forEach(perItem);
  arrows.forEach(perItem);
  rects.forEach(perItem);
}

// Requires: annotateAllContainments
// Before: contains/containedIn is transitive; A contains B contains C => A contains C
// After: nontransitive, tree-structured.
pass.treeifyContainments = function() {
  log('Treeifying containment relationships.');
  const rects = getRects();
  const roots = rects.filter(r => !r.dom.dataset.containedIn).map(r => r.dom);
  const perRect = rect => {
    const contained = setAttrToArray(rect.dataset.contains).map(byId);
    const potentialGrandchildren = [...contained];
    const potentialParents = [...contained];
    let doRemove;
    do {
      doRemove = false;
      const pg = potentialGrandchildren.shift();
      for (let pp of potentialParents) {
        if (pp === pg) continue;
        if (setAttrHas(pg.dataset, 'containedIn', pp.id)) {
          // pg is actually under pp, so it shouldn't be under rect
          doRemove = true; break;
        }
      }
      if (doRemove) { // pg really is a grandchild; reflect this
        potentialParents.splice(potentialParents.indexOf(pg), 1);
        removeFromSetAttr(pg.dataset, 'containedIn', rect.id);
        removeFromSetAttr(rect.dataset, 'contains', pg.id);
      }
    } while (potentialGrandchildren.length > 0);

    const childRects = potentialParents.filter(r => r.tagName === 'rect');
    childRects.forEach(perRect); // recurse depth-first
  }
  roots.forEach(perRect);
}

showContainmentTree = function(root) {
  const contained = setAttrToArray(root.dataset.contains).map(byId);
  if (root.dataset.contains) log(root.id + ' > ' + root.dataset.contains);
  contained.forEach(showContainmentTree);
}

// Requires: treeifyContainments
// A containedIn B ==> A is a DOM child of B
pass.makeDOMReflectContainmentTree = function() {
  log('Re-rooting elements to reflect containment relations.');
  const domContainChildren = rect => {
    const contained = setAttrToArray(rect.dataset.contains).map(byId);
    contained.forEach(domContainChildren);
    // Uproot the soon-to-be child from wherever it happens to be
    // and plant it under its container
    contained.forEach(child => rect.parentElement.appendChild(
      child.tagName === 'text' ? child.parentElement.parentElement.parentElement
    : child.tagName === 'rect' ? child.parentElement
    : child
    ));
  }
  const rects = getRects();
  const roots = rects.filter(r => !r.dom.dataset.containedIn).map(r => r.dom);
  roots.forEach(domContainChildren);
}

COMMENT_COLOR = 'rgb(65, 117, 5)';
META_COLOR = 'rgb(74, 144, 226)';

IGNORED_COLORS = new Set([COMMENT_COLOR, META_COLOR]);

// Requires: annotateContainments
// Elements contained within comment-coloured boxes (and the boxes) get .is-comment
// forall Rect r. r stroke = C => forall a. a containedIn: r => a is-comment
pass.annotateComments = function() {
  log('Annotating comments to ignore.');
  const rects = getRects().filter(r => IGNORED_COLORS.has(r.dom.style.stroke));
  rects.forEach(r => {
    r.contains.forEach(c => c.classList.add('is-comment'));
    r.dom.classList.add('is-comment');
  });
}

// Requires: annotateContainments, annotateParagraphs
pass.checkFormat = function() {
  log('Checking diagram format.');
  const metaBox = getRects().find(r => r.dom.style.stroke === META_COLOR);
  if (!metaBox) {
    console.warn('Meta-box not found; risk of running the wrong format.');
    return;
  }
  for (let t of metaBox.contains) {
    if (t.classList.contains('is-label')) {
      const par_g = t.parentElement.parentElement.parentElement;
      if (par_g.classList.contains('is-multiline')) {
        const jsonStr = '{' + par_g.dataset.string.replaceAll('\n',', ') + '}';
        let metaInfo = {};
        try {
          metaInfo = JSON.parse(jsonStr);
        } catch (e) {
          console.warn('Meta-box JSON error; risk of running the wrong format.', e);
        }
        if (metaInfo.format !== 'labelGraph')
          console.warn('This diagram is of the format '+metaInfo.format);
        document.documentElement.dataset.metaInfo = jsonStr;
        break;
      }
    }
  }
}

getMetaInfo = function() {
  // SMELL: duped
  let metaInfo = {};
  try {
    metaInfo = JSON.parse(document.documentElement.dataset.metaInfo);
  } catch (e) {
    console.warn('Meta-box JSON error; risk of running the wrong format.', e);
  }
  return metaInfo;
}

hideComment = function(dom) {
  // TODO: Maybe commentify entire tree
  const oldTag = dom.tagName;
  const newDom = replaceTag(dom, 'comment');
  newDom.dataset.originalTag = oldTag;
  newDom.dataset.originalClass = attr(newDom, 'class');
  attr(newDom, 'class', '');
}

restoreComment = function(dom) {
  const oldDom = replaceTag(dom, dom.dataset.originalTag);
  attr(oldDom, 'class', dom.dataset.originalClass);
  delete oldDom.dataset.originalTag;
  delete oldDom.dataset.originalClass;
}

// Requires: annotateComments, checkFormat
// Elements contained within .is-comment boxes (as well as the boxes) become <comment>s, temporarily
pass.hideComments = function() {
  log('Hiding comments from subsequent passes.');
  const comments = all('.is-comment');
  comments.forEach(hideComment);
}

// Requires: generateJS
pass.restoreComments = function() {
  log('Restoring comments.');
  all('comment').forEach(c => restoreComment(c));
}

dist2ToBBox = function(bbox,[x,y]) {
  // Thanks https://stackoverflow.com/a/18157551
  // TODO: make it work when inside
  const [l,r,t,b] = [bbox.x,bbox.x+bbox.width,bbox.y,bbox.y+bbox.height];
  const dx = Math.max(l - x, 0, x - r);
  const dy = Math.max(t - y, 0, y - b);
  return dx*dx + dy*dy;
}

findNearestBBox = function(bboxes, pt) {
  bboxes.forEach(bb => {
    bb.dist2 = dist2ToBBox(bb, pt);
  });
  return bboxes.reduce((min,d) => min.dist2 < d.dist2 ? min : d);
}

explodeRect = function(r) {
  const [lx,rx,ty,by] = [r.x,r.x+r.width,r.y,r.y+r.height];
  return [[lx,ty],[rx,ty],[rx,by],[lx,by]];
}

vizBBoxPtConnection = function(bbox, [x1,y1], parentDom) {
  const [tl,tr,br,bl] = explodeRect(bbox);
  const [x2,y2] = vmul(0.5, vadd(tl,br));
  svgel('line', {style: 'stroke:rgb(0, 195, 255)', x1, y1, x2, y2}, parentDom);
}

vizPtPtConnection = function([x1,y1], [x2,y2], parentDom) {
  svgel('line', {style: 'stroke:rgb(0, 195, 255)', x1, y1, x2, y2}, parentDom);
}

// Requires: hideComments
// Each arrow gets originLabel, targetLabel
// forall Arrow a. a origin = Label nearestTo: a originPt.
//                 a target = Label nearestTo: a targetPt.
pass.annotateArrowsBetweenLabels = function() {
  log('Connecting arrow endpoints to labels.');
  const arrows = getArrows();
  const labels = getLabels();
  const bboxes = labels.map(l => {
    const b = l.dom.getBBox();
    b.from = l;
    return b;
  });
  
  const origins = arrows.map(a => findNearestBBox(bboxes, a.originPt).from);
  const targets = arrows.map(a => findNearestBBox(bboxes, a.targetPt).from);

  arrows.forEach((a,i) => {
    const [o_dom, t_dom] = [origins[i].dom, targets[i].dom];
    a.dom.dataset.originLabel = o_dom.id;
    a.dom.dataset.targetLabel = t_dom.id;

    vizBBoxPtConnection(o_dom.getBBox(), a.originPt, o_dom.parentElement);
    vizBBoxPtConnection(t_dom.getBBox(), a.targetPt, t_dom.parentElement);
  });
}

dist2ToRect = function(bbox,[x,y]) {
  // Thanks https://stackoverflow.com/a/18157551
  // TODO: make it work when inside
  const [l,r,t,b] = [bbox.x,bbox.x+bbox.width,bbox.y,bbox.y+bbox.height];
  const dx = Math.max(l - x, 0, x - r);
  const dy = Math.max(t - y, 0, y - b);
  return dx*dx + dy*dy;
}

findClosestTextElt = function(origin) {
  const ts = getLabels();
  const bboxes = ts.map(t => [t, t.dom.getBBox()]);
  const dist2s = bboxes.map(([t,bb]) => ({
    element: t, dist2: dist2ToRect(bb,origin)
  }));
  const closestPt = dist2s.reduce((min,d) => min.dist2 < d.dist2 ? min : d);
  return closestPt;
}

// Requires: idArrows
// each arrow gets label
pass.labelArrows = function() {
  log('Labelling arrows.');
  const arrows = getArrows();
  const tdists = arrows.map(a => findClosestTextElt(a.originPt));

  // Annotate with label/arrow linkages
  tdists.forEach((tdist,i) => {
    const t = tdist.element;
    const a = arrows[i];
    a.dom.dataset.label = t.dom.id;
    t.dom.dataset.labelFor = a.dom.id;

    // Visualise this pass
    const [tl,tr,br,bl] = explodeRect(t.dom.getBBox());
    const tcenter = vmul(0.5, vadd(tl,br));
    vizPtPtConnection(a.originPt, tcenter, t.parentElement);
  });
}

// Arrows which Mathcha snaps to rect edges ought to count as "inside" the rect.
// However, their coords are about 2px short.
CONTAINS_PT_EPSILON = 3;
containsPt = function(rect,pt) {
  const [relx,rely] = vsub(pt,rect.top_left);
  const [w,h] = rect.extent;
  const [propx,propy] = [relx/w,rely/h];
  const ex = CONTAINS_PT_EPSILON/w;
  const ey = CONTAINS_PT_EPSILON/h;
  return -ex < propx && propx < 1+ex && -ey < propy && propy < 1+ey;
}

// Requires: idArrows, normalizeRects
// Each arrow gets originBox, targetBox
pass.annotateArrowsBetweenBoxes = function() {
  log('Annotating arrow/box connections.');

  const rects = getRects();
  findRectContainingPt = coords => rects.find(r => containsPt(r,coords));

  const arrows = getArrows();
  const o_rects = arrows.map(a => findRectContainingPt(a.originPt));
  const t_rects = arrows.map(a => findRectContainingPt(a.targetPt));

  arrows.forEach((a,i) => {
    const origin = o_rects[i];
    const target = t_rects[i];
    a.dom.dataset.origin = origin.dom.id;
    a.dom.dataset.target = target.dom.id;
  });
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

// Requires: labelArrows, normalizeRects, annotateContainments
// Some boxes get label
pass.nameBoxesIfApplicable = function() {
  log('Naming boxes.');
  const box_telts = all('text:not([data-label-for]):not([data-contained-in])');
  const rects = getRects();
  rects.forEach(r => {
    const rbb = r.dom.getBBox();
    const t = findClosestRectName(box_telts, rbb);
    if (t) {
      r.dom.dataset.label = t.id;
      t.dataset.labelFor = r.dom.id;

      // Visualise this pass
      const [tl,tr,br,bl] = explodeRect(t.getBBox());
      const tcenter = vmul(0.5, vadd(tl,br));
      const corner = nearestRectCorner(tcenter,rbb);
      vizPtPtConnection(tcenter, corner, t.parentElement);
    }
  });
}

/*
<path class="real"
d=" M_,cy
    C_,_ _,_ cx,ty
    ___"
style="stroke-width: 1px;
           stroke: #{MAGIC_CIRCLE_COLOR};
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

pass.normalizeCircles = function() {
  log('Normalizing circle <path>s to <circle>s.');
  const circs = all('path.real').filter(r => !r.classList.contains('connection'));
  circs.forEach((pathCirc,i) => {
    const params = extractCircle(pathCirc);
    if (!params) return;
    // Create a <circle> to replace the <path>
    const actualCirc = replaceTag(pathCirc, 'circle');
    attr(actualCirc, params);
    actualCirc.id = 'c'+(i+1); // ID each circle
    actualCirc.attributes.removeNamedItem('d'); // ... except the path geom
  });
}