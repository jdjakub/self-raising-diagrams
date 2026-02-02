vtables = { byTag: {}, };

// We want to be able to send Smalltalk-style messages to SVG DOM nodes
// e.g. send(rectElem, 'doSomething:', blah1, 'with:', blah2, 'and:', blah3)
// = sendNoKw(rectElem, 'doSomething:with:and:', blah1, blah2, blah3)
// NOTE: JSTalk macro syntactic sugar
//   ⟦ rectElem doSomething: blah1 with: blah2 and: blah3 ⟧
// should expand (jstalk2js.pl) into the above send().
// BTW: the VS Code extension.js auto-replaces [[ -> ⟦ and ]] -> ⟧ as you type
// If the sugar isn't working for you, just work with the verbose .js output file

send = function(recv, ...pairs) {
  if (pairs.length === 1) return sendNoKw(recv, ...pairs); // Unary message
  if (pairs.length % 2 !== 0) throw ['Odd args:', pairs]; // Binary / keyword message
  let selector = [];
  const args = [];
  for (let i=0; i<pairs.length; i += 2) {
    selector.push(pairs[i]);
    args.push(pairs[i+1]);
  }
  selector = selector.join('');
  return sendNoKw(recv, selector, ...args);
}

// TODO: supersends
sendNoKw = function(recv, selector, ...args) {
  let vtable;
  if (recv.tagName) vtable = vtables.byTag[recv.tagName];
  else if (recv instanceof Array && recv.length === 2) vtable = vtables.point;
  else if (typeof recv.vtable === 'string') vtable = vtables[recv.vtable];
  else vtable = recv.vtable;
  let method;
  do {
    method = vtable[selector];
    vtable = vtable._parent; // i.e. superclass
  } while (!method && vtable);
  if (!method && !vtable) {
    if (selector === 'doesNotUnderstand:')
      throw ["Didn't understand: ",recv,selector,...args];
    else
      return sendNoKw(recv, 'doesNotUnderstand:', [selector, ...args]);
  }
  return method(recv, ...args);
}

vtables.point = {
  ['distanceTo:']: (self, other) => {
    if (other instanceof Array && other.length === 2) {
      return Math.sqrt(dist2(self, other));
    } else { // Assumes < domNode
      const closest = closest_line_seg_to_pt(self, ⟦other lineSegments⟧);
      return Math.sqrt(distance2_pt_to_line_seg(self, ...closest));
    }
  }
};

nextId = 1;

vtables.domNode = {
  _parent: null,

  ['id']: (self) => {
    // TODO: pull in + exec any red boxes on demand!?
    let id = attr(self, 'id');
    if (!id) {
      const prefix = ⟦self idPrefix⟧;
      id = prefix+(nextId++);
      attr(self, 'id', id);
    }
    return id;
  },
  ['idPrefix']: (self) => {
    let ret = {
      'path': 'e', 'polygon': 'p', 'polyline': 'l',
      'text': 't', 'circle': 'c', 'rect': 'r'
    }[self.tagName];
    if (!ret) ret = 'e';
    return ret;
  },
  ['containsPt:']: (self, [x,y]) => {
    const bb = self.getBBox();
    const [l,t,r,b] = [bb.x,bb.y,bb.x+bb.width,bb.y+bb.height];
    return l<=x && x<=r && t<=y && y<=b;
  },
  ['encloses:']: (self, other) => {
    const otherVs = ⟦other vertices⟧; // SMELL convex polys only
    for (const v of otherVs) {
      if (!⟦self containsPt: v⟧) return false;
    }
    return true;
  },
  ['vertices']: (self) => {
    const bb = self.getBBox(); // SMELL duped
    const [l,t,r,b] = [bb.x,bb.y,bb.x+bb.width,bb.y+bb.height];
    return [ [l,t], [r,t], [r,b], [l,b] ];
  },
  ['isClosed']: (self) => true,
  ['lineSegments']: (self) => explode_poly_segs(⟦self vertices⟧, ⟦self isClosed⟧),
  ['distanceTo:']: (self, other) => {
    if (other instanceof Array) return ⟦other distanceTo: self⟧;
    return Math.sqrt(distance2_line_segs_to_segs(⟦self lineSegments⟧, ⟦other lineSegments⟧));
  },
  ['findTightestContainerIn:']: (self, elems) => { // -> containedIn
    // MUCH nicer code than annotateAllContainments plus treeifyContainments
    // I want to find my least / tightest container
    let container = null; // Infinitely big initial container
    elems.filter(other => self !== other).forEach(other => {
      const rivalExists = ⟦other encloses: self⟧;
      if (rivalExists) {
        const rival = other;
        // If the rival sits within my current tightest container, rival is tighter
        if (container === null || ⟦container encloses: rival⟧) container = rival;
      }
    });
    if (container) {
      addSetAttr(container.dataset, 'contains', ⟦self id⟧);
      self.dataset.containedIn = ⟦container id⟧;
    }
  },
  ['specialize']: (self) => null,
  ['localRoot']: (self) => self,
  ['reroot']: (self) => { // Given: containedIn
    let soonToBeParent = byId(self.dataset.containedIn);
    const parentRoot = ⟦soonToBeParent localRoot⟧;
    const myRoot = ⟦self localRoot⟧;
    parentRoot.appendChild(myRoot);
  },
};

vtables.byTag['path'] = {
  _parent: vtables.domNode,

  ['isClosed']: (self) => {
    return attr(self, 'd').toUpperCase().trimEnd().endsWith('Z');
  },
  ['isCurved']: (self) => { // NB: technically could be degen bezier polygon
    const d = attr(self, 'd').toUpperCase();
    return d.includes('Q') || d.includes('C') || d.includes('S') || d.includes('T') || d.includes('A');
  },
  ['commands']: (self) => {
    const d = attr(self, 'd');
    return parsePath(d);
  },
  ['pointAtFrac:']: (self, frac /* 0 to 1 */) => {
    const total = self.getTotalLength();
    const pt = self.getPointAtLength(frac * total);
    return [pt.x, pt.y];
  },
  ['encloses:']: (self, other) => {
    if (!⟦self isClosed⟧) return false;
    else return vtables.domNode['encloses:'](self, other); // HACK supersend
  },
  ['specialize']: (self) => {
    let newTag = null;
    if (!⟦self isCurved⟧) { // => Polygon | Polyline
      const polyPts = polyFromPath(⟦self commands⟧).map(v => v.join(',')).join(' ');
      attr(self, 'points', polyPts);
      newTag = ⟦self isClosed⟧? 'polygon' : 'polyline';
    } else {
      // SMELL: duped from normalizeCircles
      const params = extractCircle(self);
      if (params) { // Circle
        attr(self, params);
        newTag = 'circle';
      }
    }
    if (newTag) {
      self = replaceTag(self, newTag);
      self.removeAttribute('d');
      return self;
    }
    return null;
  },
  ['localRoot']: (self) => self.parentElement,
};

vtables.byTag['polyline'] = {
  _parent: vtables.byTag['path'],

  ['vertices']: (self) => {
    return attr(self, 'points').trim().split(' ').map(v => v.split(',').map(Number));
  },
  ['isClosed']: () => false,
  ['isCurved']: () => false,
  ['commands']: (self) => {
    let vs = ⟦self vertices⟧;
    vs = vs.map(v => ['L', v]);
    vs[0][0] = 'M';
    return vs;
  },
  ['encloses:']: () => false,
  ['specialize']: () => null,
};

vtables.byTag['polygon'] = {
  _parent: vtables.byTag['polyline'],

  ['isClosed']: () => true,
  ['specialize']: (self) => {
    let newTag = null;
    const vertices = ⟦self vertices⟧;
    if (vertices.length === 4) {
      const [tl,tr,br,bl] = vertices;
      // NB: requires axis-aligned and clockwise starting from top-left
      if (tl[0] === bl[0] && tr[0] === br[0] && tl[1] === tr[1] && bl[1] === br[1]) {
        const params = {x: tl[0], y: tl[1], width: tr[0]-tl[0], height: bl[1]-tl[1]};
        attr(self, params);
        newTag = 'rect';
      }
    }
    if (newTag) {
      self = replaceTag(self, newTag);
      self.removeAttribute('points');
      return self;
    }
    return null;
  },
  ['containsPt:']: (self, pt) => {
    const vs = ⟦self vertices⟧;
    return isPointInPolygon(pt, vs);
  },
  ['encloses:']: vtables.domNode['encloses:'], // HACK super?
}

vtables.byTag['rect'] = {
  _parent: vtables.byTag['polygon'],

  ['vertices']: (self) => {
    const [x,y,w,h] = attrs(self, 'x', 'y', 'width', 'height').map(Number);
    return [ [x,y], [x+w,y], [x+w,y+h], [x,y+h] ];
  },
  ['specialize']: () => null,
  ['parseAsExecutable']: (self) => {
    // Check for executable boxes
    if (self.style.stroke === 'rgb(208, 2, 27)') {
      const lroot = ⟦self localRoot⟧;
      const paras = Array.from(lroot.querySelectorAll('.is-paragraph'));
      let done = true;
      paras.forEach(p => {
        if (!p.classList.contains('done')) done = false;
        const str = p.dataset.string;
        const lines = str.split('\n');
        if (lines.length === 1 && str.startsWith('#')) {
          p.classList.add('sets-id'); return true;
        } else if (lines.every(l => l.startsWith('.'))) {
          p.classList.add('adds-class'); return true;
        } else {
          p.classList.add('is-code'); return true;
        }
      });
      if (done) self.classList.add('done');
    }
    return false;
  },
}

vtables.byTag['circle'] = {
  _parent: vtables.byTag['path'],

  ['isClosed']: () => true,
  ['isCurved']: () => true,
  ['vertices']: (self) => {
    // Sigh ... approximate circle as octagon
    const [cx,cy,r] = attrs(self, 'cx', 'cy', 'r').map(Number);
    const n = 8;
    const theta = Math.PI*2/n;
    const vs = [];
    for (let i=0; i<n; i++) {
      const itheta = i*theta;
      const [x,y] = [Math.cos(itheta), Math.sin(itheta)];
      const avg_r = r*(1+1/Math.cos(theta/2))/2; // 1/2 between inner and outer polygon
      vs.push(vadd([cx,cy], vmul(avg_r, [x,y])));
    }
    return vs;
  },
  ['specialize']: () => null,
  ['containsPt:']: (self, pt) => {
    const [cx,cy,r] = attrs(self, 'cx', 'cy', 'r').map(Number);
    const pt_from_c = vsub(pt, [cx,cy]);
    return vdot(pt_from_c,pt_from_c) < r*r;
  },
}

vtables.byTag['text'] = {
  _parent: vtables.domNode,
}

vtables.byTag['g'] = {
  _parent: vtables.domNode,

  ['parseAsParagraph']: (self) => {
    if (self.children.length === 0) return false;
    for (let child of self.children) {
      if (child.tagName !== 'g') return false;
      for (let gchild of child.children) {
        if (gchild.tagName !== 'g') return false;
        if (gchild.firstChild.tagName !== 'text') return false;
      }
    }
    // TODO: maybe sanity check they're in y-order
    const lines = Array.from(self.children).map(line_g => {
      const runs = Array.from(line_g.children).map(run_g =>
        run_g.firstChild.textContent
      );
      return runs.join(' ');
    });
    self.dataset.string = lines.join('\n');
    if (self.children.length > 1) self.classList.add('is-multiline');
    self.classList.add('is-paragraph');
    return true;
  },
  ['idPrefix']: (self) => {
    if (self.classList.contains('is-paragraph')) return 'par';
    else return 'g';
  },
  //SMELL domNode>>localRoot wrong for line/run <g>'s
  ['execute']: (self) => {
    const str = self.dataset.string;
    const lines = str.split('\n');
    const parent_g = self.parentElement.parentElement;
    const parent_focus = parent_g.firstChild; // SMELL nondeterminism
    if (self.classList.contains('sets-id')) {
      // #myId para sets container id=myId and self-deletes
      // SMELL what if new ID already in use
      const newId = str.substring(1);
      const clash = byId(newId);
      if (clash) clash.id = parent_focus.id;
      parent_focus.id = newId;
      self.classList.add('done');
    } else if (self.classList.contains('adds-class')) {
      // .myClass line adds myClass to container and self-deletes
      lines.forEach(l => {
        parent_focus.classList.add(l.substring(1));
      });
      self.classList.add('done');
    } else if (self.classList.contains('is-code')) {
      eval(str); // >:D
      self.classList.add('done');
    }
  }
}

e = {};
function init() {
  const paths = all('path.real');
  let elems = paths.concat(all('polygon'));
  elems = elems.concat(all('g').filter(g => ⟦g parseAsParagraph⟧));
  elems.forEach((el) => {
    let newEl = el;
    let max_iter = 10;
    do { // max specialize
      el = newEl;
      newEl = ⟦el specialize⟧;
      max_iter--;
    } while (max_iter > 0 && newEl);
    e[ ⟦el id⟧ ] = el;
  });

  elems = Object.values(e);
  elems.forEach(el => ⟦el findTightestContainerIn: elems⟧);
  
  // MUCH nicer than makeDOMReflectContainmentTree
  all('[data-contained-in]').forEach(child => {
    ⟦child reroot⟧;
    delete child.dataset.containedIn;
  });
  all('[data-contains]').forEach(e => {
    delete e.dataset.contains;
  });

  all('rect').forEach(r => ⟦r parseAsExecutable⟧);
  all('.sets-id').forEach(p => ⟦p execute⟧);
  all('.adds-class').forEach(p => ⟦p execute⟧);
  all('.is-code').forEach(p => ⟦p execute⟧);
  all('rect').forEach(r => ⟦r parseAsExecutable⟧);
  //all('.done').forEach(e => e.remove());

  return elems.length;
}

/*
In order for a generic shape (1D/2D) to claim a label, we want to use
a context-specific shape as proxy. E.g. for boxGraph, a 1D arrow claims
the closest label to its *origin point* (0D). Meanwhile, a 2D box claims
the closest label to its entire shape. Afterwards, max distances or further
restrictions are applied.

Don't prematurely commit to the specific DOM.
*/

// === BoxGraph SEMANTIC LAYER ===
// TODO: reify package BoxGraph

vtables['BoxGraph-Common'] = {
  // Wrap underlying DOM element and inherit its methods
  ['doesNotUnderstand:']: (self, [selector, ...args]) => sendNoKw(self.dom, selector, ...args),
  ['label:']: (self, labelPara) => {
    self.dom.dataset.label = ⟦labelPara id⟧;
    labelPara.dataset.labelFor = ⟦self id⟧;
  },
}

vtables['Box'] = {
  _parent: vtables['BoxGraph-Common'],

  ['initFromDOM:']: (self, rect) => {
    self.dom = rect; // Yup, that's it
    self.domContainer = rect.parentElement; // Target of all CSS queries
  },
  // Box >> claimLabel
  //    labels := all('.is-paragraph:not(.is-multiline):not([data-label-for])').
  //    label := (labels outside: self) minimizing: [ :l | self distanceTo: l ].
  //    self label: label.
  ['claimLabel']: (self) => {
    const labels = all('.is-paragraph:not(.is-multiline):not([data-label-for])');
    const outerLabels = labels.filter(l => !⟦self encloses: l⟧);
    const labelDists = outerLabels.map(l => [l, ⟦self distanceTo: l⟧]).filter(([l,d]) => d < 20);
    if (labelDists.length > 0) {
      const [label] = labelDists.thatWhichMinimizes(([l,d]) => d);
      if (label) ⟦self label: label⟧;
    }
  },
  ['at:']: (self, name) => {
    const g = self.domContainer.querySelector('[data-string="'+name+'"]');
    if (g && g.dataset.labelFor) {
      const arrow = byId(g.dataset.labelFor);
      if (arrow && arrow.dataset.target) {
        const target = byId(arrow.dataset.target); // Follow the arrow
        if (target) return target;
      }
    }
    return null;
  }
}

vtables['Arrow'] = {
  _parent: vtables['BoxGraph-Common'],

  ['initFromDOM:']: (self, path) => {
    /* In DOMMeta terms, a Mathcha arrow is recognised something like:
     * g .arrow-line {
         path .connection .real :shaft ,
         ( g { path :head1 } ) ? ,
         ( g { path :head2 } ) ?
       }
      But remember: we also have "fat arrows". Generally, any shape can
      be parsed as a connector: just determine the two endpoints.
    */
    self.dom = path; // Now I will inherit all messages
    path.arrow = self; // backlink
    if (⟦self isClosed⟧) throw [self, 'must not be closed!'];
    const endpoints = [ ⟦self pointAtFrac: 0⟧, ⟦self pointAtFrac: 1⟧ ];
    const lroot = ⟦self localRoot⟧;
    const arrowheads = Array.from(lroot.querySelectorAll('g'));
    let arrowheadIndex = null;
    if (arrowheads.length === 1) {
      const m = arrowheads[0].transform.baseVal[0].matrix;
      const pt = [m.e, m.f];
      const [d0,d1] = [dist2(pt,endpoints[0]), dist2(pt,endpoints[1])];
      if (d0 < d1) arrowheadIndex = 0;
      else arrowheadIndex = 1;
      endpoints[arrowheadIndex] = pt;
    }
    self.endpoints = endpoints; // cache on self
    const connectionIds = endpoints.map(([x,y]) => {
      const elems = document.elementsFromPoint(x,y);
      let topmost = null;
      for (topmost of elems) {
        if (!lroot.contains(topmost)) break;
      }
      if (topmost && topmost !== svg_parent) return ⟦topmost id⟧;
    });
    if (arrowheadIndex !== null) {
      self.dom.dataset.origin = connectionIds[1-arrowheadIndex];
      self.dom.dataset.target = connectionIds[arrowheadIndex];
      self.arrowheadIndex = arrowheadIndex; // cache on self
    } else {
      self.dom.dataset.connects = connectionIds.join(' ');
    }
  },
  ['originPt']: (self) => {
    if (self.arrowheadIndex === undefined) return null;
    return self.endpoints[1-self.arrowheadIndex];
  },
  // Arrow >> claimLabel
  //   labels := all('.is-paragraph:not(.is-multiline)').
  //   label := labels minimizing: [ :l | self originPt distanceTo: l ].
  //   self label: label.
  ['claimLabel']: (self) => {
    const labels = all('.is-paragraph:not(.is-multiline)');
    const label = labels.thatWhichMinimizes(l => ⟦⟦self originPt⟧ distanceTo: l⟧);
    ⟦self label: label⟧;
  },
}

vtables.byTag['rect']['parseAsBox'] = (self) => {
  const box = { vtable: 'Box' }; // HACK constructors
  ⟦box initFromDOM: self⟧;
  return box;
}

vtables.byTag['path']['parseAsConnector'] = (self) => {
  const arrow = { vtable: 'Arrow' }; // HACK constructors
  ⟦arrow initFromDOM: self⟧;
  return arrow;
}

// Run on boxGraph-example.svg after init()
parseBoxGraph = function() {
  arrows = [];
  all('polyline') .forEach(l => arrows.push(⟦l parseAsConnector⟧));
  all('path.real').forEach(l => arrows.push(⟦l parseAsConnector⟧));
  realArrows = arrows.filter(a => ⟦a originPt⟧ !== null);
  realArrows.forEach(arr => ⟦arr claimLabel⟧);

  boxes = all('rect').map(r => ⟦r parseAsBox⟧);
  boxes.forEach(b => ⟦b claimLabel⟧);

  return generateJSOG();
}

generateJSOG = function() {
  log('Generating JS object graph.');
  all('rect').forEach(r => {
    const obj = {};
    const labelId = r.dataset.label;
    if (labelId) {
      const label = byId(labelId);
      obj.name = label.dataset.string;
    }
    r.obj = obj;
    const codePara = r.parentElement.querySelector('.is-multiline');
    if (codePara) {
      obj.code = codePara.dataset.string;
    }
  });
  all('.connection[data-label]').forEach(arr => {
    const label = byId(arr.dataset.label).dataset.string;
    const origin = byId(arr.dataset.origin).obj;
    const target = byId(arr.dataset.target).obj;
    origin[label] = target;  
  });
  
  objs = {};
  nextObj = 1;
  ensureName = str => str ? str : 'anon'+(nextObj++);
  all('rect').forEach(r => { objs[ensureName(r.obj.name)] = r.obj; });
  return objs;
}

// === IdObjModel SEMANTIC LAYER ===

vtables['Arrow']['checkIfSeparator'] = (self) => {
  if (typeof self.arrowheadIndex === 'number') return false;
  self.dom.classList.add('methods-are-below');
  return true;
}

vtables['Box']['methodAt:'] = (self, name) => {
  const method = ⟦self at: name⟧;
  // HACK duped from Box >> at:
  const para = self.domContainer.querySelector('[data-string="'+name+'"]');
  const separator = self.domContainer.querySelector('.methods-are-below');
  if (!separator) throw [self, 'doesn\'t have methods'];
  const pt_y = para.getBBox().y;
  const y = separator.arrow.endpoints[0][1];
  if (pt_y > y) return method; // methods live below separator
  return null;
}

parseAsObjModel = function() {
  arrows.forEach(a => ⟦a checkIfSeparator⟧);
}