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
      throw [recv," didn't understand: ", args[0], args];
    else
      return sendNoKw(recv, 'doesNotUnderstand:', [selector, ...args]);
  }
  return method(recv, ...args);
}

vtables.geometric = {
  ['distanceTo:']: (self, other) =>
    Math.sqrt(distance2_line_segs_to_segs(⟦self lineSegments⟧, ⟦other lineSegments⟧)),
};

vtables.point = {
  _parent: vtables.geometric,
  /*
  ['distanceTo:']: (self, other) => {
    if (other instanceof Array && other.length === 2) {
      return Math.sqrt(dist2(self, other));
    } else { // Assumes < domNode
      const closest = closest_line_seg_to_pt(self, ⟦other lineSegments⟧);
      return Math.sqrt(distance2_pt_to_line_seg(self, ...closest));
    }
  },*/
  ['lineSegments']: (self) => [[self, self]],
  ['vertices']: (self) => [self],
  ['insideWhichShapes:']: (self, shapes) =>
    shapes.filter(s => ⟦s containsPt: self⟧).sort(inTopToBottomOrder),
  ['pickFrom:']: (self, shapes) => {
    shapes = ⟦self insideWhichShapes: shapes⟧;
    if (shapes.length > 0) return shapes[0];
    else return nilElem;
  },
  ['closestPointOn:']: (self, shape) => ⟦shape closestPtToPt: self⟧,
};

nextId = 1;

vtables.domNode = {
  _parent: vtables.geometric,

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
      'path': 'e', 'polygon': 'p', 'polyline': 'pl',
      'text': 't', 'circle': 'c', 'rect': 'r', 'line': 'l'
    }[self.tagName];
    if (!ret) ret = 'e';
    return ret;
  },
  ['containsPt:']: (self, [x,y]) => {
    const bb = self.getBBox();
    const [l,t,r,b] = [bb.x,bb.y,bb.x+bb.width,bb.y+bb.height];
    return l<=x && x<=r && t<=y && y<=b;
  },
  ['encloses:']: (self, other) => 
    ⟦other vertices⟧.every(v => ⟦self containsPt: v⟧),  // SMELL convex polys only
  ['covers:']: (self, other) => {
    const self_minus_other = inTopToBottomOrder(self, other);
    return self_minus_other < 0;
  },
  ['vertices']: (self) => {
    const bb = self.getBBox(); // SMELL duped
    const [l,t,r,b] = [bb.x,bb.y,bb.x+bb.width,bb.y+bb.height];
    return [ [l,t], [r,t], [r,b], [l,b] ];
  },
  ['centerPt']: (self) => {
    const verts = ⟦self vertices⟧;
    let sum = [0,0];
    for (let v of verts) sum = vadd(sum, v);
    return vmul(1/verts.length, sum);
  },
  ['isClosed']: (self) => true,
  ['lineSegments']: (self) => explode_poly_segs(⟦self vertices⟧, ⟦self isClosed⟧),
  /*['distanceTo:']: (self, other) => {
    if (other instanceof Array) return ⟦other distanceTo: self⟧;
    return Math.sqrt(distance2_line_segs_to_segs(⟦self lineSegments⟧, ⟦other lineSegments⟧));
  },*/
  ['signedDistanceToPt:']: (self, pt) => {
    const dist = ⟦self distanceTo: pt⟧;
    return ⟦self containsPt: pt⟧ ? -dist : dist;
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
        // If it doesn't, but the rival covers my current container (it sits above in the draw order)
        // then it takes priority
        if (container === null || ⟦container encloses: rival⟧ || ⟦rival covers: container⟧)
          container = rival;
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
  ['atPoint:pickFrom:']: (self, pt, shapes) => ⟦pt pickFrom: shapes.filter(s => s !== self)⟧,
  ['connectors']: (self) => {
    if (self.dataset.connectors) return setAttrToArray(self.dataset.connectors).map(byId);
    return [];
  },
  ['isArrowhead']: (self) => false,
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
  ['closestPtToPt:']: (self, pt) => closestPointOnPath(self, pt),
  ['containsPt:']: (self, pt) => {
    if (!⟦self isClosed⟧) {
      const {point, d2} = ⟦pt closestPointOn: self⟧;
      if (d2 < 4) return true;
      return false;
    }
    return vtables.domNode['containsPt:'](self, pt); // HACK supersend. Also too coarse
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
  ['localRoot']: (self) => self.parentElement, // SMELL: wrong for arrowheads
  ['endpoints']: (self) => {
    if (⟦self isClosed⟧) return [];
    return [ ⟦self pointAtFrac: 0⟧, ⟦self pointAtFrac: 1⟧ ];
  },
  ['connections']: (self) => {
    if (self.dataset.connects) return self.dataset.connects.split(' ').map(byId);
    if (self.dataset.origin && self.dataset.target
      && self.dataset.origin !== 'nil' && self.dataset.target !== 'nil')
      return [self.dataset.origin, self.dataset.target].map(byId);
    const endpoints = ⟦self endpoints⟧;
    const connections = endpoints.map(pt => ⟦self atPoint: pt pickFrom: Object.values(everything)⟧);
    self.dataset.connects = connections.map(c => ⟦c id⟧).join(' ');
    const myId = ⟦self id⟧;
    connections.forEach(e => addSetAttr(e.dataset, 'connectors', myId))
    return connections;
  },
  ['isArrowhead']: (self) => self.parentElement.tagName === 'g'
    && self.parentElement.parentElement.classList.contains('arrow-line'), // Mathcha-specific
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
  ['closestPtToPt:']: (self, pt)=> {
    const segs = ⟦self lineSegments⟧;
    const closest_seg = closest_line_seg_to_pt(pt, segs);
    return closest_pt_on_line_seg(pt, ...closest_seg);
  },
  ['specialize']: (self) => {
    let newTag = null;
    const points = ⟦self vertices⟧;
    if (points.length === 2) {
      attr(self, {x1: points[0][0], y1: points[0][1], x2: points[1][0], y2: points[1][1]});
      newTag = 'line';
    }
    if (newTag) {
      self = replaceTag(self, newTag);
      self.removeAttribute('points');
      return self;
    }
    return null;
  },
};

vtables.byTag['line'] = {
  _parent: vtables.byTag['polyline'],

  ['vertices']: (self) => [attrs(self, 'x1', 'y1'), attrs(self, 'x2', 'y2')].map(pt => pt.map(parseFloat)),
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

MAGIC_RED = 'rgb(208, 2, 27)';
vtables.byTag['rect'] = {
  _parent: vtables.byTag['polygon'],

  ['vertices']: (self) => {
    const [x,y,w,h] = attrs(self, 'x', 'y', 'width', 'height').map(Number);
    return [ [x,y], [x+w,y], [x+w,y+h], [x,y+h] ];
  },
  ['specialize']: () => null,
  ['parseAsExecutable']: (self) => {
    // Check for executable boxes
    if (self.style.stroke === MAGIC_RED) {
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
    const parent_g = self.parentElement;
    const red_box = parent_g.firstChild; // SMELL nondeterminism
    let targets = [parent_g.parentElement.firstChild]; // SMELL nondeterminism
    const conns = ⟦red_box connectors⟧;
    if (conns.length > 0) // Find the connections that aren't the red box itself
      targets = conns.map(c => ⟦c connections⟧.filter(x => x !== red_box)[0]);
    if (self.classList.contains('sets-id')) {
      // #myId para sets target id=myId and self-deletes
      // SMELL what if new ID already in use
      if (targets.length > 1) throw [self, 'sets-id needs exactly 1 target'];
      const target = targets[0];
      if (target.id !== 'nil') {
        const newId = str.substring(1);
        const clash = byId(newId);
        if (clash) clash.id = target.id;
        target.id = newId;
      }
      self.classList.add('done');
    } else if (self.classList.contains('adds-class')) {
      // .myClass line adds myClass to container and self-deletes
      lines.forEach(l => {
        targets.forEach(target => target.classList.add(l.substring(1)));
      });
      self.classList.add('done');
    } else if (self.classList.contains('is-code')) {
      eval(str); // >:D
      self.classList.add('done');
    }
    conns.forEach(c => c.classList.add('done'));
  }
}

// Of a connector (open path) c, we must be able to ask:
// c endpoints -> [p1, p2]
// c connections -> [el1, el2]
// c origin/target -> el or null

// === MATHCHA ARROW SUPPORT ===

/* In DOMMeta terms, a Mathcha arrow is recognised something like:
  * g .arrow-line {
      path .connection .real :shaft ,
      ( g { path :head1 } ) ? ,
      ( g { path :head2 } ) ?
    }
  But remember: we also have "fat arrows". Generally, any shape can
  be parsed as a connector: just determine the two endpoints.
  However, such "generalised connector" behaviour should probably not
  live in Path.
*/

vtables.byTag['path']['target'] = (self) => {
  if (self.dataset.target) return byId(self.dataset.target);
  const endpoints = ⟦self endpoints⟧;
  const lroot = ⟦self localRoot⟧;
  const arrowheads = Array.from(lroot.querySelectorAll('g'));
  let originPt = null;
  let target = nilElem;
  if (arrowheads.length === 1) {
    const m = arrowheads[0].transform.baseVal[0].matrix;
    const targetPt = [m.e, m.f];
    const [d0,d1] = [dist2(targetPt,endpoints[0]), dist2(targetPt,endpoints[1])];
    const originIndex = d0 < d1 ? 1 : 0;
    self.dataset.originIndex = originIndex;
    originPt = endpoints[originIndex];
    target = ⟦self atPoint: targetPt pickFrom: Object.values(everything)⟧;
  }
  self.dataset.origin = 'nil';
  self.dataset.target = 'nil';
  if (originPt) {
    const origin = ⟦self atPoint: originPt pickFrom: Object.values(everything)⟧;
    if (origin) {
      self.dataset.origin = ⟦origin id⟧;
      addSetAttr(origin.dataset, 'connectors', ⟦self id⟧);
    }
  }
  if (target) {
    self.dataset.target = ⟦target id⟧;
    addSetAttr(target.dataset, 'connectors', ⟦self id⟧);
  }
  return target;
}

vtables.byTag['path']['origin'] = (self) => {
  if (self.dataset.origin) return byId(self.dataset.origin);
  ⟦self target⟧;
  return byId(self.dataset.origin);
}

vtables.byTag['path']['isDirected'] = (self) => {
  ⟦self target⟧;
  return !isNaN(parseInt(self.dataset.originIndex));
}

vtables.byTag['path']['originPt'] = (self) => {
  if (⟦self isDirected⟧) {
    const endpoints = ⟦self endpoints⟧;
    return endpoints[+self.dataset.originIndex];
  }
}

vtables.byTag['path']['targetPt'] = (self) => {
  if (⟦self isDirected⟧) {
    const endpoints = ⟦self endpoints⟧;
    return endpoints[1 - +self.dataset.originIndex];
  }
}

everything = {};
// Universal entry point; mandatory for all diagrams
function init() {
  // First, ensure "nil" exists
  nilElem = svgel('g', {id: 'nil'});

  // Next, we must normalise the document. That means:
  // 1. Specialise individual shapes as far as possible (eg path -> polygon -> rect)
  //    (see principles/1-most-specialized-tag.svg)
  // 2. Reshape the DOM tree to reflect spatial containment relations
  //    (see principles/2-dom-tree-spatial-containment.svg)
  // [FUTURE]
  //   3. Ensure all closed shape nodes are in Closed Canonical Form:
  //
  //      <g> boundary-wrapper
  //        <shape ... /> boundary-shape
  //        <g> ... </g> shape-interior
  //      </g>
  //
  //      And all open path nodes (path, polyline, line, etc) are in Open Canonical Form:
  //
  //      <g> connector-wrapper
  //        <path ... /> connector-shaft
  //        <g> ... </g> connector-heads
  //      </g>
  // [/FUTURE]
  //
  // First, gather all (MATHCHA-EXPORTED) shapes and text. 
  let elems = all('path.real, polygon');
  elems = elems.concat(all('g').filter(g => ⟦g parseAsParagraph⟧));
  elems.forEach((el) => {
    let newEl = el;
    let max_iter = 10; // SMELL arbitrary maximum
    do { // max specialize
      el = newEl;
      newEl = ⟦el specialize⟧;
      max_iter--;
    } while (max_iter > 0 && newEl);
    everything[ ⟦el id⟧ ] = el;
  });

  elems = Object.values(everything);
  // Next, compute spatial containment tree; store in
  // contained-in / contains dataset attributes
  elems.forEach(el => ⟦el findTightestContainerIn: elems⟧);
  
  // Now, reroot each node inside its tightest container
  // and erase the evidence :)
  all('[data-contained-in]').forEach(child => {
    ⟦child reroot⟧;
    delete child.dataset.containedIn;
  });
  all('[data-contains]').forEach(e => {
    delete e.dataset.contains;
  });

  // Now, detect probe connectors for "magic red" ID / Code boxes
  // FUTURE: should be an explicit GraphNotation or something
  const codeConnectors = Object.values(everything)
    .filter(x => !⟦x isClosed⟧)
    .filter(x => x.style.stroke === MAGIC_RED);
  codeConnectors.forEach(c => ⟦c connections⟧);

  // TODO: need to save code to execute until ALL processing done
  // even with further formats. I.e. delay execution to point where
  // the diagram "means" that which was intended by the user

  // Inspect each rect to see if it's a Magic red box.
  // Will annotate inner paragraphs with .adds-class, .sets-id, or .is-code as applicable
  all('rect').forEach(r => ⟦r parseAsExecutable⟧);
  // Add classes and set IDs first
  all('.adds-class').forEach(p => ⟦p execute⟧); // must occur before sets-id
  all('.sets-id').forEach(p => ⟦p execute⟧);
  // Now, execute embedded JS
  try {
    all('.is-code').forEach(p => ⟦p execute⟧);
  } catch (e) {
    console.error(e);
  }
  // Re-inspect each rect, mark as done if all inner paragraphs are done
  all('rect').forEach(r => ⟦r parseAsExecutable⟧);
  //removeDone();

  return elems.length;
}

function removeDone() {
  all('.done').forEach(e => e.remove()); // WARNING: connections[*].connectors will be stale
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
// WARNING: likely to be obsoleted or reworked by Opus 4.7 collaboration

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
    self.dom = rect;
    rect.box = self; // backlink
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
  ['name']: (self) => {
    if (self.dom.dataset.label) return byId(self.dom.dataset.label).dataset.string;
    return null;
  },
  ['at:']: (self, name) => {
    const g = self.domContainer.querySelector('[data-string="'+name+'"]');
    if (g && g.dataset.labelFor) {
      const arrow = byId(g.dataset.labelFor);
      if (arrow && arrow.dataset.target) {
        const target = byId(arrow.dataset.target); // Follow the arrow
        if (target) return target.box;
      }
    }
    return null;
  }
}

vtables['Arrow'] = {
  _parent: vtables['BoxGraph-Common'],

  ['initFromDOM:']: (self, path) => {
    self.dom = path; // Now I will inherit all messages
    path.arrow = self; // backlink
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

vtables['BoxGraph'] = {
  _parent: null,

  ['parse']: (self) => {
    self.connectors = all('polyline, path.real, line').map(l => ⟦l parseAsConnector⟧);
    self.realArrows = self.connectors.filter(a => ⟦a isDirected⟧);
    self.realArrows.forEach(arr => ⟦arr claimLabel⟧);

    self.boxes = all('rect').map(r => ⟦r parseAsBox⟧);
    self.boxes.forEach(b => ⟦b claimLabel⟧);
  },
  ['boxNamed:']: (self, name) => {
    const label = some('g[data-string="'+name+'"');
    if (label) return byId(label.dataset.labelFor).box;
  }
}

// Run on boxGraph-example.svg after init()
parseBoxGraph = function() {
  boxGraph = { vtable: 'BoxGraph' }; // HACK constructors
  return ⟦boxGraph parse⟧;
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
// For id-vanilla.svg

vtables['Arrow']['checkIfSeparator'] = (self) => {
  if (⟦self isDirected⟧) return false;
  self.dom.classList.add('methods-are-below');
  return true;
}

vtables['Box']['methodAt:'] = (self, name) => {
  const method = ⟦self at: name⟧;
  // HACK duped from Box >> at:
  const para = self.domContainer.querySelector('[data-string="'+name+'"]');
  if (!para) return null;
  const separator = self.domContainer.querySelector('.methods-are-below');
  if (!separator) throw [self, 'doesn\'t have methods'];
  const pt_y = para.getBBox().y;
  const y = ⟦separator.arrow endpoints⟧[0][1];
  if (pt_y > y) return method; // methods live below separator
  return null;
}

vtables['Box']['asJSFunc'] = (self) => {
  const para = self.domContainer.querySelector('g.is-paragraph');
  const source = para.dataset.string;
  return eval(source); // >:D
}

// === CLAUDE OPUS 4.7 GENERATED ===

// === GraphNotation ===
//
// A parametrised "notation-class" for graph-shaped diagrams.
// Closed parametrisation: filter and definitions supplied as JS lambdas.
// Pure: produces nodes and edges. Labelling is a separate layer ("Labeller" below).
//
// Each instance is configured for a particular DOM region (scope). Elements
// outside the region, or failing the filter, are ignored. Within the region,
// elements satisfying defs.isNode become nodes; elements satisfying defs.isEdge
// (and not inside any node) become edges.
//
// Nodes are *opaque* to their containing GraphNotation: once an element is
// claimed as a node, its DOM subtree is not searched for further nodes or
// edges. (An inner notation-instance may search inside, with its own scope.)
//
// Assumes scope has been preprocessed so that DOM containment matches spatial
// containment.
//
// Lazy: parsing deferred until nodes/edges are demanded.

vtables['GraphNotation'] = {
  _parent: null,

  // scope:  DOM elem delimiting the region
  // filter: elem -> bool, which elems participate at all
  // defs:   { isNode: elem -> bool, isEdge: elem -> bool }
  ['fromRegion:filterBy:withDefs:']: (self, scope, filter, defs) => {
    self.scope = scope;
    self.filter = filter;
    self.defs = defs;
    return self;
  },

  ['nodes']: (self) => {
    if (self._nodes) return self._nodes;
    const pred = e => self.filter(e) && self.defs.isNode(e);
    const matches = ⟦self findIn: self.scope matching: pred excluding: new Set()⟧;
    self._nodes = matches.map(e => ⟦self wrapNode: e⟧);
    return self._nodes;
  },

  ['edges']: (self) => {
    if (self._edges) return self._edges;
    const nodeDoms = new Set(⟦self nodes⟧.map(n => n.dom));
    const pred = e => self.filter(e) && self.defs.isEdge(e);
    const matches = ⟦self findIn: self.scope matching: pred excluding: nodeDoms⟧;
    self._edges = matches.map(e => ⟦self wrapEdge: e⟧);
    return self._edges;
  },

  // Region-claiming traversal. Walks DOM tree from `root`, collecting elems
  // matching `pred` and skipping anything in `excluded`. Importantly, when a
  // shape matches or is excluded, everything spatially contained within
  // it gets skipped over. This is to keep the GraphNotation oblivious to the
  // contents of its nodes.
  ['findIn:matching:excluding:']: (self, root, pred, excluded) => {
    const matches = [];

    // Remember: currently, a shape and its contained children look like this:
    // <g> wrapper
    //   <shape ... /> <-- pred is called on this
    //   <child 1 />   }
    //   <child 2 />   }-- and we can only search these if the shape isn't
    //   ...           }   matched or in the exclude list
    // </g>
    //
    // visit returns true iff `elem` is fully handled — either it directly
    // matched/was-excluded, or it's the wrapper of something that did. The
    // caller uses this to know when to stop iterating elem's siblings.
    const visit = (elem) => {
      if (excluded.has(elem)) return true;
      if (pred(elem)) { matches.push(elem); return true; }

      for (const child of elem.children) {
        const childHandled = visit(child);
        // If child claimed itself AND elem is child's wrapper, elem is also
        // handled and elem's remaining children belong to the same conceptual
        // node — don't visit them.
        if (childHandled && ⟦child localRoot⟧ === elem) return true;
      }
      return false;
    };

    visit(root);
    return matches;
  },

  ['wrapNode:']: (self, elem) => ({ vtable: 'GraphNotation-Node', dom: elem, notation: self }),
  ['wrapEdge:']: (self, elem) => ({ vtable: 'GraphNotation-Edge', dom: elem, notation: self }),

  // Resolve a point to a node in this notation, if any. Use an empirical tolerance for e.g.
  // edge connectors that "just touch" the node border.
  ['nodeAtPt:']: (self, pt) => ⟦self nodes⟧.find(n =>
    ⟦n signedDistanceToPt: pt⟧ <= self.defs.endpointTolerance) || null,
};

// Shared protocol for the Node / Edge wrappers.
vtables['GraphNotation-Common'] = {
  // Forward unknown messages to the wrapped DOM element.
  ['doesNotUnderstand:']: (self, [selector, ...args]) => sendNoKw(self.dom, selector, ...args),
};

vtables['GraphNotation-Node'] = {
  _parent: vtables['GraphNotation-Common'],

  // Edges in the same notation that touch this node.
  ['incidentEdges']: (self) => ⟦self.notation edges⟧.filter(e => ⟦e connections⟧.includes(self)),
};

vtables['GraphNotation-Edge'] = {
  _parent: vtables['GraphNotation-Common'],

  // The (up to two) nodes this edge connects, in path order. May contain
  // null entries if an endpoint doesn't land on any node in this notation
  // (e.g. magic-red connectors to "nothing", or arrows whose endpoint sits
  // in blank space).
  ['connections']: (self) => {
    if (self._connections) return self._connections;
    self._connections = ⟦self endpoints⟧.map(pt => ⟦self.notation nodeAtPt: pt⟧);
    return self._connections;
  },

  ['origin']: (self) => ⟦self connections⟧[0],
  ['target']: (self) => ⟦self connections⟧[1],
};

isMathchaConnector = e => ['polyline','line'].includes(e.tagName)
        || e.tagName === 'path' && !send(e, 'isClosed') && !send(e, 'isArrowhead');

/* === USAGE SKETCHES ===

// "Default BoxGraph": rects as nodes, open paths as edges, anywhere in doc.
const boxGN = ⟦ GraphNotation
  fromRegion: document.documentElement
    filterBy: e => true,
    withDefs: {
      isNode: e => e.tagName === 'rect',
      isEdge: isMathchaConnector,
      endpointTolerance: 3,
    } ⟧;

// LabelGraph: text paragraphs as nodes. No Labelling layer — nodes ARE labels.
const labelGN = ⟦ GraphNotation
  fromRegion: document.documentElement
    filterBy: e => true,
    withDefs: {
      isNode: e => e.classList.contains('is-paragraph'),
      isEdge: isMathchaConnector,
      endpointTolerance: 20,
    } ⟧;

*/

// === Labeller ===
//
// Given a scope, a set of labels, and a set of labellables, draw Labelling
// Linkage Lines (LLLs) attaching labels to labellables in a one-to-one
// matching. Each label gets at most one labellable; each labellable gets at
// most one label.
//
// Labellables can be GraphNotation node wrappers, raw DOM elements, or any
// other objects — the supplied attractor and attachAt lambdas are what know
// how to interpret them. A Labeller doesn't require a base GraphNotation;
// any collection of elements can be labelled directly.
//
// Single-role: each Labeller handles one labellable-set. For multi-role
// labelling (e.g. BoxGraph's "arrows first, then boxes"), instantiate
// multiple Labellers and run in sequence — later passes naturally see
// fewer available labels because earlier passes have drawn LLLs from them.
//
// Matching is greedy by distance: all (label, labellable) pairs within
// maxDistance are sorted closest-first, and the walk claims each label and
// each labellable at most once. This is a greedy approximation to optimal
// bipartite matching, but is fine in practice — labels in real diagrams are
// placed unambiguously close to their intended labellables, and pathological
// cases are resolved by the user nudging the label.

ATTACHMENT_LINE_CLASS = 'attachment-line';

vtables['Labeller'] = {
  _parent: null,

  // scope:       DOM element delimiting the region (LLLs drawn into this)
  // labels:      () -> [label DOM elems]; called fresh each run, so it
  //              can naturally exclude already-claimed labels
  // labellables: () -> [labellables]; wrappers or raw elems
  // attractor:   labellable -> point | shape
  //              will judge via ⟦ label distanceTo: attractor(labellable) ⟧
  //              e.g. an arrow's attractor is its originPt; a rect's is itself
  // attachAt:    (labellable, labelPt) -> point on labellable where LLL
  //              should terminate (TODO: should just be closest pt on attractor?)
  // maxDistance: labels beyond this from any labellable are skipped
  ['inScope:withLabels:labellables:attractor:attachAt:maxDistance:']:
    (self, scope, labels, labellables, attractor, attachAt, maxDistance) => {
      self.scope = scope;
      self.labels = labels;
      self.labellables = labellables;
      self.attractor = attractor;
      self.attachAt = attachAt;
      self.maxDistance = maxDistance;
      return self;
    },

  // Run the labelling pass: enumerate (label, labellable) pairs within
  // maxDistance, sort closest-first, and greedily claim each label and each
  // labellable at most once. Returns the AttachmentGraph parsing the LLLs
  // drawn by THIS pass.
  ['run']: (self) => {
    const labels = self.labels();
    const labellables = self.labellables();
    const candidates = [];
    for (const label of labels) {
      for (const labellable of labellables) {
        const d = ⟦label distanceTo: self.attractor(labellable)⟧;
        if (d <= self.maxDistance) candidates.push({ label, labellable, d });
      }
    }
    candidates.sort((a, b) => a.d - b.d);
    const claimedLabels = new Set();
    const claimedLabellables = new Set();
    const drawnLines = new Set();
    for (const c of candidates) {
      if (claimedLabels.has(c.label) || claimedLabellables.has(c.labellable)) continue;
      claimedLabels.add(c.label);
      claimedLabellables.add(c.labellable);
      drawnLines.add(⟦self drawLLL: c.label to: c.labellable⟧);
    }
    self._drawnLines = drawnLines;
    self._claimedLabels = claimedLabels;
    self._claimedLabellables = claimedLabellables;
    return ⟦self attachmentGraph⟧;
  },

  ['drawLLL:to:']: (self, label, labellable) => {
    const [x1,y1] = ⟦label centerPt⟧;
    const [x2,y2] = self.attachAt(labellable, [x1,y1]);
    const wrapper = svgel('g', { class: ATTACHMENT_LINE_CLASS }, self.scope);
    return svgel('line', { x1, y1, x2, y2,
      style: 'stroke: magenta',
    }, wrapper);
  },

  // The AttachmentGraph: a GraphNotation parsing the LLLs drawn by this
  // run. Nodes are labels + labellables; edges are the LLLs.
  ['attachmentGraph']: (self) => {
    const drawn = self._drawnLines || new Set();
    const labelDoms = self._claimedLabels || new Set();
    const labellableDoms = new Set(
      Array.from(self._claimedLabellables || []).map(l => l.dom || l)
    );
    return send({ vtable: 'GraphNotation' },
      'fromRegion:', self.scope,
      'filterBy:', e => drawn.has(e) || labelDoms.has(e) || labellableDoms.has(e),
      'withDefs:', {
        isNode: e => labelDoms.has(e) || labellableDoms.has(e),
        isEdge: e => drawn.has(e),
        endpointTolerance: 1,
      }
    );
  },
};

// Helper: a labels-function that excludes labels already terminated-on by
// any existing attachment-line in scope. Use as the `labels` arg for any
// Labeller pass that should respect prior passes.
unclaimedLabels = function(scope, allLabelsSelector) {
  return () => {
    const allLabels = Array.from(scope.querySelectorAll(allLabelsSelector));
    const lines = Array.from(scope.querySelectorAll('.'+ATTACHMENT_LINE_CLASS+' > line'));
    // A label is claimed if any LLL's endpoint is inside its bounding box.
    const claimed = new Set();
    for (const line of lines) {
      const endpoints = ⟦line endpoints⟧;
      for (const label of allLabels) {
        if (⟦label containsPt: endpoints[0]⟧ || ⟦label containsPt: endpoints[1]⟧)
          claimed.add(label);
      }
    }
    return allLabels.filter(l => !claimed.has(l));
  };
};

ALL_LABELS = '.is-paragraph:not(.is-multiline)';

// boxGraph-example.svg
function parametric_boxgraph_init(scope) {
  // "Default BoxGraph": rects as nodes, open paths as edges, anywhere in doc.
  boxGN = send({ vtable: 'GraphNotation' },
    'fromRegion:', scope,
    'filterBy:', e => true,
    'withDefs:', {
      isNode: e => e.tagName === 'rect',
      isEdge: isMathchaConnector,
      endpointTolerance: 3,
  });

  // Pass 1: arrows claim labels nearest their origin points (no max distance —
  // arrows need labels).
  arrowLabeller = send({ vtable: 'Labeller' },
    'inScope:', boxGN.scope,
    'withLabels:', () => Array.from(boxGN.scope.querySelectorAll(ALL_LABELS)),
    'labellables:', () => ⟦boxGN edges⟧,
    'attractor:', edge => ⟦edge originPt⟧,
    'attachAt:', (edge, labelPt) => ⟦edge originPt⟧,
    'maxDistance:', Infinity
  );
  arrowAttachments = ⟦arrowLabeller run⟧;

  // Pass 2: boxes claim from remaining labels, within 20px.
  boxLabeller = send({ vtable: 'Labeller' },
    'inScope:', boxGN.scope,
    'withLabels:', unclaimedLabels(boxGN.scope, ALL_LABELS),
    'labellables:', () => ⟦boxGN nodes⟧,
    'attractor:', node => node.dom,
    'attachAt:', (node, labelPt) => ⟦node.dom closestPtToPt: labelPt⟧,
    'maxDistance:', 20
  );
  boxAttachments = ⟦boxLabeller run⟧;

  return {boxGN, boxAttachments, arrowAttachments};
}

// Restructure a node's wrapper so its non-rect siblings are gathered into a
// new inner-scope <g>. Returns the new inner-scope element, suitable for use
// as an inner notation's scope.
function makeInnerScope(node) {
  const wrapper = ⟦node localRoot⟧;
  const innerScope = svgel('g', { class: 'shape-interior' }, wrapper);
  Array.from(wrapper.children)
    .filter(c => c !== node && c !== innerScope)
    .forEach(c => innerScope.appendChild(c));
  return innerScope;
}

// === DefaultMetaNotation ===
//
// A meta-notation: interprets a region of the diagram as a set of
// notation-instance regions. Each region is a labelled node whose outgoing
// edge points to the name of the notation that should parse its contents.
//
// Built from: a Labeller (paragraphs attach to blue rects as names) and
// a GraphNotation (blue rects + unclaimed paragraphs as nodes; blue arrows
// as edges). The user-facing surface is `regions`, with each region
// exposing `myName`, `notationName`, and `innerScope`.

isBlueStroke = e => e.style && e.style.stroke === 'rgb(74, 144, 226)'; // Magic blue

vtables['DefaultMetaNotation'] = {
  _parent: null,

  ['fromRegion:']: (self, scope) => {
    self.scope = scope;
    return self;
  },

  // Lazy: ensure the labelling pass has run; cache the AttachmentGraph.
  ['labelAttachments']: (self) => {
    if (self._labelAttachments) return self._labelAttachments;
    const blueBoxes = () => Array.from(self.scope.querySelectorAll('rect')).filter(isBlueStroke);
    const isInsideBlueBox = e => blueBoxes().some(box => box.parentElement.contains(e));
    self._labeller = send({ vtable: 'Labeller' },
      'inScope:', self.scope,
      'withLabels:', () => Array.from(self.scope.querySelectorAll(ALL_LABELS))
                                .filter(l => !isInsideBlueBox(l)),
      'labellables:', () => Array.from(self.scope.querySelectorAll('rect')).filter(isBlueStroke),
      'attractor:', box => box,
      'attachAt:', (box, labelPt) => ⟦box closestPtToPt: labelPt⟧,
      'maxDistance:', 30
    );
    self._labelAttachments = ⟦self._labeller run⟧;
    return self._labelAttachments;
  },

  // Lazy: ensure labeller has run, then build the underlying graph.
  ['graph']: (self) => {
    if (self._graph) return self._graph;
    // Pass 1: each blue box claims the closest paragraph within 30px as its
    // label. The remaining (unclaimed) paragraphs become arrow-target nodes
    // for the outer GraphNotation below.
    ⟦self labelAttachments⟧;  // dependency: graph's isNode reads _claimedLabels
    // Pass 2, the outer "BoxGraph meta-notation": blue boxes are nodes, AND any
    // paragraph not claimed as a label is also a node (e.g. the "BoxGraph"
    // arrow-target text). Edges are blue open paths.
    self._graph = send({ vtable: 'GraphNotation' },
      'fromRegion:', self.scope,
      'filterBy:', e => true,
      'withDefs:', {
        isNode: e => (e.tagName === 'rect' && isBlueStroke(e))
                  || (e.matches && e.matches(ALL_LABELS) 
                      && !self._labeller._claimedLabels.has(e)),
        isEdge: e => isBlueStroke(e) && isMathchaConnector(e),
        endpointTolerance: 15, // Empirically determined from notational-dispatch-1.svg...
      });
    return self._graph;
  },

  // The named regions: labelled nodes wrapped with extra accessors.
  ['regions']: (self) => {
    if (self._regions) return self._regions;
    const graph = ⟦self graph⟧;  // also ensures labeller has run
    const named = self._labeller._claimedLabellables;
    self._regions = ⟦graph nodes⟧
      .filter(node => named.has(node.dom))
      .map(node => ⟦self wrapRegion: node⟧);
    return self._regions;
  },

  ['wrapRegion:']: (self, gnNode) =>
    ({ vtable: 'DefaultMetaNotation-Region', gnNode, metaNotation: self }),
};

vtables['DefaultMetaNotation-Region'] = {
  _parent: null,

  // Forward unknown messages to the wrapped GN-Node (which forwards to dom).
  ['doesNotUnderstand:']: (self, [selector, ...args]) =>
    sendNoKw(self.gnNode, selector, ...args),

  // The label text attached to this region.
  ['name']: (self) => {
    const attach = ⟦self.metaNotation labelAttachments⟧;
    const incident = ⟦attach edges⟧.filter(e =>
      ⟦e connections⟧.some(n => n && n.dom === self.gnNode.dom));
    if (incident.length === 0) return null;
    const labelNode = ⟦incident[0] connections⟧.find(
      n => n && n.dom !== self.gnNode.dom);
    return labelNode ? labelNode.dom.dataset.string : null;
  },

  // The text of the label that this region's outgoing arrow points to.
  // TODO: largely duplicated from `name`, factor out
  ['notationName']: (self) => {
    const graph = ⟦self.metaNotation graph⟧;
    const incident = ⟦graph edges⟧.filter(e =>
      ⟦e connections⟧.some(n => n && n.dom === self.gnNode.dom));
    if (incident.length === 0) return null;
    const otherEnd = ⟦incident[0] connections⟧.find(
      n => n && n.dom !== self.gnNode.dom);
    return otherEnd ? otherEnd.dom.dataset.string : null;
  },

  // The DOM subtree for the inner notation. Lazy.
  ['innerScope']: (self) => {
    if (self._innerScope) return self._innerScope;
    self._innerScope = makeInnerScope(self.gnNode.dom);
    return self._innerScope;
  },
};

// notational-dispatch-1.svg
parametric_meta_boxgraph_init = function() {
  metaNotation = send({ vtable: 'DefaultMetaNotation' },
    'fromRegion:', document.documentElement);
  boxGraphs = [];
  for (region of ⟦metaNotation regions⟧) {
    const notationName = ⟦region notationName⟧;
    if (notationName !== 'BoxGraph') continue;  // skip for now
    const innerScope = ⟦region innerScope⟧;
    const myName = ⟦region name⟧;
    // build inner BoxGraph at innerScope
    const bg = parametric_boxgraph_init(innerScope);
    bg.name = myName;
    window[myName] = bg;
    boxGraphs.push(bg);
  }
  boxGraphs.forEach(bg => log(bg.name, ⟦bg.boxGN edges⟧[0]))
};

// === ID OBJ MODEL STUFF ===

/*
parseAsObjModel = function() {
  boxGraph.connectors.forEach(a => ⟦a checkIfSeparator⟧);

  const vt = ⟦boxGraph boxNamed: 'Vtable'⟧;
  id_vtable_lookup = ⟦vt methodAt: 'lookup'⟧;

  id_send   = ⟦⟦boxGraph boxNamed: 'id_send'⟧ asJSFunc⟧;
  id_bind   = ⟦⟦boxGraph boxNamed: 'id_bind'⟧ asJSFunc⟧;
  id_vtable = ⟦⟦boxGraph boxNamed: 'id_vtable'⟧ asJSFunc⟧;
}
*/

// Translate the code in id-simple.svg to access the right state...!
/*
id_vtable = (o) => ⟦o at: 'vtable'⟧;

function id_bind(recv, selector) {
  if (⟦recv name⟧ === 'Vtable' && selector === 'lookup')
    return id_vtable_lookup;
  return id_send(id_vtable(recv), 'lookup', selector);
}

function id_send(recv, selector, ...args) {
  let method = id_bind(recv, selector);
  if (!method)
    throw [recv, 'Does Not Understand', selector, ...args];
  let js_func = ⟦method asJSFunc⟧;
  return js_func(recv, ...args);
}

function vtable_lookup(self, symbol) {
  let method = ⟦self methodAt: symbol⟧;
  if (method) return method;
  let parent = ⟦self at: 'parent'⟧;
  if (parent) return id_send(parent, 'lookup', symbol);
}
*/