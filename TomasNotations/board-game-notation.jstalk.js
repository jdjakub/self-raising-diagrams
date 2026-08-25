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

    // Ensure BoardState gets parsed second, to define the board zones
    const i = regions.findIndex(([,ruleName]) => ruleName === 'BoardState');
    if (i >= regions.length) throw 'No BoardState region';
    const [boardState] = regions.splice(i,1);
    regions.unshift(boardState);

    // Ensure BoardLegend gets parsed first, to define the BoardPiece rule
    const j = regions.findIndex(([,ruleName]) => ruleName === 'BoardLegend');
    if (j >= regions.length) throw 'No BoardLegend region';
    const [legend] = regions.splice(j,1);
    regions.unshift(legend);

    const regionSemantics = {};
    for (const [instName, ruleName, r] of regions) {
      log('Parse '+⟦r id⟧+' as '+ruleName, r);
      if (!hasRule({vtable: 'BoardGameNotation'}, ruleName)) {
        console.warn('No such rule: BoardGameNotation>>'+ruleName); continue;
      }
      const result = match(vtables.BoardGameNotation, ⟦r interior⟧, ruleName);
      if (ruleName === 'BoardLegend')
        vtables.BoardGameNotation['boardPieces'] = () => result;
      else if (ruleName === 'BoardState')
        vtables.BoardGameNotation['boardZones'] = () => result.zones;
      result.fromRule = ruleName;
      regionSemantics[instName] = result;
    }
    return regionSemantics;
  },

  ['exportJSForApp']: (self, regionSemantics) => {
    if (!regionSemantics) regionSemantics = semantics;
    const moveSpecRules = [];
    const transformRules = [];
    const zones = {};
    const combosGraph = { terminal: new Set(), transitions: [] };
    for (const [instName, sem] of Object.entries(regionSemantics)) {
      // Add full move label and anchor piece to each MoveSpec rule
      if (sem.fromRule === 'MoveSpec') {
        const parts = instName.split(' '); // eg 'MOVES', '-', 'REGULAR'
        const movePrefix = last(parts); // 'REGULAR'
        moveSpecRules.push(...sem.map(({name,inner}) => {
          // Move label = last part of inst name (+ [rule name])
          if (name === undefined || name === null) name = '';
          else name = '['+name+']'
          const label = movePrefix+name;
          // Anchor piece = the non-wildcard board piece in the rule
          const {before, after} = inner;
          const rulePieces = before.map(([,,piece]) => piece)
            .filter(piece => piece !== null && !piece.startsWith('any-'));
          // ^ Unfortunate harcoded exclusion of wildcard any-* but idk what else to do
          const anchor = rulePieces.length > 0 ? rulePieces[0] : null;

          return { piece: anchor, label, before, after };
        }));
      } else if (sem.fromRule === 'TransformSpec') {
        transformRules.push(...sem.map(([zone,beforePiece,afterPiece]) => ({
          piece: beforePiece, region: zone, transform: afterPiece
        })));
      } else if (sem.fromRule === 'BoardState') {
        const cells = sem.pieces.map(([x,y,,zone]) => [x,y,zone]).filter(([,,zone]) => zone);
        for (const [x,y,zone] of cells) {
          let zoneCells = zones[zone];
          if (!zoneCells) zoneCells = zones[zone] = [];
          zoneCells.push([x,y]);
        }
      } else if (sem.fromRule === 'CombosSpec') {
        // First, delete spaces caused by with weird PPT text-run breaks
        sem.edges = sem.edges.map(([from,edge,to]) => [from,edge.replaceAll(' ',''),to]);
        const outEdges = {};
        for (const [from,edge,to] of sem.edges) {
          if (!outEdges[from]) outEdges[from] = [];
          outEdges[from].push([edge,to]);
        }
        const isInitial = state => sem.stateClasses[state].toLowerCase().includes('initial');
        combosGraph.transitions = sem.edges.flatMap(([from,edge,to]) => {
          log([from,edge,to]);
          const starred = edge.endsWith('*');
          const destarred = edge.substring(0, edge.length-1);
          const fromm = isInitial(from) ? 'start' : from; // Only one initial node in output
          if (isInitial(to)) {
            if (isInitial(from)) {
              combosGraph.terminal.add('end');
              return [[fromm,edge,'end']];
            }
            if (starred) {
              combosGraph.terminal.add(from); // Finality spreads back thru * edges
              return [[from,destarred,from]] // `from` now a final state; compile star to loop
            }
          }
          if (isInitial(from) && starred // Finality spreads forward thru * edges
              || !outEdges[to]) // No out edges => final
            combosGraph.terminal.add(to);
          if (starred) {
            return [[fromm,destarred,to], // Take one step to preserve direction memory
                    [to,destarred,to]] // then consume any number
              .concat(outEdges[to].map(([edge2,to2]) => [fromm,edge2,to2]));
              // ^ if 0 iterations, act as if we are the `to` state
          }
          return [[fromm,edge,to]]; // Default
        });
      }
    }
    const rulesSpec = 'const rules = [\n' +
      moveSpecRules.map(rule => toJSish(rule)).join(',\n') + '\n];';
    const combosSpec = 'const combinations = {\n' +
      'initial: "start",\n' +
      'terminal: ' + toJSish(Array.from(combosGraph.terminal)) + ',\n' +
      'transitions: [\n' +
        combosGraph.transitions.map(t => toJSish(t)).join(',\n') +
      '\n]\n};';
    const transformSpec = 'const transforms = [\n' +
      transformRules.map(rule => toJSish(rule)).join(',\n') + '\n];';
    const zoneSpec = 'const areas = ' + toJSish(zones) + ';'
    return [rulesSpec,combosSpec,transformSpec,zoneSpec].join('\n\n');
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
    return boxes.find(bx => ⟦bx signedDistanceToPt: pt⟧ <= ⟦self connectToShapeEpsilon⟧);
  },

  // BoardPat = BoardPiece+   (region-claims within the lent interior scope)
  ['BoardPat']: (self) => {
    const pieces = ⟦self many1: () => ⟦self claimMatching: 'BoardPiece'⟧⟧;

    pieces.sort((p1, p2) => ⟦p1 center⟧[0] - ⟦p2 center⟧[0]); // Low to high X
    pieces.sort((p1, p2) => ⟦p1 center⟧[1] - ⟦p2 center⟧[1]); // Low to high Y
    const origin = ⟦pieces[0] center⟧;
    const [width,height] = props(pieces[0].getBBox(), 'width', 'height'); // Taking the first to set the example
    const pattern = pieces.map(piece => {
      // Assuming pieceName === 'Board'...
      const localCenter = vsub(⟦piece center⟧, origin);
      const fracCoords = vcmul([1/width,1/height], localCenter);
      const coords = fracCoords.map(Math.round);
      const contained = ⟦piece interior⟧.children;
      let innerName = null; // Means tile is empty
      if (contained.length > 0) {
        const innerPiece = ⟦contained[0] boundaryShape⟧;
        innerName = ⟦self identifyPiece: innerPiece⟧;
        innerName = innerName.replaceAll(' ','-').toLowerCase(); // 'Regular 1' => 'regular-1'
      }
      const result = [...coords, innerName];
      result.dom = piece; // HACK so we don't mess up the testing prints, but can still xref...
      return result;
    });
    // Finally, translate coords to be nonnegative
    const minX = Math.min(...pattern.map(([x,y,]) => x));
    const minY = Math.min(...pattern.map(([x,y,]) => y));
    for (const cell of pattern) {
      cell[0] -= minX; cell[1] -= minY;
    }
    return pattern;
  },

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
    elt.pieceName = ⟦self identifyPiece: elt⟧;
    ⟦self pred: elt.pieceName !== null⟧;
    return elt;
  },

  // TransformSpec = BeforeAfter(ZonePat, BoardPiece)
  ['TransformSpec']: (self) => {
    const rules = ⟦self many1: () => ⟦self Before: 'ZonePat' After: 'SinglePiece'⟧⟧
                  .map(nt => nt.inner); // We don't expect names
    return rules.map(({before, after}) => {
      const beforeZone = ⟦self identifyZone: before⟧;
      // SMELL duped from BoardPat
      const contained = ⟦before interior⟧.children;
      let beforeName = 'empty';
      if (contained.length > 0) {
        const innerPiece = ⟦contained[0] boundaryShape⟧;
        beforeName = ⟦self identifyPiece: innerPiece⟧;
      } // end smell
      const afterName = ⟦self identifyPiece: after⟧;
      return [beforeZone, beforeName, afterName].map(s => s.replaceAll(' ','-').toLowerCase());
    });
  },
  ['SinglePiece']: (self) => ⟦self claimMatching: 'BoardPiece'⟧,

  ['identifyZone:']: (self, dom) => {
    const zones = ⟦self boardZones⟧;
    const exemplar = zones.find(z => similarStyles(z.inner, dom));
    return exemplar && ⟦exemplar name⟧ || null;
  },

  // ZonePat = Zone(BoardPiece)
  ['ZonePat']: (self) => ⟦self claimMatching: 'Zone'⟧,

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

    const similarityClass = (dom) => {
      // First, match to diagram-defined states, naturally by visual similarity
      let st = states.find(s => similarShapes(s.inner, dom));
      if (!st) {
        // OK, register this shape as a new similarity class
        st = { vtable: 'NamedThing', name: ⟦dom id⟧, inner: dom };
        states.push(st);
      }
      return st.name;
    };
    const edgeTriples = [];
    const stateClasses = {}; // Visual similarity classes
    for (const g of graphs) {
      for (const e of g.edges) {
        const [fromState, toState] = ⟦g connectionsOf: e⟧;
        const [fromId, toId] = [⟦fromState id⟧, ⟦toState id⟧];
        edgeTriples.push([fromId, e.name, toId]);
        stateClasses[fromId] = similarityClass(fromState);
        stateClasses[toId]   = similarityClass(toState);
      }
    }
    return { edges: edgeTriples, stateClasses };
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
  // BoardState = BoardPat Named(Zone)*
  ['BoardState']: (self) => {
    let pieces = ⟦self apply: 'BoardPat'⟧;
    const zones  = ⟦self many: () => ⟦self Named: 'Zone'⟧⟧;
    for (const piece of pieces) {
      for (const zone of zones) {
        if (⟦zone.inner interior⟧.contains(piece.dom))
          piece.dom.zone = zone.name.replaceAll(' ','-').toLowerCase();
      }
    }
    pieces = pieces.map(piece =>
      piece.dom.zone !== undefined ? [...piece, piece.dom.zone] : piece
    );
    return { pieces, zones };
  },

  ['testCheckers']: (self) => {
    window.semantics = ⟦self fromRegion: svg_parent⟧;
    // If that went well... let's check the results
    const assert = b => { if (!b) throw 'You broke Checkers!'; };
    // === MoveSpec ===
    const moveSpec = key =>
      log(semantics[key].map(({name,inner}) => `${inner.before} -> ${inner.after}`)
      .join('\n'));
    // Beware of reorderings - jump that bridge when we get there
    assert(moveSpec('MOVES - REGULAR') ===
`0,0,,1,1,regular-1 -> 0,0,regular-1,1,1,
1,0,,0,1,regular-1 -> 1,0,regular-1,0,1,
0,0,regular-2,1,1, -> 0,0,,1,1,regular-2
1,0,regular-2,0,1, -> 1,0,,0,1,regular-2`
    );
    assert(moveSpec('MOVES - REGULAR_JUMP') ===
`2,0,,1,1,any-2,0,2,regular-1 -> 2,0,regular-1,1,1,,0,2,
0,0,,1,1,any-2,2,2,regular-1 -> 0,0,regular-1,1,1,,2,2,
2,0,regular-2,1,1,any-1,0,2, -> 2,0,,1,1,,0,2,regular-2
0,0,regular-2,1,1,any-1,2,2, -> 0,0,,1,1,,2,2,regular-2`
    );
    const namedMoveSpec = key =>
      log(semantics[key].map(({name,inner}) => `${inner.before} --${name}--> ${inner.after}`)
      .join('\n'));
    assert(namedMoveSpec('MOVES - KING') ===
`0,0,,1,1,king-1 --LU--> 0,0,king-1,1,1,
1,0,,0,1,king-1 --RU--> 1,0,king-1,0,1,
0,0,king-1,1,1, --RD--> 0,0,,1,1,king-1
1,0,king-1,0,1, --LD--> 1,0,,0,1,king-1
0,0,,1,1,king-2 --LU--> 0,0,king-2,1,1,
1,0,,0,1,king-2 --RU--> 1,0,king-2,0,1,
0,0,king-2,1,1, --RD--> 0,0,,1,1,king-2
1,0,king-2,0,1, --LD--> 1,0,,0,1,king-2`
    );
    assert(namedMoveSpec('MOVES - KING_JUMP') ===
`2,0,,1,1,any-2,0,2,king-1 --RU--> 2,0,king-1,1,1,,0,2,
0,0,king-1,1,1,any-2,2,2, --RD--> 0,0,,1,1,,2,2,king-1
2,0,,1,1,any-1,0,2,king-2 --RU--> 2,0,king-2,1,1,,0,2,
0,0,king-2,1,1,any-1,2,2, --RD--> 0,0,,1,1,,2,2,king-2
2,0,king-1,1,1,any-2,0,2, --LD--> 2,0,,1,1,,0,2,king-1
0,0,,1,1,any-2,2,2,king-1 --LU--> 0,0,king-1,1,1,,2,2,
2,0,king-2,1,1,any-1,0,2, --LD--> 2,0,,1,1,,0,2,king-2
0,0,,1,1,any-1,2,2,king-2 --LU--> 0,0,king-2,1,1,,2,2,`
    );
    // === CombosSpec ===
    const combosSpec = key =>
      log(semantics[key].edges.map(([f,n,t]) => `${f} --${n}--> ${t}`)
      .join('\n'))
    // I ain't implementing graph isomorphism. Beware reorderings, different IDs etc
    // Should be stable...
    assert(combosSpec('COMBINATIONS') ===
`e409 --KING[RU]*--> e411
e411 --KING_JUMP[RU]--> e412
e412 --KING[RU]*--> e409
e409 --KING[RD]*--> c422
c422 --KING_JUMP[RD]--> c423
e409 --KING[LU]*--> c431
c431 --KING_JUMP[LU]--> c432
e409 --KING[LD]*--> c440
c440 --KING_JUMP[LD]--> c441
c423 --KING[RD]*--> e409
c432 --KING[LU]*--> e409
c441 --KING[LD]*--> e409
e457 --REGULAR--> e458
e463 --REGULAR_JUMP--> e463`
    );
    assert(Object.entries(semantics['COMBINATIONS'].stateClasses)
           .map(kv => kv.join(' is a ')).join('\n') ===
`e409 is a Initial / final state
e411 is a e411
e412 is a e411
c422 is a e411
c423 is a e411
c431 is a e411
c432 is a e411
c440 is a e411
c441 is a e411
e457 is a Initial / final state
e458 is a e411
e463 is a Initial / final state`
    );
    // === BoardState ===
    assert(semantics['INITIAL'].pieces.join('\n') ===
`0,0,,black-king-area
1,0,regular-2,black-king-area
2,0,,black-king-area
3,0,regular-2,black-king-area
4,0,,black-king-area
5,0,regular-2,black-king-area
6,0,,black-king-area
7,0,regular-2,black-king-area
0,1,regular-2
1,1,
2,1,regular-2
3,1,
4,1,regular-2
5,1,
6,1,regular-2
7,1,
0,2,
1,2,regular-2
2,2,
3,2,regular-2
4,2,
5,2,regular-2
6,2,
7,2,regular-2
0,3,
1,3,
2,3,
3,3,
4,3,
5,3,
6,3,
7,3,
0,4,
1,4,
2,4,
3,4,
4,4,
5,4,
6,4,
7,4,
0,5,regular-1
1,5,
2,5,regular-1
3,5,
4,5,regular-1
5,5,
6,5,regular-1
7,5,
0,6,
1,6,regular-1
2,6,
3,6,regular-1
4,6,
5,6,regular-1
6,6,
7,6,regular-1
0,7,regular-1,white-king-area
1,7,,white-king-area
2,7,regular-1,white-king-area
3,7,,white-king-area
4,7,regular-1,white-king-area
5,7,,white-king-area
6,7,regular-1,white-king-area
7,7,,white-king-area`
    );
    // === TransformSpec ===
    assert(semantics['TRANSFORMS'].map(([zone,before,after]) =>
      `${before} in ${zone} becomes ${after}`).join('\n') ===
`regular-1 in black-king-area becomes king-1
regular-2 in white-king-area becomes king-2`
    );
    log('Great Success! Don\'t fret - there\'s still plenty of ways to break Checkers.' );
  },
};