vtables = { byTag: {}, };

// We want to be able to send Smalltalk-style messages to SVG DOM nodes
// e.g. send(rectElem, 'doSomething:', blah1, 'with:', blah2, 'and:', blah3)
// = sendNoKw(rectElem, 'doSomething:with:and:', blah1, blah2, blah3)
// NOTE: JSTalk macro syntactic sugar
//   send(rectElem, 'doSomething:', blah1, 'with:', blah2, 'and:', blah3)
// should expand (jstalk2js.pl) into the above send().
// BTW: the VS Code extension.js auto-replaces [[ -> ⟦ and ]] -> ⟧ as you type
// If the sugar isn't working for you, just work with the verbose .js output file

// This could be a macro itself, but it's convenient to retain the interleaved syntax
// in the browser debugger, for readability.
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

// Used to add super-send support while keeping calls to send() backwards-compatible.
// Send to recv, starting the method search *from* a given vtable.
// SMELL: pairing logic duped from send()
// sendFrom just uses sendNoKwFrom instead of sendNoKw and passes vtable thru.
sendFrom = function(vtable, recv, ...pairs) {
  if (pairs.length === 1) return sendNoKwFrom(vtable, recv, ...pairs); // Unary message
  if (pairs.length % 2 !== 0) throw ['Odd args:', pairs]; // Binary / keyword message
  let selector = [];
  const args = [];
  for (let i=0; i<pairs.length; i += 2) {
    selector.push(pairs[i]);
    args.push(pairs[i+1]);
  }
  selector = selector.join('');
  return sendNoKwFrom(vtable, recv, selector, ...args);
}

sendNoKw = function(recv, selector, ...args) {
  let vtable;
  if (recv.tagName) vtable = vtables.byTag[recv.tagName];
  else if (recv instanceof Array && recv.length === 2) vtable = vtables.point;
  else if (typeof recv.vtable === 'string') vtable = vtables[recv.vtable];
  else vtable = recv.vtable;
  return sendNoKwFrom(vtable, recv, selector, ...args); 
}

IS_SUPER_AWARE = Symbol('isSuperAware');
// Methods that call `super` must be wrapped in this and declare a first
// param called `supr`. E.g. needsSuper((supr, self, arg1) => ...)
// JSTalk sugar supr('doSomething:', blah1, 'with:', blah2)
// will compile to supr('doSomething:', blah1, 'with:', blah2)
needsSuper = (fn) => { fn[IS_SUPER_AWARE] = true; return fn; };

sendNoKwFrom = function(vtable, recv, selector, ...args) {
  let resolverParent = vtable;
  let method;
  do {
    method = resolverParent[selector];
    resolverParent = resolverParent._parent; // i.e. superclass
  } while (!method && resolverParent);
  if (!method && !resolverParent) {
    if (selector === 'doesNotUnderstand:')
      throw [recv," didn't understand: ", args[0], args];
    else
      return sendNoKw(recv, 'doesNotUnderstand:', [selector, ...args]);
  }
  if (method[IS_SUPER_AWARE]) {
    const superSend = (...pairs) => {
      if (!resolverParent) throw [resolverParent, 'has no parent vtable'];
      return sendFrom(resolverParent, recv, ...pairs);
    }
    return method(superSend, recv, ...args);
  }
  return method(recv, ...args);
}

vtables.geometric = {
  ['distanceTo:']: (self, other) =>
    Math.sqrt(distance2_line_segs_to_segs(send(self, 'lineSegments'), send(other, 'lineSegments'))),
};

vtables.point = {
  _parent: vtables.geometric,
  /*
  ['distanceTo:']: (self, other) => {
    if (other instanceof Array && other.length === 2) {
      return Math.sqrt(dist2(self, other));
    } else { // Assumes < domNode
      const closest = closest_line_seg_to_pt(self, send(other, 'lineSegments'));
      return Math.sqrt(distance2_pt_to_line_seg(self, ...closest));
    }
  },*/
  ['lineSegments']: (self) => [[self, self]],
  ['vertices']: (self) => [self],
  ['insideWhichShapes:']: (self, shapes) =>
    shapes.filter(s => send(s, 'containsPt:', self)).sort(inTopToBottomOrder),
  ['pickFrom:']: (self, shapes) => {
    shapes = send(self, 'insideWhichShapes:', shapes);
    if (shapes.length > 0) return shapes[0];
    else return nilElem;
  },
  ['closestPointOn:']: (self, shape) => send(shape, 'closestPtToPt:', self),
};

nextId = 1;

vtables.domNode = {
  _parent: vtables.geometric,

  ['id']: (self) => {
    // TODO: pull in + exec any red boxes on demand!?
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
    send(other, 'vertices').every(v => send(self, 'containsPt:', v)),  // SMELL convex polys only
  ['covers:']: (self, other) => {
    const self_minus_other = inTopToBottomOrder(self, other);
    return self_minus_other < 0 && getComputedStyle(self).fill !== 'none';
  },
  ['vertices']: (self) => {
    const bb = self.getBBox(); // SMELL duped
    const [l,t,r,b] = [bb.x,bb.y,bb.x+bb.width,bb.y+bb.height];
    return [ [l,t], [r,t], [r,b], [l,b] ];
  },
  ['centerPt']: (self) => {
    const verts = send(self, 'vertices');
    let sum = [0,0];
    for (let v of verts) sum = vadd(sum, v);
    return vmul(1/verts.length, sum);
  },
  ['isClosed']: (self) => true,
  ['lineSegments']: (self) => explode_poly_segs(send(self, 'vertices'), send(self, 'isClosed')),
  ['distanceTo:']: (self, other) => {
    if (other instanceof Array) return send(other, 'distanceTo:', self);
    return Math.sqrt(distance2_line_segs_to_segs(send(self, 'lineSegments'), send(other, 'lineSegments')));
  },
  ['signedDistanceToPt:']: (self, pt) => {
    const dist = send(self, 'distanceTo:', pt);
    return send(self, 'containsPt:', pt) ? -dist : dist;
  },
  ['signedDistanceTo:']: (self, other) => {
    const dist = send(self, 'distanceTo:', other);
    return send(self, 'encloses:', other) ? -dist : dist;
  },
  ['findTightestContainerIn:']: (self, elems) => { // -> containedIn
    // MUCH nicer code than annotateAllContainments plus treeifyContainments
    // I want to find my least / tightest container
    let container = null; // Infinitely big initial container
    elems.filter(other => self !== other).forEach(other => {
      const rivalExists = send(other, 'encloses:', self);
      if (rivalExists) {
        const rival = other;
        // If the rival sits within my current tightest container, rival is tighter
        // If it doesn't, but the rival covers my current container (it sits above in the draw order)
        // then it takes priority
        if (container === null || send(container, 'encloses:', rival) || send(rival, 'covers:', container))
          container = rival;
      }
    });
    if (container) {
      addSetAttr(container.dataset, 'contains', send(self, 'id'));
      self.dataset.containedIn = send(container, 'id');
    }
  },
  ['specialize']: (self) => null,
  ['localRoot']: (self) => self,
  ['reroot']: (self) => { // Given: containedIn
    const soonToBeParent = byId(self.dataset.containedIn);
    let parentRoot = send(soonToBeParent, 'localRoot');
    parentRoot = parentRoot.querySelector('g.shape-interior') || parentRoot;
    const myRoot = send(self, 'localRoot');
    parentRoot.appendChild(myRoot);
  },
  ['atPoint:pickFrom:']: (self, pt, shapes) => send(pt, 'pickFrom:', shapes.filter(s => s !== self)),
  ['connectors']: (self) => {
    if (self.dataset.connectors) return setAttrToArray(self.dataset.connectors).map(byId);
    return [];
  },
  ['isArrowhead']: (self) => false,
  ['onClick:']: (self, handler) => { self.onclick = handler; },
  // Combine M (a DOMMatrix, from an ancestor) into this element's own transform,
  // parent on the left: point maps as M · ownM · p. Writes the result back as a
  // single consolidated matrix transform.
  ['premultiplyTransform:']: (self, M) => {
    const list = self.transform.baseVal;
    const own  = list.consolidate(); // single SVGTransform, or null
    const combined = own ? M.multiply(own.matrix) : M;
    list.initialize(svg_parent.createSVGTransformFromMatrix(combined));
  },
  // matrix(1,0,0,1,tx,ty) → translate(tx,ty); identity → remove entirely.
  // Leaves genuine scale/rotation matrices untouched (baking those would need
  // stroke-width scaling / rect→polygon, deferred).
  ['simplifyTransform']: (self) => {
    const list = self.transform.baseVal;
    const t = list.consolidate();
    if (!t) { self.removeAttribute('transform'); return; }
    const m = t.matrix;
    if (isNearIdentity(m)) t.setTranslate(...legible(m.e, m.f));
  },
  // Default: this element type doesn't bake translations into geometry —
  // keep the transform on the element. Tag vtables override where they can.
  ['bakeTransform']: (self) => false,
  // Assumes self's transform is already simplified. After this method:
  //   • self has its transform baked into geometry (no-op on <g>)
  //   • each child has self's transform premultiplied AND simplified
  //   • self's transform attribute is cleared
  // Pushes to children even when self bakes (e.g. <text> bakes its x/y lists
  // AND pushes to its <tspan>s, which carry their own coords).
  ['pushTransformToChildren']: (self) => {
    const t = self.transform.baseVal.consolidate();
    send(self, 'bakeTransform');
    if (t) {
      const M = t.matrix;
      for (const c of self.children) {
        send(c, 'premultiplyTransform:', M);
        send(c, 'simplifyTransform');
      }
    }
    self.transform.baseVal.clear();
    self.removeAttribute('transform');
  },
  ['pushTransformToDescendants']: (self) => {
    send(self, 'pushTransformToChildren');
    [...self.children].forEach(c => send(c, 'pushTransformToDescendants'));
  },
  ['interior']: (self) => send(send(self, 'localRoot'), 'interior'),
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
  ['tangentAtFrac:']: (self, frac /* 0 to 1 */) => {
    const epsilon = 0.0001;
    const pt = send(self, 'pointAtFrac:', frac);
    let delta;
    if (frac > epsilon) {
      const prevPt = send(self, 'pointAtFrac:', frac-epsilon);
      delta = vsub(pt, prevPt);
    } else {
      const postPt = send(self, 'pointAtFrac:', frac+epsilon);
      delta = vsub(postPt, pt);
    }
    return vnormed(delta);
  },
  ['outwardTangentAt:']: (self, frac /* 0 to 1 */) => {
    const tangent = send(self, 'tangentAtFrac:', frac);
    return frac < 0.5 ? neg(tangent) : tangent;
  },
  ['closestPtToPt:']: (self, pt) => closestPointOnPath(self, pt),
  ['containsPt:']: needsSuper((supr, self, pt) => {
    if (!send(self, 'isClosed')) {
      /*const {point, d2} = send(pt, 'closestPointOn:', self);
      if (d2 < 4) return true;
      return false;*/
      return self.isPointInStroke({ x: pt[0], y: pt[1] });
    }
    return supr('containsPt:', pt); // SMELL too coarse
  }),
  ['encloses:']: needsSuper((supr, self, other) => {
    if (!send(self, 'isClosed')) return false;
    else return supr('encloses:', other);
  }),
  ['specialize']: (self) => {
    let newTag = null;
    if (!send(self, 'isCurved')) { // => Polygon | Polyline
      const polygons = polysFromPath(send(self, 'commands'));
      if (polygons.length > 1) {
        const g = svgel('g');
        self.replaceWith(g);
        polygons.forEach(pts => {
          const elt = cloneNode(self, 'polygon');
          elt.removeAttribute('d');
          attr(elt, 'points', pts.map(v => v.join(',')).join(' '));
          g.appendChild(elt);
        });
        return g;
      }
      const polyPts = polygons[0].map(v => v.join(',')).join(' ');
      attr(self, 'points', polyPts);
      newTag = send(self, 'isClosed')? 'polygon' : 'polyline';
    } else {
      const params = extractEllipse(self);
      if (params) {
        attr(self, params);
        newTag = 'ellipse';
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
  ['endpointAt:']: (self, i/* 0 or 1 */) => {
    if (send(self, 'isClosed')) throw [self, ' is closed, no endpoints'];
    if (i !== 0 && i !== 1) throw [i, ' must be 0 or 1'];
    return send(self, 'pointAtFrac:', i);
  },
  ['endpointAt:put:']: (self, i/* 0 or 1 */, newPt) => {
    throw ['endpointAt:put: not yet implemented for <path>', self];
  },
  ['endpoints']: (self) => {
    if (send(self, 'isClosed')) return [];
    return [ send(self, 'pointAtFrac:', 0), send(self, 'pointAtFrac:', 1) ];
  },
  ['connections']: (self) => {
    if (self.dataset.connects) return self.dataset.connects.split(' ').map(byId);
    if (self.dataset.origin && self.dataset.target
      && self.dataset.origin !== 'nil' && self.dataset.target !== 'nil')
      return [self.dataset.origin, self.dataset.target].map(byId);
    const endpoints = send(self, 'endpoints');
    const connections = endpoints.map(pt => send(self, 'atPoint:', pt, 'pickFrom:', Object.values(everything)));
    self.dataset.connects = connections.map(c => send(c, 'id')).join(' ');
    const myId = send(self, 'id');
    connections.forEach(e => addSetAttr(e.dataset, 'connectors', myId))
    return connections;
  },
  ['isArrowhead']: (self) => self.parentElement.tagName === 'g'
    && self.parentElement.parentElement.classList.contains('arrow-line'), // Mathcha-specific
  // path bakeTransform: shift absolute-command points by the element's own
  // (already-simplified) pure translation. Relative-command points are deltas
  // from the pen position, so they must NOT be shifted — translating the
  // leading (absolute) moveto carries them along automatically. Other transforms applied
  ['bakeTransform']: (self) => {
    const t = self.transform.baseVal.consolidate();
    if (!t) return false;
    const m = t.matrix;
    const d = send(self, 'commands').map(([cmd, ...pts]) => {
      if (cmd === 'Z' || cmd === 'z') return 'Z';
      const abs = cmd === cmd.toUpperCase();
      return cmd + pts.map(([x, y]) => legible(
        m.a * x + m.c * y + (abs ? m.e : 0), // deltas get linear part only
        m.b * x + m.d * y + (abs ? m.f : 0)
      ).join(',')).join(' ');
    }).join(' ');
    attr(self, 'd', d);
    self.removeAttribute('transform');
    return true;
  },
};

vtables.byTag['polyline'] = {
  _parent: vtables.byTag['path'],

  ['vertices']: (self) => {
    return attr(self, 'points').trim().split(' ').map(v => v.split(',').map(Number));
  },
  ['vertexAt:put:']: (self, i, pt) => {
    const vs = send(self, 'vertices');
    if (i<0) i = vs.length + i;
    vs[i] = pt;
    attr(self, 'points', vs.map(v => v.join(',')).join(' '));
  },
  ['isClosed']: () => false,
  ['isCurved']: () => false,
  ['endpointAt:put:']: (self, i /* 0 or 1 */, pt) => {
    if (i === 1) i = -1;
    else if (i !== 0) throw [i, 'must be 0 or 1'];
    return send(self, 'vertexAt:', i, 'put:', pt);
  },
  ['commands']: (self) => {
    let vs = send(self, 'vertices');
    vs = vs.map(v => ['L', v]);
    vs[0][0] = 'M';
    return vs;
  },
  ['encloses:']: () => false,
  ['closestPtToPt:']: (self, pt)=> {
    const segs = send(self, 'lineSegments');
    const closest_seg = closest_line_seg_to_pt(pt, segs);
    return closest_pt_on_line_seg(pt, ...closest_seg);
  },
  ['specialize']: (self) => {
    let newTag = null;
    const points = send(self, 'vertices');
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
  ['vertexAt:put:']: (self, i, [x,y]) => {
    if (i === 0) attr(self, {x1: x, y1: y});
    else if (i === 1 || i === -1) attr(self, {x2: x, y2: y});
    else throw ['Out of bounds: ', i];
  },
  ['specialize']: () => null,
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
  ['encloses:']: vtables.domNode['encloses:'], // HACK super?
  ['intersectWith:']: (self, other) => {
    const    myVerts = convex_poly_verts_ccw(send(self, 'vertices'));
    const otherVerts = convex_poly_verts_ccw(send(other, 'vertices'));
    const isect = convex_polys_intersection(myVerts, otherVerts);
    if (isect) return send({vtable: 'Polygon'}, 'fromVertices:', isect);
    else return null;
  },
  ['center']: self => {
    const vs = send(self, 'vertices');
    return vmul(1/vs.length, sum(vs));
  },
  ['translateBy:']: (self, vec) => {
    const vs = send(self, 'vertices').map(v => vadd(v,vec));
    attr(self, 'points', vs.map(v => v.join(',')).join(' '));
  },
}

vtables['Polygon'] = {
  ['fromVertices:']: (self, vs) => {
    self.vertices = vs;
    return self;
  },
  ['vertices']: self => self.vertices,
  ['closestNormalTo:']: (self, vec) => {
    const mySegs = explode_poly_segs(self.vertices);
    const normals = mySegs.map(normal_for_seg);
    const nvec = vnormed(vec);
    // Want to maximise dot = cosine (1 = 0 angle)
    return normals.thatWhichMinimizes(n => -vdot(nvec,n));
  },
  ['longestDiameterParallelTo:']: (self, vec) => {
    const nvec = vnormed(vec);
    const projected = self.vertices.map(v => vdot(v, nvec));
    const [min, max] = [Math.min(...projected), Math.max(...projected)];
    return max - min;
  },
};

vtables.byTag['rect'] = {
  _parent: vtables.byTag['polygon'],

  ['vertices']: (self) => {
    const [x,y,w,h] = attrs(self, 'x', 'y', 'width', 'height').map(Number);
    return [ [x,y], [x+w,y], [x+w,y+h], [x,y+h] ];
  },
  ['specialize']: () => null,
  ['topLeft']: self => nums(attrs(self, 'x', 'y')),
  ['topLeft:']: (self, [x,y]) => {
    attr(self, {x, y});
  },
  ['translateBy:']: (self, vec) => send(self, 'topLeft:', vadd(send(self, 'topLeft') ,vec)),
  ['bakeTransform']: (self) => {
    const t = self.transform.baseVal.consolidate();
    if (!t) return false;
    const m = t.matrix;
    if (m.b !== 0 || m.c !== 0) return false; // rotation/skew ⇒ no longer a rect. SMELL exact
    const x0 = m.a * self.x.baseVal.value + m.e;
    const y0 = m.d * self.y.baseVal.value + m.f;
    const w  = m.a * self.width.baseVal.value;
    const h  = m.d * self.height.baseVal.value;
    [self.x.baseVal.value, self.width.baseVal.value ] = legible(Math.min(x0, x0 + w), Math.abs(w));
    [self.y.baseVal.value, self.height.baseVal.value] = legible(Math.min(y0, y0 + h), Math.abs(h));
    self.removeAttribute('transform');
    return true;
  },
}

vtables.byTag['ellipse'] = {
  _parent: vtables.byTag['path'],

  ['isClosed']: () => true,
  ['isCurved']: () => true,
  ['radii']: (self) => attrs(self, 'rx', 'ry').map(Number),
  ['vertices']: (self) => {
    // Sigh ... approximate ellipse as octagon
    const [cx,cy] = attrs(self, 'cx', 'cy').map(Number);
    const [rx,ry] = send(self, 'radii');
    const n = 8;
    const theta = Math.PI*2/n;
    const avg_r = (1+1/Math.cos(theta/2))/2; // 1/2 between inner and outer polygon (radius-independent factor)
    const vs = [];
    for (let i=0; i<n; i++) {
      const itheta = i*theta;
      const [x,y] = [Math.cos(itheta), Math.sin(itheta)];
      vs.push(vadd([cx,cy], [rx*avg_r*x, ry*avg_r*y]));
    }
    return vs;
  },
  ['specialize']: (self) => {
    const [rx,ry] = send(self, 'radii');
    if (Math.abs(rx - ry) < 0.01) { // SMELL epsilon
      self = replaceTag(self, 'circle');
      self.removeAttribute('rx');
      self.removeAttribute('ry');
      attr(self, 'r', rx);
      return self;
    }
    return null;
  },
  ['containsPt:']: (self, pt) => {
    const [cx,cy] = attrs(self, 'cx', 'cy').map(Number);
    const [rx,ry] = send(self, 'radii');
    const pt_from_c = vsub(pt, [cx,cy]);
    const [nx,ny] = [pt_from_c[0]/rx, pt_from_c[1]/ry];
    return nx*nx + ny*ny < 1;
  },
}

vtables.byTag['circle'] = {
  _parent: vtables.byTag['ellipse'],

  ['radii']: (self) => {
    const r = +attr(self, 'r');
    return [r,r];
  },
  ['specialize']: () => null,
}

vtables.byTag['text'] = {
  _parent: vtables.domNode,
  ['bakeTransform']: (self) => {
    const t = self.transform.baseVal.consolidate();
    if (!t) return false;
    const m = t.matrix;
    if (m.b !== 0 || m.c !== 0) return false; // rotated text: keep the transform
    const xs = self.x.baseVal, ys = self.y.baseVal;
    for (let i = 0; i < xs.numberOfItems; i++) {
      const it = xs.getItem(i); [it.value] = legible(m.a * it.value + m.e);
    }
    for (let i = 0; i < ys.numberOfItems; i++) {
      const it = ys.getItem(i); [it.value] = legible(m.d * it.value + m.f);
    }
    if (xs.numberOfItems === 0 && ys.numberOfItems === 0)
      attr(self, {x: legible(m.e), y: legible(m.f)});
    self.removeAttribute('transform');
    return true;
  },
}

vtables.byTag['tspan'] = {
  _parent: vtables.byTag['text'],
}

vtables.byTag['g'] = {
  _parent: vtables.domNode,

  ['idPrefix']: (self) => {
    if (self.classList.contains('is-paragraph')) return 'par';
    if (self.classList.contains('text-wrapper')) return 't';
    else return 'g';
  },
  ['containsPt:']: (self, pt) => {
    for (let c of [...self.children])
      if (send(c, 'containsPt:', pt)) return true;
    return false;
  },
  ['encloses:']: needsSuper((supr, self, other) =>
    self.classList.contains('text-wrapper') ? supr('encloses:', other)
    : self.firstChild && send(self.firstChild, 'encloses:', other) // Assumes wrapped shape
  ),
  ['specialize']: (self) => {
    let anySpecialized = false;
    for (let c of [...self.children])
      if (send(c, 'specialize')) anySpecialized = true;
    return anySpecialized? self : null;
  },
  ['boundaryShape']: (self) => self.querySelector('.boundary-shape'),
  ['interior']: (self) => self.querySelector('.shape-interior'),
}

// Of a connector (open path) c, we must be able to ask:
// c endpoints -> [p1, p2]
// c connections -> [el1, el2]
// c origin/target -> el or null

// === MATHCHA ARROW SUPPORT ===

/* In DOMMeta terms, a Mathcha arrow is recognised something like:
  * g .arrow-line {
      path .connection .real :shaft ,
      ( g { path } :head1 ) ? ,
      ( g { path } :head2 ) ?
    }
  But remember: we also have "fat arrows". Generally, any shape can
  be parsed as a connector: just determine the two endpoints.
  However, such "generalised connector" behaviour should probably not
  live in Path.

  Anyway. If there's an arrowhead, its tip is the endpoint, and the
  shaft will be cut short for aesthetic reasons. So if we just rely
  on the shaft path, it'll be a bit too short.

  Arrowhead pivots around its tip; convenient convention. Its g
  transform has these columns: [look back], [look left], [tip pos].
  That is, the first col points opposite the head direction, and the
  second points left. Not the convention I would pick but OK.

  mathcha head = g transform=(col:back col:left col:tip) => ({fwd: neg(back), tip: tip})
  mathcha shaft = path .connection .real
  -- but here we probs want path or any "specialization subclass" eg polyline, line

  arrow endpoints = targetPt:t originPt:o => [o,t]
                  | head:h1 head:h2 ~head => [h1.tip, h2.tip]
                  | shaft:s => send(s, 'endpoints')

  arrow targetPt = head:h ~head => h.tip
  arrow originPt = head:h ~head shaft:s => {
      const eps = send(s, 'endpoints');
      const ds = eps.map(p => |p-h.tip|);
      return eps[ds[0] < ds[1] ? 1 : 0]; // get the "opposite" path endpoint to the head
    }
*/

vtables.byTag['path']['target'] = (self) => {
  if (self.dataset.target) return byId(self.dataset.target);
  let target = nilElem;
  const targetPt = send(self, 'targetPt');
  const originPt = send(self, 'originPt');
  self.dataset.origin = 'nil';
  self.dataset.target = 'nil';
  if (originPt) {
    const origin = send(self, 'atPoint:', originPt, 'pickFrom:', Object.values(everything));
    if (origin) {
      self.dataset.origin = send(origin, 'id');
      addSetAttr(origin.dataset, 'connectors', send(self, 'id'));
    }
  }
  if (targetPt) {
    target = send(self, 'atPoint:', targetPt, 'pickFrom:', Object.values(everything));
    if (target) {
      self.dataset.target = send(target, 'id');
      addSetAttr(target.dataset, 'connectors', send(self, 'id'));
    }
  }
  return target;
}

vtables.byTag['path']['origin'] = (self) => {
  if (self.dataset.origin) return byId(self.dataset.origin);
  send(self, 'target');
  return byId(self.dataset.origin);
}

vtables.byTag['path']['isDirected'] = (self) => send(self, 'targetPt') !== null;

vtables.byTag['path']['originPt'] = (self) =>
  match(vtables.MathchaArrow, send(self, 'localRoot'), 'originPt');

vtables.byTag['path']['targetPt'] = (self) => 
  match(vtables.MathchaArrow, send(self, 'localRoot'), 'targetPt');

// Update a named visual vector arrow, or init if applicable.
// Mathcha-dependent
vupd = (name, value, origin, prototypeId) => {
  let arrow = byId('vec-'+name);
  if (!arrow) {
    const prototype = byId(prototypeId).parentElement;
    arrow = prototype.cloneNode(/*deep=*/true);
    arrow.firstChild.id = 'vec-'+name;
    svg_parent.appendChild(arrow);
  } else arrow = arrow.parentElement;
  if (!origin) {
    origin = match(vtables.MathchaArrow, arrow, 'originPt');
  } else perform(vtables.MathchaArrow, arrow, 'originPt:', [origin]);
  perform(vtables.MathchaArrow, arrow, 'targetPt:', [vadd(origin,value)]);
};

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
  // defs:   {
  //   isNode: elem -> bool,
  //   isEdge: elem -> bool,
  //   endpointTolerance: pixel radius for `nodeAtPt:`
  // }
  ['fromRegion:filterBy:withDefs:']: (self, scope, filter, defs) => {
    self.scope = scope;
    self.filter = filter;
    self.defs = defs;
    return self;
  },

  ['nodes']: (self) => {
    if (self._nodes) return self._nodes;
    const pred = e => self.filter(e) && self.defs.isNode(e);
    const matches = send(self, 'findIn:', self.scope, 'matching:', pred, 'excluding:', new Set());
    self._nodes = matches.map(e => send(self, 'wrapNode:', e));
    return self._nodes;
  },
  ['nodeForDom:']: (self, dom) => send(self, 'nodes').find(n => n.dom === dom) || null,

  ['edges']: (self) => {
    if (self._edges) return self._edges;
    const nodeDoms = new Set(send(self, 'nodes').map(n => n.dom));
    const pred = e => self.filter(e) && self.defs.isEdge(e);
    const matches = send(self, 'findIn:', self.scope, 'matching:', pred, 'excluding:', nodeDoms);
    self._edges = matches.map(e => send(self, 'wrapEdge:', e));
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
        if (childHandled && send(child, 'localRoot') === elem) return true;
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
  ['nodeAtPt:']: (self, pt) => send(self, 'nodes').find(n =>
    send(n, 'signedDistanceToPt:', pt) <= self.defs.endpointTolerance) || null,
};

// Shared protocol for the Node / Edge wrappers.
vtables['GraphNotation-Common'] = {
  // Forward unknown messages to the wrapped DOM element.
  ['doesNotUnderstand:']: (self, [selector, ...args]) => sendNoKw(self.dom, selector, ...args),
};

vtables['GraphNotation-Node'] = {
  _parent: vtables['GraphNotation-Common'],

  // Edges in the same notation that touch this node.
  ['incidentEdges']: (self) => send(self.notation, 'edges').filter(e =>
    send(e, 'connections').some(n => n && n.dom === self.dom)),
  // Nodes at the end of all incident edges
  ['neighbors']: (self) => {
    const result = [];
    for (const edge of send(self, 'incidentEdges')) {
      for (const conn of send(edge, 'connections')) {
        if (conn && conn.dom !== self.dom) result.push(conn);
      }
    }
    return result;
  },
};

vtables['GraphNotation-Edge'] = {
  _parent: vtables['GraphNotation-Common'],

  // The (up to two) nodes this edge connects, in path order. May contain
  // null entries if an endpoint doesn't land on any node in this notation
  // (e.g. magic-red connectors to "nothing", or arrows whose endpoint sits
  // in blank space).
  ['connections']: (self) => {
    if (self._connections) return self._connections;
    self._connections = send(self, 'endpoints').map(pt => send(self.notation, 'nodeAtPt:', pt));
    return self._connections;
  },

  ['origin']: (self) => send(self, 'connections')[0],
  ['target']: (self) => send(self, 'connections')[1],
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

vtables['EdgeDrivenGraphNotation'] = {
  _parent: vtables['GraphNotation'],

  // scope:         DOM element delimiting the region (typically document.documentElement)
  // defs: {
  //   edgesFn:       (scope) -> [edge DOM elems],
  //   fixedNodesFn:  (scope) -> [pre-known node DOM elems] (e.g. red boxes),
  //   candidateNodesFn: (scope) -> [maybe node DOM elems, which if hit by edge, will become nodes]
  //   endpointTolerance: pixel radius for `nodeFromPt:`
  // }
  ['fromRegion:withDefs:']: (self, scope, defs) => {
      self.scope = scope;
      self.edgesFn = defs.edgesFn;
      self.fixedNodesFn = defs.fixedNodesFn;
      self.candidateNodesFn = defs.candidateNodesFn;
      self.defs = defs;
      return self;
    },

  ['nodes']: (self) => {
    if (self._nodes) return self._nodes;
    const candidates = self.candidateNodesFn(self.scope);  // could use findIn: 
                                                      // for don't-recurse 
    const nodeElems = new Set(self.fixedNodesFn(self.scope));
    for (const edgeElem of self.edgesFn(self.scope)) {
      if (self.defs.endpointTolerance === 0) { // HACK! red ID box probe lines use isPointOnStroke
        // Necessary for now if candidates includes open paths
        for (const conn of send(edgeElem, 'connections')) { // WARN: document scope, ignores self.scope
          if (!nodeElems.has(conn) && candidates.includes(conn))
            nodeElems.add(conn);
        }
      } else {
        for (const pt of send(edgeElem, 'endpoints')) {
          // Find a candidate within endpointTolerance — same logic as 
          // base GN's nodeAtPt:, but restricted to the candidate pool
          const target = candidates.find(c => 
            send(c, 'signedDistanceToPt:', pt) <= self.defs.endpointTolerance);
          if (target) nodeElems.add(target);
        }
      }
    }
    self._nodes = [...nodeElems].map(e => send(self, 'wrapNode:', e));
    return self._nodes;
  },

  ['edges']: (self) => {
    if (self._edges) return self._edges;
    self._edges = self.edgesFn(self.scope).map(e => send(self, 'wrapEdge:', e));
    return self._edges;
  },
};

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

vtables['Labeller'] = {
  _parent: null,
  LLL_CLASS: 'attachment-line',

  // scope:       DOM element delimiting the region (LLLs drawn into this)
  // labels:      () -> [label DOM elems]; called fresh each run, so it
  //              can naturally exclude already-claimed labels
  // labellables: () -> [labellables]; wrappers or raw elems
  // attractor:   labellable -> point | shape
  //              will judge via send(label, 'distanceTo:', attractor(labellable))
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
        const d = send(label, 'distanceTo:', self.attractor(labellable));
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
      drawnLines.add(send(self, 'drawLLL:', c.label, 'to:', c.labellable));
    }
    self._drawnLines = drawnLines;
    self._claimedLabels = claimedLabels;
    self._claimedLabellables = claimedLabellables;
    return send(self, 'attachmentGraph');
  },

  ['drawLLL:to:']: (self, label, labellable) => {
    const [x1,y1] = send(label, 'centerPt');
    const [x2,y2] = self.attachAt(labellable, [x1,y1]);
    // note: static member ref
    const wrapper = svgel('g', { class: vtables.Labeller.LLL_CLASS }, self.scope);
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

// LabelledGraph: the messages common to BoxGraph, LabelGraph, and DefaultMetaNotation
// So those concrete classes are subclasses of this
vtables['LabelledGraph'] = {
  _parent: null,

  // gn: a GraphNotation instance
  // nodeNamer: gnNode -> name string (or null for anonymous)
  // edgeNamer: gnEdge -> name string (or null)
  ['fromGraph:nodeNamer:edgeNamer:']: (self, gn, nodeNamer, edgeNamer) => {
    self.gn = gn;
    self.nodeNamer = nodeNamer || (() => null);
    self.edgeNamer = edgeNamer || (() => null);
    return self;
  },

  ['nodes']: (self) => {
    if (self._nodes) return self._nodes;
    self._nodes = send(self.gn, 'nodes').map(n => send(self, 'wrapNode:', n));
    return self._nodes;
  },
  ['edges']: (self) => {
    if (self._edges) return self._edges;
    self._edges = send(self.gn, 'edges').map(e => send(self, 'wrapEdge:', e));
    return self._edges;
  },

  ['namedNodes']: (self) => {
    if (self._namedNodes) return self._namedNodes;
    self._namedNodes = {};
    for (const n of send(self, 'nodes')) {
      const name = send(n, 'name');
      if (name) self._namedNodes[name] = n;
    }
    return self._namedNodes;
  },
  ['anonNodes']: (self) => send(self, 'nodes').filter(n => !send(n, 'name')),
  ['namedEdges']: (self) => {
    if (self._namedEdges) return self._namedEdges;
    self._namedEdges = {};
    for (const e of send(self, 'edges')) {
      const name = send(e, 'name');
      if (name) self._namedEdges[name] = e;
    }
    return self._namedEdges;
  },
  ['anonEdges']: (self) => send(self, 'edges').filter(e => !send(e, 'name')),

  ['wrapNode:']: (self, gnNode) => ({ vtable: 'LabelledGraph-Node', gnNode, lg: self }),
  ['wrapEdge:']: (self, gnEdge) => ({ vtable: 'LabelledGraph-Edge', gnEdge, lg: self }),
};

vtables['LabelledGraph-Node'] = {
  ['doesNotUnderstand:']: (self, [sel, ...args]) =>
    sendNoKw(self.gnNode, sel, ...args),

  ['name']: (self) => self.lg.nodeNamer(self.gnNode),
  ['outgoingEdges']: (self) => send(self.lg, 'edges').filter(e =>
    send(e, 'origin') && send(e, 'origin').gnNode.dom === self.gnNode.dom),
  ['incomingEdges']: (self) => send(self.lg, 'edges').filter(e =>
    send(e, 'connections').some(n => n && n.gnNode.dom === self.gnNode.dom)),
};

vtables['LabelledGraph-Edge'] = {
  ['doesNotUnderstand:']: (self, [sel, ...args]) =>
    sendNoKw(self.gnEdge, sel, ...args),

  ['name']: (self) => self.lg.edgeNamer(self.gnEdge),
  ['origin']: (self) => {
    const gnOrigin = send(self.gnEdge, 'origin');
    return gnOrigin ? send(self.lg, 'wrapNode:', gnOrigin) : null;
  },
  ['target']: (self) => {
    const gnTarget = send(self.gnEdge, 'target');
    return gnTarget ? send(self.lg, 'wrapNode:', gnTarget) : null;
  },
};

// Helper: a labels-function that excludes labels already terminated-on by
// any existing attachment-line in scope. Use as the `labels` arg for any
// Labeller pass that should respect prior passes.
unclaimedLabels = function(scope, allLabelsSelector) {
  return () => {
    const allLabels = Array.from(scope.querySelectorAll(allLabelsSelector));
    const selector = '.' + vtables.Labeller.LLL_CLASS + ' > line';
    const lines = Array.from(scope.querySelectorAll(selector));
    // A label is claimed if any LLL's endpoint is inside its bounding box.
    const claimed = new Set();
    for (const line of lines) {
      const endpoints = send(line, 'endpoints');
      for (const label of allLabels) {
        if (send(label, 'containsPt:', endpoints[0]) || send(label, 'containsPt:', endpoints[1]))
          claimed.add(label);
      }
    }
    return allLabels.filter(l => !claimed.has(l));
  };
};

// Find the label attached to a given gn node/edge in an attachment graph.
const nameFromAttachments = (attGraph, gnElem) => {
  const node = send(attGraph, 'nodeForDom:', gnElem.dom);
  if (!node) return null;
  const neighbors = send(node, 'neighbors');
  return neighbors.length > 0 ? neighbors[0].dom.dataset.string : null;
};

ALL_LABELS = '.is-paragraph:not(.is-multiline)';

vtables['BoxGraph'] = {
  _parent: vtables['LabelledGraph'],

  // boxGraph-example.svg
  ['fromRegion:']: (self, scope) => {
    // "Default BoxGraph": rects as nodes, open paths as edges, anywhere in doc.
    const boxGN = send({ vtable: 'GraphNotation' },
      'fromRegion:', scope,
      'filterBy:', e => true,
      'withDefs:', {
        isNode: e => e.tagName === 'rect',
        isEdge: isMathchaConnector,
        endpointTolerance: 3,
    });

    // Pass 1: arrows claim labels nearest their origin points (no max distance —
    // arrows need labels).
    const arrowLabeller = send({ vtable: 'Labeller' },
      'inScope:', boxGN.scope,
      'withLabels:', () => Array.from(boxGN.scope.querySelectorAll(ALL_LABELS)),
      'labellables:', () => send(boxGN, 'edges'),
      'attractor:', edge => send(edge, 'originPt'),
      'attachAt:', (edge, labelPt) => send(edge, 'originPt'),
      'maxDistance:', Infinity
    );
    self.arrowAttachments = send(arrowLabeller, 'run');

    // Pass 2: boxes claim from remaining labels, within 20px.
    const boxLabeller = send({ vtable: 'Labeller' },
      'inScope:', boxGN.scope,
      'withLabels:', unclaimedLabels(boxGN.scope, ALL_LABELS),
      'labellables:', () => send(boxGN, 'nodes'),
      'attractor:', node => node.dom,
      'attachAt:', (node, labelPt) => send(node.dom, 'closestPtToPt:', labelPt),
      'maxDistance:', 20
    );
    self.boxAttachments = send(boxLabeller, 'run');

    return send(self,
      'fromGraph:', boxGN,
      'nodeNamer:', n => nameFromAttachments(self.boxAttachments, n),
      'edgeNamer:', e => nameFromAttachments(self.arrowAttachments, e));
  },

  // TODO: install this via a magic red box in a diagram
  ['asJSOG']: (self) => {
    const edges = send(self, 'namedEdges');
    let nextId = 1;
    const newName = () => 'anon'+nextId++;
    const names = new Map();
    // Keying by DOM because it's a stable identity, while wrappers are created each call
    send(self, 'nodes').forEach(node => names.set(node.gnNode.dom, send(node, 'name') || newName()));
    const triplets = Object.entries(edges).map(([key,edge]) => {
      const origin = names.get(send(edge, 'origin').gnNode.dom);
      const target = names.get(send(edge, 'target').gnNode.dom);
      if (!origin || !target) throw ['Naming error:', { self, names, key, edge, origin, target }];
      return [origin, key, target];
    });
    const objs = {};
    names.forEach(name => objs[name] = { name });
    triplets.forEach(([origin, key, target]) => {
      objs[origin][key] = objs[target];
    });
    return objs;
  },
};

vtables['TextGraph'] = {
  _parent: vtables['LabelledGraph'],

  ['fromRegion:']: (self, scope) => {
    const graphNotation = send({ vtable: 'GraphNotation' },
      'fromRegion:', scope,
        'filterBy:', e => true,
        'withDefs:', {
          isNode: e => e.classList.contains('is-paragraph'),
          isEdge: isMathchaConnector,
          endpointTolerance: 20,
      });
    return send(self,
      'fromGraph:', graphNotation,
      'nodeNamer:', n => n.dom.dataset.string,
      'edgeNamer:', () => null);
  },

  // TODO: install this via a magic red box in a diagram
  ['asJS']: (self) => {
    const edges = send(self, 'edges');
    const lines = edges
      .map(edge => [ send(edge, 'origin'), send(edge, 'target') ])
      .map(([o,t]) => [ send(o, 'name'), send(t, 'name') ])
      .map(([o,t]) => `arrow('${o}', '${t}')`);
    return lines.join(';\n');;
  }
};

vtables['ActiveButton'] = {
  ['fromRegion:']: (self, scope) => {
    const rects = Array.from(scope.querySelectorAll('rect'));
    const with_text = rects.filter(r => r.parentElement.querySelector('.is-paragraph'));
    const on_click = e => {
      const func = e.target.js_func;
      if (func) log(func());
    };
    with_text.forEach(r => {
      const func = send({ vtable: 'JS' }, 'compileRegion:', r.parentElement);
      r.js_func = func;
      r.onclick = on_click;
    });
    return self;
  },
};

// Restructure a node's wrapper so its non-rect siblings are gathered into a
// new inner-scope <g>. Returns the new inner-scope element, suitable for use
// as an inner notation's scope.
function makeInnerScope(node) {
  const wrapper = send(node, 'localRoot');
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
blueBoxes = scope => Array.from(scope.querySelectorAll('rect')).filter(isBlueStroke);
isInsideBlueBox = (scope,e) => blueBoxes(scope).some(box => box.parentElement.contains(e));

vtables['DefaultMetaNotation'] = {
  _parent: vtables['LabelledGraph'],

  ['fromRegion:']: (self, scope) => {
    // Pass 1: identify which paragraphs are notation-name targets
    // (those that blue arrows terminate on). These become nodes in the
    // graph alongside the blue boxes.
    const notationGraph = send({ vtable: 'EdgeDrivenGraphNotation' },
      'fromRegion:', scope,
      'withDefs:', {
        edgesFn: s => Array.from(s.querySelectorAll('path,polyline,line'))
                          .filter(e => isBlueStroke(e) && isMathchaConnector(e)),
        fixedNodesFn: s => Array.from(s.querySelectorAll('rect')).filter(isBlueStroke),
        candidateNodesFn: s => Array.from(s.querySelectorAll(ALL_LABELS))
                                    .filter(l => !isInsideBlueBox(s, l)),
        endpointTolerance: 15,
    });
    
    // Pass 2: from the paragraphs not pulled into Pass 1 as notation-name
    // targets, attach each to its closest blue box as that box's name.
    const claimedAsNodes = new Set(send(notationGraph, 'nodes').map(n => n.dom));
    const regionLabeller = send({ vtable: 'Labeller' },
      'inScope:', scope,
      'withLabels:', () => Array.from(scope.querySelectorAll(ALL_LABELS))
                                .filter(l => !isInsideBlueBox(scope, l))
                                .filter(l => !claimedAsNodes.has(l)),
      'labellables:', () => Array.from(scope.querySelectorAll('rect')).filter(isBlueStroke),
      'attractor:', box => box,
      'attachAt:', (box, labelPt) => send(box, 'closestPtToPt:', labelPt),
      'maxDistance:', 30
    );
    self.regionLabelAttachments = send(regionLabeller, 'run');

    return send(self,
      'fromGraph:', notationGraph,
      'nodeNamer:', n => nameFromAttachments(self.regionLabelAttachments, n),
      'edgeNamer:', e => null);
  },
  // Override wrapNode to add notation-specific accessors.
  ['wrapNode:']: (self, gnNode) => ({ vtable: 'DefaultMetaNotation-Region', gnNode, lg: self }),
  ['namedRegions']: (self) => send(self, 'namedNodes'),

  ['instantiateAll']: (self) => {
    const notationInstances = {};
    for (const [myName, region] of Object.entries(send(self, 'namedRegions'))) {
      const notationInstance = send(region, 'instantiate');
      if (!notationInstance) continue;
      notationInstance.name = myName;
      notationInstances[myName] = notationInstance;
    }
    return notationInstances;
  },
};

vtables['DefaultMetaNotation-Region'] = {
  _parent: vtables['LabelledGraph-Node'],

  ['notationName']: (self) => {
    const out = send(self, 'outgoingEdges');
    if (out.length === 0) return null;
    const target = send(out[0], 'target');
    // Expect a heavily wrapped g.is-paragraph
    return target ? target.gnNode.dom.dataset.string : null;
  },
  ['innerScope']: (self) => {
    if (self._innerScope) return self._innerScope;
    self._innerScope = makeInnerScope(self.gnNode.dom);
    return self._innerScope;
  },
  ['instantiate']: (self) => {
    const notationName = send(self, 'notationName');
    const vtable = vtables[notationName];
    if (!vtable) {
      console.warn('No vtable for notation "'+notationName+'"; skipping region.');
      return null;
    }
    // Assume vtable instances understand fromRegion: ...!
    const domRegion = send(self, 'innerScope');
    // Construct!
    return send({ vtable: notationName }, 'fromRegion:', domRegion);
  },
};

MAGIC_RED = 'rgb(208, 2, 27)';
// SMELL: much in common with DefaultMetaNotation, much duped
isRedStroke = e => e.style && e.style.stroke === MAGIC_RED;
redBoxes = scope => Array.from(scope.querySelectorAll('rect')).filter(isRedStroke);
isInsideRedBox = (scope,e) => redBoxes(scope).some(box => box.parentElement.contains(e));

vtables['CodeExecutionNotation'] = {
  _parent: vtables['LabelledGraph'],

  ['fromRegion:']: (self, scope) => {
    // Pass 1: identify which paragraphs are syntax-name targets
    // (those that red arrows terminate on). These become nodes in the
    // graph alongside the red boxes.
    const codeGraph = send({ vtable: 'EdgeDrivenGraphNotation' },
      'fromRegion:', scope,
      'withDefs:', {
        edgesFn: s => Array.from(s.querySelectorAll('path,polyline,line'))
                          .filter(e => isRedStroke(e) && isMathchaConnector(e) && send(e, 'isDirected')),
        fixedNodesFn: s => Array.from(s.querySelectorAll('rect')).filter(isRedStroke),
        candidateNodesFn: s => Array.from(s.querySelectorAll(ALL_LABELS))
                                    .filter(l => !isInsideRedBox(s, l)),
        endpointTolerance: 20,
    });

    return send(self,
      'fromGraph:', codeGraph,
      'nodeNamer:', n => null,
      'edgeNamer:', e => null);
  },
  // Override wrapNode to add notation-specific accessors.
  ['wrapNode:']: (self, gnNode) => ({ vtable: 'CodeExecutionNotation-Box', gnNode, lg: self }),
  ['codeBoxes']: (self) => send(self, 'nodes').filter(n => n.gnNode.dom.tagName === 'rect'),

  ['executeAll']: (self) => send(self, 'codeBoxes').forEach(box => send(box, 'execute')),
};

vtables['CodeExecutionNotation-Box'] = {
  _parent: vtables['LabelledGraph-Node'],

  ['syntaxName']: (self) => {
    const out = send(self, 'outgoingEdges');
    if (out.length === 0) return null;
    const target = send(out[0], 'target');
    // Expect a heavily wrapped g.is-paragraph
    return target ? target.gnNode.dom.dataset.string : null;
  },
  ['innerScope']: (self) => {
    if (self._innerScope) return self._innerScope;
    self._innerScope = makeInnerScope(self.gnNode.dom);
    return self._innerScope;
  },
  ['execute']: (self) => {
    const syntaxName = send(self, 'syntaxName') || 'JS';
    const vtable = vtables[syntaxName];
    if (!vtable) {
      console.warn('No vtable for syntax "'+syntaxName+'"; skipping code box.');
      return;
    }
    // Assume vtable instances understand fromRegion: ...!
    const domRegion = send(self, 'innerScope');
    // Construct!
    const js_func = send({ vtable: syntaxName }, 'compileRegion:', domRegion);
    try {
      js_func();
      self.gnNode.dom.classList.add('done');
    } catch (e) {
      console.error(e);
    }
  },
};

vtables['JS'] = {
  ['compileRegion:']: (self, scope) => {
    const code_paras = Array.from(scope.querySelectorAll('.is-paragraph'));
    const code_strings = code_paras.map(p => p.dataset.string);
    const js_source = code_strings.join('\n\n');
    return () => eval(js_source); // >:D
  }
};

vtables['Sucrose'] = {
  ['compileRegion:']: (self, scope) => {
    const code_paras = Array.from(scope.querySelectorAll('.is-paragraph'));
    const code_strings = code_paras.map(p => p.dataset.string);
    const sucrose_source = code_strings.join('\n\n') // Mathcha Unicode autocompletes
      .replaceAll('⩾','>=').replaceAll('⩽','<=').replaceAll('⟹','=>').replaceAll('≡','==');
    const js_source = compile_with_directive(sucrose_source, {
      SweetTalk: ST_with_holes_to_JS,
      Descartes: compile_descartes_with_holes
    });
    console.debug('Compiled Sucrose to:\n', js_source);
    return () => eval(js_source);
  }
};

vtables['JS{[SweetTalk]}'] = {
  ['compileRegion:']: (self, scope) => {
    const code_paras = Array.from(scope.querySelectorAll('.is-paragraph'));
    const code_strings = code_paras.map(p => p.dataset.string);
    const jsst_source = code_strings.join('\n\n');
    // Same as ST{[JS]}, just wrap in one big JS hole with empty ST outer layer
    const stjs_source = HOLE_DELIMS[0]+' '+jsst_source+' '+HOLE_DELIMS[1];
    const js_source = compile_nested_holes(stjs_source);
    console.debug('Compiled SweetTalk{[JS]} to:\n', js_source);
    return () => eval(js_source);
  }
}

// ── Editor vocabulary ────────────────────────────────────────────────────────
// EditorVocab is a placeholder in every notation's _parent chain; init() wires
// its _parent to the concrete vocab once the editor is known. One mutation,
// no notation duplication, no ambient global reads.
vtables.EditorVocab = { _parent: null };   // set by init(): MathchaVocab | AffinityVocab | ...

function learnEditor() {
  let editor = svg_parent.dataset.exportedFrom;
  if (typeof editor === 'string') editor = editor.toLowerCase();
  else { // Heuristically guess
    if (document.querySelector('svg.role-diagram-draw-area')) editor = 'mathcha';
    else if (svg_parent.lookupNamespaceURI('serif') === 'http://www.serif.com/') editor = 'affinity designer';
    else if (svg_parent.querySelector('defs')) editor = 'powerpoint';
    else editor = 'unknown';
    log('Guessed editor = ' + editor);
  }
  vtables.EditorVocab._parent = {
    ['mathcha']: vtables.MathchaVocab,
    ['affinity designer']: vtables.AffinityVocab,
    ['powerpoint']: vtables.PowerpointVocab,
  }[editor] || vtables.MathchaVocab;
}

everything = {};
// Universal entry point; mandatory for all diagrams
function init() {
  // First, ensure "nil" exists
  nilElem = svgel('g', {id: 'nil'});

  // Second, establish which editor's XML conventions we're working from.
  learnEditor();
  const vocab = { vtable: vtables.EditorVocab };

  // Next, we must normalise the document. That means:
  // 1. Specialise individual shapes as far as possible (eg path -> polygon -> rect)
  //    (see principles/1-most-specialized-tag.svg)
  // 2. Reshape the DOM tree to reflect spatial containment relations
  //    (see principles/2-dom-tree-spatial-containment.svg)
  // [FUTURE]
  //   3. Ensure all closed shape nodes are in Closed Canonical Form:
  //
  //      <g .boundary-wrapper >
  //        <closed-shape .boundary-shape ... /> 
  //        <g .shape-interior > ... </g>
  //      </g>
  //
  //      And all open path nodes (path, polyline, line, etc) are in Open Canonical Form:
  //
  //      <g .connector-wrapper > 
  //        <long-shape .connector-shaft ... /> 
  //        (<shape .connector-head ... />)+
  //      </g>
  //
  //      And all text paragraphs are in Text Canonical Form:
  //      
  //      <g .text-wrapper .is-multiline? data-string=... >
  //        ...
  //      </g>
  // [/FUTURE]
  //
  
  send(vocab, 'init'); // Normalize shapes/connectors/text exported under different editors' encodings

  // First, gather all exported shapes and text.
  let elems = send(vocab, 'seedElements');

  // Specialise and ID everything
  elems.forEach((el) => {
    let newEl = el;
    let max_iter = 10; // SMELL arbitrary maximum
    do { // max specialize
      el = newEl;
      newEl = send(el, 'specialize');
      max_iter--;
    } while (max_iter > 0 && newEl);
    everything[ send(el, 'id') ] = el;
  });

  elems = Object.values(everything)
    .filter(e => !e.parentElement.classList.contains('connector-wrapper'))
    .concat(all('g.connector-wrapper'));
  all('g.connector-wrapper').forEach(g => send(g, 'id')); // Force an ID so containments work

  // Next, compute spatial containment tree; store in
  // contained-in / contains dataset attributes.
  // Closed shapes inside g.connector-wrapper (e.g. arrowheads) mustn't contain anything
  elems.forEach(el => send(el, 'findTightestContainerIn:',
    elems.filter(e => !e.parentElement.classList.contains('connector-wrapper'))));
  
  // Now, reroot each node inside its tightest container
  // and erase the evidence :)
  all('[data-contained-in]').forEach(child => {
    send(child, 'reroot');
    delete child.dataset.containedIn;
  });
  all('[data-contains]').forEach(e => {
    delete e.dataset.contains;
  });

  // Now, detect probe connectors for "magic red" ID / Code boxes
  const magicRedStroke = e => e.style.stroke === MAGIC_RED;
  const idSetterBoxes = scope => Array.from(scope.querySelectorAll('rect'))
    .filter(magicRedStroke).filter(e =>
      send(e, 'localRoot').querySelector('.is-paragraph').dataset.string.startsWith('#')
    );
  idSetterGraph = send({ vtable: 'EdgeDrivenGraphNotation' },
    'fromRegion:', document.documentElement,
    'withDefs:', {
      edgesFn: scope => Array.from(scope.querySelectorAll('.connection'))
        .filter(magicRedStroke).filter(e => !send(e, 'isDirected')),
      fixedNodesFn: idSetterBoxes,
      candidateNodesFn: () => Object.values(everything),
      endpointTolerance: 0
  });
  // Execute ID setter boxes
  send(idSetterGraph, 'nodes').filter(n => magicRedStroke(n.dom)).forEach(n => {
    const lroot = send(n.dom, 'localRoot');
    const para_g = lroot.querySelector('.is-paragraph');
    const str = para_g.dataset.string;
    // By default, the target is the container of the ID setter box
    let target = lroot.parentElement.firstChild; // SMELL boundary-shape
    const neighbors = send(n, 'neighbors');
    if (neighbors.length > 1) throw ['ID setter needs exactly 1 target:', n];
    // If node is connected to another via an edge, that neighbor is the target
    if (neighbors.length > 0) target = neighbors[0].dom;
    if (target.id !== 'nil') {
        const newId = str.substring(1);
        const clash = byId(newId);
        if (clash) clash.id = target.id; // if newId already taken, swap
        target.id = newId;
      }
    para_g.classList.add('done');
    send(n, 'incidentEdges').forEach(e => e.dom.classList.add('done'));
  });

  removeDone();

  // Now, execute embedded JS or syntactic sugar layers
  codeExec = send({ vtable: 'CodeExecutionNotation' }, 'fromRegion:', document.documentElement);
  send(codeExec, 'executeAll');

  return elems.length;
}

function removeDone() {
  all('.done').forEach(e => e.parentElement.remove()); // WARNING: connections[*].connectors will be stale
}

// post-init entry point for diagrams in the default meta-notation
// e.g. notational-dispatch.svg
meta_boxgraph_init = function(scope) {
  if (!scope) scope = document.documentElement;
  metaNotation = send({ vtable: 'DefaultMetaNotation'}, 'fromRegion:', scope);

  // Instantiate notations as globals
  Object.entries(send(metaNotation, 'instantiateAll')).forEach(([name,inst]) => {
    window[name] = inst;
  });
};

// For minimal typing in the console. E.g:
// e(`#btn3 onClick: {[ () => log('Hello World!') ]}`)
e = str => {
  const wrapped = `//! {[ SweetTalk ]} {< Descartes >}\n{[${str}]}`;
  return eval(compile_with_directive(wrapped, {
    SweetTalk: ST_with_holes_to_JS,
    Descartes: compile_descartes_with_holes,
  }));
};

// === ID OBJ MODEL STUFF ===

/*
parseAsObjModel = function() {
  boxGraph.connectors.forEach(a => send(a, 'checkIfSeparator'));

  const vt = send(boxGraph, 'boxNamed:', 'Vtable');
  id_vtable_lookup = send(vt, 'methodAt:', 'lookup');

  id_send   = send(send(boxGraph, 'boxNamed:', 'id_send'), 'asJSFunc');
  id_bind   = send(send(boxGraph, 'boxNamed:', 'id_bind'), 'asJSFunc');
  id_vtable = send(send(boxGraph, 'boxNamed:', 'id_vtable'), 'asJSFunc');
}
*/

// Translate the code in id-simple.svg to access the right state...!
/*
id_vtable = (o) => send(o, 'at:', 'vtable');

function id_bind(recv, selector) {
  if (send(recv, 'name') === 'Vtable' && selector === 'lookup')
    return id_vtable_lookup;
  return id_send(id_vtable(recv), 'lookup', selector);
}

function id_send(recv, selector, ...args) {
  let method = id_bind(recv, selector);
  if (!method)
    throw [recv, 'Does Not Understand', selector, ...args];
  let js_func = send(method, 'asJSFunc');
  return js_func(recv, ...args);
}

function vtable_lookup(self, symbol) {
  let method = send(self, 'methodAt:', symbol);
  if (method) return method;
  let parent = send(self, 'at:', 'parent');
  if (parent) return id_send(parent, 'lookup', symbol);
}
*/