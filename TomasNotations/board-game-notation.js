vtables.BoardGameNotation = {
  _parent: vtables.NotationGrammar,

  ['fromRegion:']: (self, scope) => {
    scope = send(scope.querySelector('g'), 'interior');
    let regions = match(vtables.RegionDispatchNotation, scope, 'Root'); // [NamedThing]
    regions = regions.map(r => {
      const name = send(r, 'name');
      if (name === undefined) {
        console.warn('Undefined region: '+send(r, 'id'), r.inner);
        return null;
      }
      // name = "{instName} (:{ruleName})"
      const [, instName, ruleName] = name.match(/^\s*(.*?)\s*\(:(\w+)\)$/);
      return [instName, ruleName, r.inner];
    }).filter(r => r !== null);

    // Ensure BoardLegend gets parsed first, to define the BoardPiece rule
    const i = regions.findIndex(([,ruleName]) => ruleName === 'BoardLegend');
    if (i >= regions.length) throw 'No BoardLegend region';
    const [legend] = regions.splice(i,1);
    regions.unshift(legend);

    const regionSemantics = {};
    for (const [instName, ruleName, r] of regions) {
      log('Parse '+send(r, 'id')+' as '+ruleName, r);
      if (!hasRule({vtable: 'BoardGameNotation'}, ruleName)) {
        console.warn('No such rule: BoardGameNotation>>'+ruleName); continue;
      }
      const result = match(vtables.BoardGameNotation, send(r, 'interior'), ruleName);
      if (ruleName === 'BoardLegend') {
        vtables.BoardGameNotation['boardPieces'] = () => result;
      }
      result.fromRule = ruleName;
      regionSemantics[instName] = result;
    }
    return regionSemantics;
  },

  ['abstractSemantics:']: (self, regionSemantics) => {
    
  },

  ['checkersTest:']: (self, sem) => {
    const assert = b => { if (!b) throw 'Assertion failure'; };

  },

  // Legend entries: each shape (tile, piece glyph) with its name above it.
  // Same name-string on several shapes is fine — they're exemplars of one
  // category; Named stays injective per element.
  // BoardLegend = Named(Shape)+
  ['BoardLegend']: (self) => send(self, 'many1:', () => send(self, 'Named:', 'Shape')),

  // The connector's endpoints resolve, under constraint, to a box matching `b`
  // (origin side) and a box matching `a` (target side); each box's interior is
  // then parsed as a BoardPat. Result: { name, before, after }.
  // MoveSpec = BeforeAfter(BoardPat, BoardPat)+
  ['MoveSpec']: (self) => send(self, 'many1:', () => send(self, 'Before:', 'BoardPat', 'After:', 'BoardPat')),

  // Claim the connector (+ its name); resolve its endpoints against claimed-or-
  // unclaimed boxes (REFERENCING, not claiming — piercing lookup); lend each
  // resolved box's interior to the corresponding pattern rule.
  // BeforeAfter(b, a) = Named(Arrow)(Box(b), Box(a))
  ['Before:After:']: (self, b, a) => {
    const arrow = send(self, 'Named:', 'Arrow');
    const [originPt, targetPt] = send(arrow.inner, 'endpoints');
    const [originBox, targetBox] = [send(self, 'boxAt:', originPt), send(self, 'boxAt:', targetPt)];
    send(self, 'pred:', originBox !== null && targetBox !== null);
    const before = send(self, 'lend:', self.vtable, 'input:', send(originBox, 'interior'), 'rule:', b);
    const after  = send(self, 'lend:', self.vtable, 'input:', send(targetBox, 'interior'), 'rule:', a);
    return { vtable: 'NamedThing', name: arrow.name, inner: { before, after } };
  },

  // Arrow = a canonical connector-wrapper
  // SMELL: dupe of Connector
  ['ArrowSel']: (self) => 'g.connector-wrapper',
  ['Arrow']: (self) => {
    const elt = self.cursor.dict;
    send(self, 'pred:', elt.matches(send(self, 'ArrowSel')));
    return elt;
  },

  ['boxAt:']: (self, pt) => {
    const boxes = [...self.cursor.scope.querySelectorAll('rect.boundary-shape')];
    return boxes.find(bx => send(bx, 'signedDistanceToPt:', pt) <= send(self, 'connectToShapeEpsilon'));
  },

  // BoardPat = BoardPiece+   (region-claims within the lent interior scope)
  ['BoardPat']: (self) => {
    const pieces = send(self, 'many1:', () => send(self, 'claimMatching:', 'BoardPiece'));

    pieces.sort((p1, p2) => send(p1, 'center')[0] - send(p2, 'center')[0]); // Low to high X
    pieces.sort((p1, p2) => send(p1, 'center')[1] - send(p2, 'center')[1]); // Low to high Y
    const origin = send(pieces[0], 'center');
    const [width,height] = props(pieces[0].getBBox(), 'width', 'height'); // Taking the first to set the example
    const pattern = pieces.map(piece => {
      // Assuming pieceName === 'Board'...
      const localCenter = vsub(send(piece, 'center'), origin);
      const fracCoords = vcmul([1/width,1/height], localCenter);
      const coords = fracCoords.map(Math.round);
      const contained = send(piece, 'interior').children;
      let innerName = 'empty';
      if (contained.length > 0) {
        const innerPiece = send(contained[0], 'boundaryShape');
        innerName = send(self, 'identifyPiece:', innerPiece);
      }
      return [coords, innerName];
    });
    return pattern;
  },

  ['identifyPiece:']: (self, shape) => {
    const pieceExemplars = send(self, 'boardPieces');
    const exemplar = pieceExemplars.find(e => similarShapes(e.inner,shape));
    return exemplar && send(exemplar, 'name') || null;
  },

  // SMELL dupe of Shape
  ['BoardPieceSel']: (self) => '.boundary-shape',
  ['BoardPiece']: (self) => {
    const elt = self.cursor.dict;
    send(self, 'pred:', elt.matches(send(self, 'BoardPieceSel')));
    send(self, 'not:', () => send(self, 'apply:', 'Zone'));
    elt.pieceName = send(self, 'identifyPiece:', elt);
    send(self, 'pred:', elt.pieceName !== null);
    return elt;
  },

  // TransformSpec = BeforeAfter(ZonePat, BoardPiece)
  ['TransformSpec']: (self) => send(self, 'many1:', () => send(self, 'Before:', 'ZonePat', 'After:', 'SinglePiece')),
  ['SinglePiece']: (self) => send(self, 'claimMatching:', 'BoardPiece'),

  // ZonePat = Zone(BoardPiece)
  ['ZonePat']: (self) => send(self, 'many:', () => send(self, 'claimMatching:', 'Zone')),

  // Zone = a red/green rect (but just look for a rect)
  ['ZoneSel']: (self) => 'rect.boundary-shape[stroke-width="3.00038"]', // HACK until BoardLegend supplies
  ['Zone']: (self) => {
    const elt = self.cursor.dict;
    send(self, 'pred:', elt.matches(send(self, 'ZoneSel')));
    return elt;
  },

  // Boxes first: claiming a box prunes its subtree, so the trailing
  // Named(State)* sees only top-level states, not those inside the graphs.
  // CombosSpec = Box(ComboGraph)+ Named(State)*
  ['CombosSpec']: (self) => {
    const graphs = send(self, 'many1:', () => send(self, 'Box:', 'ComboGraph'));
    const states = send(self, 'many:', () => send(self, 'Named:', 'State'));

    const similarityClass = (dom) => {
      // First, match to diagram-defined states, naturally by visual similarity
      let st = states.find(s => similarShapes(s.inner, dom));
      if (!st) {
        // OK, register this shape as a new similarity class
        st = { vtable: 'NamedThing', name: send(dom, 'id'), inner: dom };
        states.push(st);
      }
      return st.name;
    };
    const edgeTriples = [];
    const stateClasses = {}; // Visual similarity classes
    for (const g of graphs) {
      for (const e of g.edges) {
        const [fromState, toState] = send(g, 'connectionsOf:', e);
        const [fromId, toId] = [send(fromState, 'id'), send(toState, 'id')];
        edgeTriples.push([fromId, e.name, toId]);
        stateClasses[fromId] = similarityClass(fromState);
        stateClasses[toId]   = similarityClass(toState);
      }
    }
    return { edges: edgeTriples, stateClasses };
  },

  // ComboGraph = Graph(State, Named(Arrow))
  ['ComboGraph']: (self) => send(self, 'GraphWithVertices:', 'State',
                                  'andEdges:', (self) => send(self, 'Named:', 'Arrow')),

  // State — dummy until the actual glyph encoding is known
  ['StateSel']: (self) => '.boundary-shape',
  ['State']: (self) => {
    const elt = self.cursor.dict;
    send(self, 'pred:', elt.matches(send(self, 'StateSel')));
    return elt;
  },

  // Pieces first: nothing claimed yet, so the search descends freely into the
  // zones and collects the pieces inside them. The zone rects stay unclaimed,
  // hence still reachable by the second pass.
  // BoardState = BoardPiece* Named(Zone)*
  ['BoardState']: (self) => {
    const pieces = send(self, 'many:', () => send(self, 'claimMatching:', 'BoardPiece'));
    const zones  = send(self, 'many:', () => send(self, 'Named:', 'Zone'));
    return { pieces, zones };
  },
};