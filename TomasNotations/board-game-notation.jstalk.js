vtables.BoardGameNotation = {
  _parent: vtables.NotationGrammar,

  ['fromRegion:']: (self, scope) => {
    scope = ⟦scope.querySelector('g') interior⟧;
    let regions = match(vtables.RegionDispatchNotation, scope, 'Root'); // [NamedThing]
    regions = regions.map(r => {
      const name = ⟦r name⟧;
      if (name === undefined) {
        console.warn('Undefined region: '+⟦r id⟧, r.inner);
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
      log('Parse '+⟦r id⟧+' as '+ruleName, r);
      if (!hasRule({vtable: 'BoardGameNotation'}, ruleName)) {
        console.warn('No such rule: BoardGameNotation>>'+ruleName); continue;
      }
      const result = match(vtables.BoardGameNotation, ⟦r interior⟧, ruleName);
      if (ruleName === 'BoardLegend') {
        vtables.BoardGameNotation['boardPieces'] = () => result;
      }
      regionSemantics[instName] = result;
    }
    return regionSemantics;
  },

  // Legend entries: each shape (tile, piece glyph) with its name above it.
  // Same name-string on several shapes is fine — they're exemplars of one
  // category; Named stays injective per element.
  // BoardLegend = Named(Shape)+
  ['BoardLegend']: (self) => ⟦self many1: () => ⟦self Named: 'Shape'⟧⟧,

  // The connector's endpoints resolve, under constraint, to a box matching `b`
  // (origin side) and a box matching `a` (target side); each box's interior is
  // then parsed as a BoardPat. Result: { name, before, after }.
  // MoveSpec = BeforeAfter(BoardPat, BoardPat)+
  ['MoveSpec']: (self) => ⟦self many1: () => ⟦self Before: 'BoardPat' After: 'BoardPat'⟧⟧,

  // Claim the connector (+ its name); resolve its endpoints against claimed-or-
  // unclaimed boxes (REFERENCING, not claiming — piercing lookup); lend each
  // resolved box's interior to the corresponding pattern rule.
  // BeforeAfter(b, a) = Named(Arrow)(Box(b), Box(a))
  ['Before:After:']: (self, b, a) => {
    const arrow = ⟦self Named: 'Arrow'⟧;
    const [originPt, targetPt] = ⟦arrow.inner endpoints⟧;
    const [originBox, targetBox] = [⟦self boxAt: originPt⟧, ⟦self boxAt: targetPt⟧];
    ⟦self pred: originBox !== null && targetBox !== null⟧;
    const before = ⟦self lend: self.vtable input: ⟦originBox interior⟧ rule: b⟧;
    const after  = ⟦self lend: self.vtable input: ⟦targetBox interior⟧ rule: a⟧;
    return { vtable: 'NamedThing', name: arrow.name, inner: { before, after } };
  },

  // Arrow = a canonical connector-wrapper
  // SMELL: dupe of Connector
  ['ArrowSel']: (self) => 'g.connector-wrapper',
  ['Arrow']: (self) => {
    const elt = self.cursor.dict;
    ⟦self pred: elt.matches(⟦self ArrowSel⟧)⟧;
    return elt;
  },

  ['boxAt:']: (self, pt) => {
    const boxes = [...self.cursor.scope.querySelectorAll('rect.boundary-shape')];
    return boxes.find(bx => ⟦bx signedDistanceToPt: pt⟧ <= ⟦self connectorEpsilon⟧);
  },

  // BoardPat = BoardPiece*   (region-claims within the lent interior scope)
  ['BoardPat']: (self) => ⟦self many: () => ⟦self claimMatching: 'BoardPiece'⟧⟧,

  ['identifyPiece:']: (self, shape) => {
    const pieceExemplars = ⟦self boardPieces⟧;
    const exemplar = pieceExemplars.find(e => similarShapes(e.inner,shape));
    return exemplar && ⟦exemplar name⟧ || null;
  },

  // SMELL dupe of Shape
  ['BoardPieceSel']: (self) => '.boundary-shape',
  ['BoardPiece']: (self) => {
    const elt = self.cursor.dict;
    ⟦self pred: elt.matches(⟦self BoardPieceSel⟧)⟧;
    ⟦self not: () => ⟦self apply: 'Zone'⟧⟧;
    ⟦self pred: ⟦self identifyPiece: elt⟧⟧;
    return elt;
  },

  // TransformSpec = BeforeAfter(ZonePat, BoardPiece)
  ['TransformSpec']: (self) => ⟦self many1: () => ⟦self Before: 'ZonePat' After: 'SinglePiece'⟧⟧,
  ['SinglePiece']: (self) => ⟦self claimMatching: 'BoardPiece'⟧,

  // ZonePat = Zone(BoardPiece)
  ['ZonePat']: (self) => ⟦self many: () => ⟦self claimMatching: 'Zone'⟧⟧,

  // Zone = a red/green rect (but just look for a rect)
  ['ZoneSel']: (self) => 'rect.boundary-shape[stroke-width="3.00038"]', // HACK until BoardLegend supplies
  ['Zone']: (self) => {
    const elt = self.cursor.dict;
    ⟦self pred: elt.matches(⟦self ZoneSel⟧)⟧;
    return elt;
  },

  // Boxes first: claiming a box prunes its subtree, so the trailing
  // Named(State)* sees only top-level states, not those inside the graphs.
  // CombosSpec = Box(ComboGraph)+ Named(State)*
  ['CombosSpec']: (self) => {
    const graphs = ⟦self many1: () => ⟦self Box: 'ComboGraph'⟧⟧;
    const states = ⟦self  many: () => ⟦self Named: 'State'⟧⟧;
    return { graphs, states };
  },

  // ComboGraph = Graph(State, Named(Arrow))
  ['ComboGraph']: (self) => ⟦self GraphWithVertices: 'State'
                                  andEdges: (self) => ⟦self Named: 'Arrow'⟧⟧,

  // State — dummy until the actual glyph encoding is known
  ['StateSel']: (self) => '.boundary-shape',
  ['State']: (self) => {
    const elt = self.cursor.dict;
    ⟦self pred: elt.matches(⟦self StateSel⟧)⟧;
    return elt;
  },

  // Pieces first: nothing claimed yet, so the search descends freely into the
  // zones and collects the pieces inside them. The zone rects stay unclaimed,
  // hence still reachable by the second pass.
  // BoardState = BoardPiece* Named(Zone)*
  ['BoardState']: (self) => {
    const pieces = ⟦self many: () => ⟦self claimMatching: 'BoardPiece'⟧⟧;
    const zones  = ⟦self many: () => ⟦self Named: 'Zone'⟧⟧;
    return { pieces, zones };
  },
};