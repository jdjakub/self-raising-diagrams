vtables.AnimationNotation = {
  _parent: vtables.NotationGrammar,

  // Root = BiGraph(Label,NameArrow,Any):names Named(SeqBox)*:seqs
  ['Root']: (self) => {
    let names = send(self, 'BiGraphFrom:', 'NameLabel', 'via:', 'NameArrow', 'to:', 'Any');
    let seqs  = send(self, 'many:', () => send(self, 'NamedSeqBox'));

    const namingElts = names.flatMap(({from,edge}) => [from,edge]);

    names = names.map(({from, to}) => [send(from, 'string'), to]);
    names = Object.fromEntries(names);
    seqs = seqs.map(({name, inner}) => [
      inner.edges.map(e => [
        e.name !== undefined? e.name : 'init', ...send(inner, 'connectionsOf:', e)
      ]).map(([event,from,to]) => [from,event,to]),
      inner.nodes, name
    ]);
    seqs = seqs.map(([triples, nodes, seqName]) => {
      let sources = new Set(nodes);
      for (const [,,to] of triples) sources.delete(to);
      const objs = {};
      for (const [from,event,to] of triples) {
        let [fromObj, toObj] = [objs[send(from, 'id')], objs[send(to, 'id')]];
        if (!fromObj) fromObj = objs[send(from, 'id')] = {};
        if (!toObj)     toObj = objs[send(to, 'id')]   = {};
        fromObj[event] = send(to, 'id');
      }
      sources = Array.from(sources);
      const seqsBySource = Object.fromEntries(sources.map(s => [send(s, 'id'), {}]));
      for (const s of sources) {
        const mySeq = seqsBySource[send(s, 'id')];
        const exploreFromId = (stateId) => {
          const obj = objs[stateId];
          for (const [event,toId] of Object.entries(obj)) {
            let onEvent = mySeq[event];
            if (!onEvent) onEvent = mySeq[event] = {};
            const cmdsString = send(byId(toId), 'string');
            const cmds = cmdsString.split('\n').map(cmdStr => cmdStr.split(' '));
            // For simplicity, the initial state has a well-known name
            if (stateId === send(s, 'id')) stateId = 'start';
            // On the event, if s is in state [stateId], execute cmd and move to state [toId]
            onEvent[stateId] = [cmds, toId];
            exploreFromId(toId); // depth-first traversal
          }
        }
        exploreFromId(send(s, 'id'));
      }
      return [seqsBySource,seqName];
    });
    const byEvent = {};
    // Shuffle around the nesting order to go: event -> src -> state -> (cmds, state)
    for (const [eventsBySource, seqName] of seqs) {
      for (const [src, statesByEvent] of Object.entries(eventsBySource)) {
        for (const [event, cmdsByState] of Object.entries(statesByEvent)) {
          let seqNamesBySource = byEvent[event];
          if (!seqNamesBySource) seqNamesBySource = byEvent[event] = {};
          const srcStr = send(byId(src), 'string'); // eg "e1, e2"
          const srcNames = srcStr.split(',').map(t => t.trim());
          for (const srcName of srcNames) {
            let statesBySeqName = seqNamesBySource[srcName];
            if (!statesBySeqName) statesBySeqName = seqNamesBySource[srcName] = {};
            statesBySeqName[seqName] = cmdsByState;
          }
        }
      }
    }
    return { vtable: 'AnimationController', eltsByName: names, byEvent, namingElts };
  },

  ['NamedSeqBox']: (self) => {
    const nb = send(self, 'Named:', 'SeqBox');
    const graph = send(self, 'lend:', self.vtable, 'input:', send(nb.inner, 'interior'), 'rule:', 'SeqGraph');
    return { vtable: 'NamedThing', name: nb.name, inner: graph };
  },

  ['SeqGraph']: (self) => send(self, 'GraphWithVertices:', 'Text',
                                'andEdges:', (self) => send(self, 'Named:', 'SeqArrow')),

  // Hence:
  ['textsCanBeVertices']: () => true,

  ['seqColor']:     () => 'rgb(184, 10, 10)',
  ['namingColor']:  () => 'rgb(45, 184, 10)',

  ['SeqBoxSel']: () => 'rect.boundary-shape',
  ['SeqBox']: (self) => {
    const elt = self.cursor.dict;
    send(self, 'pred:', elt.matches(send(self, 'SeqBoxSel')) && getComputedStyle(elt).stroke === send(self, 'seqColor'));
    return elt;
  },

  ['SeqArrowSel']: () => 'g.connector-wrapper',
  ['SeqArrow']: (self) => {
    const elt = self.cursor.dict;
    const shaft = elt.querySelector('.connector-shaft');
    send(self, 'pred:', elt.matches(send(self, 'NameArrowSel')) && getComputedStyle(shaft).stroke === send(self, 'seqColor'));
    return elt;
  },

  ['NameArrowSel']:() => 'g.connector-wrapper',
  ['NameArrow']: (self) => {
    const elt = self.cursor.dict;
    const shaft = elt.querySelector('.connector-shaft');
    send(self, 'pred:', elt.matches(send(self, 'NameArrowSel')) && getComputedStyle(shaft).stroke === send(self, 'namingColor'));
    return elt;
  },
  
  ['TextSel']: () => 'g.text-wrapper',
  ['Text']: (self) => self.cursor.dict,

  ['NameLabelSel']: () => 'g.text-wrapper:not(.is-multiline)',
  ['NameLabel']: (self) => {
    const elt = self.cursor.dict;
    const text = elt.querySelector('text');
    send(self, 'pred:', elt.matches(send(self, 'NameLabelSel')) && getComputedStyle(text).fill === send(self, 'namingColor'));
    return elt;
  },
};

vtables.AnimationController = {
  ['doEvent:']: (self, event) => {
    if (event === 'init') 
      for (const elt of self.namingElts) elt.remove();
    
    const seqByEltName = self.byEvent[event];
    if (!seqByEltName) {
      console.warn("Ignoring unknown event '"+event+"'");
      return;
    }
    
    for (const [eltName, statesBySeqName] of Object.entries(seqByEltName)) {
      const elt = self.eltsByName[eltName];
      let eltStatesBySeqName = elt.animState;
      if (!eltStatesBySeqName) eltStatesBySeqName = elt.animState = {};
      for (const [seqName, cmdsByState] of Object.entries(statesBySeqName)) {
        const eltState = eltStatesBySeqName[seqName] || 'start';
        const action = cmdsByState[eltState];
        if (!action) continue;
        const [cmds,nextState] = action;
        for (const cmd of cmds) send(self, 'execute:', cmd, 'on:', elt);
        eltStatesBySeqName[seqName] = nextState;
      }
    }
  },
  ['execute:on:']: (self, [op,...args], elt) => {
    if (op === 'opacity') {
      elt.style.opacity = args[0];
    } else if (op === 'text') {
      // SMELL DOM munging
      // SMELL split on spaces, first token only
      elt.querySelector('text').textContent = args[0];
    }
  },
  ['beginSlideshow']: (self) => {
    send(self, 'doEvent:', 'init');
    self.clickCount = 1;
    svg_parent.onclick = () => {
      const suffix = self.clickCount === 1 ? '' : ' ' + self.clickCount;
      send(self, 'doEvent:', 'click'+suffix);
      self.clickCount++;
    }
  }
};