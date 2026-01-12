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