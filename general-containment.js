vtables = { byTag: {}, };

// We want to be able to send Smalltalk-style messages to SVG DOM nodes
// e.g. send(rectElem, 'doSomething:', blah1, 'with:', blah2, 'and:', blah3)
// = sendNoKw(rectElem, 'doSomething:with:and:', blah1, blah2, blah3)
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
    let id = attr(self, 'id');
    if (!id) {
      const prefix = send(self, 'idPrefix');
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
    const otherVs = send(other, 'vertices'); // SMELL convex polys only
    for (const v of otherVs) {
      if (!send(self, 'containsPt:', v)) return false;
    }
    return true;
  },
  ['vertices']: (self) => {
    const bb = self.getBBox(); // SMELL duped
    const [l,t,r,b] = [bb.x,bb.y,bb.x+bb.width,bb.y+bb.height];
    return [[l,t], [r,t], [r,b], [l,b]];
  },
  ['specialize']: (self) => null,
  ['localRoot']: (self) => self,
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
  ['specialize']: (self) => {
    let newTag = null;
    if (!send(self, 'isCurved')) { // => Polygon | Polyline
      const polyPts = polyFromPath(send(self, 'commands')).map(v => v.join(',')).join(' ');
      attr(self, 'points', polyPts);
      newTag = send(self, 'isClosed')? 'polygon' : 'polyline';
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

polyFromPath = function(cmds) {
  const vertices = [[0,0]];
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
  ['isClosed']: (self) => false,
  ['isCurved']: (self) => false,
  ['commands']: (self) => {
    let vs = send(self, 'vertices');
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
    const vertices = send(self, 'vertices');
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
    const vs = send(self, 'vertices');
    return isPointInPolygon(pt, vs);
  },
  ['encloses:']: vtables.domNode['encloses:'],
}

// TY Claude
function isPointInPolygon(pt, poly) {
  const [x,y] = pt;
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
    const intersect = mightIntersect && isect_x > x;
    if (intersect) inside = !inside;
  }
  return inside;
}


vtables.byTag['rect'] = {
  _parent: vtables.byTag['polygon'],

  ['vertices']: (self) => {
    const [x,y,w,h] = attrs(self, 'x', 'y', 'width', 'height').map(Number);
    return [[x,y], [x+w,y], [x+w,y+h], [x,y+h]];
  },
  ['specialize']: () => null,
}

vtables.byTag['circle'] = {
  _parent: vtables.byTag['path'],

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
}

e = {};
function init() {
  const paths = all('path.real');
  let elems = paths.concat(all('polygon'));
  elems = elems.concat(all('g').filter(g => send(g, 'parseAsParagraph')));
  elems.forEach((el) => {
    let newEl = el;
    let max_iter = 10;
    do { // max specialize
      el = newEl;
      newEl = send(el, 'specialize');
      max_iter--;
    } while (max_iter > 0 && newEl);
    e[send(el, 'id')] = el;
  });

  elems = Object.values(e);
  // MUCH nicer code than annotateAllContainments plus treeifyContainments
  elems.forEach((el1, i) => {
    // elem i wants to find its least / tightest container
    let container = null;
    elems.forEach((el2, j) => {
      if (i !== j) {
        const rivalExists = send(el2, 'encloses:', el1);
        if (rivalExists) {
          const rival = el2;
          // If the rival sits within my current tightest container, rival is tighter
          if (container === null || send(container, 'encloses:', rival)) container = rival;
        }
      }
    });
    if (container) {
      addSetAttr(container.dataset, 'contains', send(el1, 'id'));
      el1.dataset.containedIn = send(container, 'id');
    }
  });
  
  // MUCH nicer than makeDOMReflectContainmentTree
  const elemsToReroot = all('[data-contained-in]');
  elemsToReroot.forEach(child => {
    let soonToBeParent = byId(child.dataset.containedIn);
    const parentRoot = send(soonToBeParent, 'localRoot');
    const childRoot = send(child, 'localRoot');
    parentRoot.appendChild(childRoot);
    delete soonToBeParent.dataset.contains;
    delete child.dataset.containedIn;
  });

  // From executeCode
  const codeBoxes = all('rect').filter(r => r.style.stroke === 'rgb(208, 2, 27)');
  const codeToEval = [];
  codeBoxes.forEach(r => {
    r.classList.add('is-code');
    const paras = Array.from(r.parentElement.querySelectorAll('.is-paragraph'));
    paras.forEach(p => {
      const str = p.dataset.string;
      // Special case: red box just containing #myId sets container id=myId and self-deletes
      if (paras.length === 1 && str.startsWith('#')) {
        const parent_g = r.parentElement.parentElement;
        // SMELL what if new ID already in use
        parent_g.firstChild.id = str.substring(1); // SMELL nondeterminism
        //r.parentElement.remove();
      } else codeToEval.push(str);
    })
  });
  codeToEval.forEach(eval);

  return elems.length;
}