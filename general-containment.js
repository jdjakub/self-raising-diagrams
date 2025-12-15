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
sendNoKw = function(recv, selector, args) {
  let vtable = vtables.byTag[recv.tagName];
  let method;
  do {
    method = vtable[selector];
    vtable = vtable._parent; // i.e. superclass
  } while (!method && vtable);
  if (!method && !vtable) throw ["Didn't understand: ",recv,selector,args];
  return method(recv, args);
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
    }
    return self;
  },
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
};

vtables.byTag['polygon'] = {
  _parent: vtables.byTag['polyline'],

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
    }
    return self;
  },
}

vtables.byTag['rect'] = {
  _parent: vtables.byTag['polygon'],
}

vtables.byTag['circle'] = {
  _parent: vtables.byTag['path'],
}

vtables.byTag['text'] = {
  _parent: null,
}