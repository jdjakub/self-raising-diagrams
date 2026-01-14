vtables = { byTag: {}, };

// We want to be able to send Smalltalk-style messages to SVG DOM nodes
// e.g. send(rectElem, 'doSomething:', blah1, 'with:', blah2, 'and:', blah3)
// = sendNoKw(rectElem, 'doSomething:with:and:', blah1, blah2, blah3)
// NOTE: JSTalk syntax
//   ⟦ rectElem doSomething: blah1 with: blah2 and: blah3 ⟧
// should de-sugar (jstalk2js.pl) into the above send().
// BTW: the VS Code extension.js auto-replaces [[ -> ⟦ and ]] -> ⟧ as you type

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
  let vtable = vtables.byTag[recv.tagName];
  let method;
  do {
    method = vtable[selector];
    vtable = vtable._parent; // i.e. superclass
  } while (!method && vtable);
  if (!method && !vtable) throw ["Didn't understand: ",recv,selector,...args];
  return method(recv, ...args);
}

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
    return l<x && x<r && t<y && y<b;
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
  ['parseAsConnector']: (self) => {
    /* In DOMMeta terms, a Mathcha arrow is recognised something like:
     * g .arrow-line {
         path .connection .real :shaft ,
         ( g { path :head1 } ) ? ,
         ( g { path :head2 } ) ?
       }
      But remember: we also have "fat arrows". Generally, any shape can
      be parsed as a connector: just determine the two endpoints.
    */
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
    const connectionIds = endpoints.map(([x,y]) => {
      const elems = document.elementsFromPoint(x,y);
      let topmost = null;
      for (topmost of elems) {
        if (!lroot.contains(topmost)) break;
      }
      if (topmost && topmost !== svg_parent) return ⟦topmost id⟧;
    });
    if (arrowheadIndex !== null) {
      self.dataset.origin = connectionIds[1-arrowheadIndex];
      self.dataset.target = connectionIds[arrowheadIndex];
    } else {
      self.dataset.connects = connectionIds.join(' ');
    }
  },
};

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
      parent_focus.id = str.substring(1); 
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

  all('polyline').forEach(l => ⟦l parseAsConnector⟧);
  all('path.real').forEach(l => ⟦l parseAsConnector⟧);

  return elems.length;
}

/*
To support boxGraph:

vtables.path['claimLabel'] = (self) => {
  
}

In order for a generic shape (1D/2D) to claim a label, we want to use
a context-specific shape as proxy. E.g. for boxGraph, a 1D arrow claims
the closest label to its *origin point* (0D). Meanwhile, a 2D box claims
the closest label to its entire shape. Afterwards, max distances or further
restrictions are applied.

Premature commitment to the specific DOM. Want something more like:

(package boxGraph)

Arrow >> claimLabel
  labels := all('.is-paragraph').
  label := labels minimizing: [ :l | self originPt distanceTo: l ].
  self label: label.

Box >> claimLabel
  labels := all('.is-paragraph:not([data-label-for])').
  label := (labels outside: self) minimizing: [ :l | self distanceTo: l ].
  self label: label.
*/