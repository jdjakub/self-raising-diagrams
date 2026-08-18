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
        if (!fromObj) fromObj = objs[send(from, 'id')] = { cmds: [], byEvent: {} };
        if (!toObj)     toObj = objs[send(to, 'id')]   = { cmds: [], byEvent: {} };
        fromObj.byEvent[event] = send(to, 'id');
      }
      // objs[fromStateId].byEvent[event] = toStateId
      for (const node of nodes) {
        if (sources.has(node)) continue;
        const nodeId = send(node, 'id');
        const obj = objs[nodeId];
        const cmdsString = send(byId(nodeId), 'string');
        obj.cmds = cmdsString.split('\n').map(cmdStr => cmdStr.split(' '));
      }
      sources = Array.from(sources);
      const seqsBySource = Object.fromEntries(sources.map(s => [send(s, 'id'), {}]));
      for (const s of sources) {
        const mySeq = seqsBySource[send(s, 'id')];
        const exploreFromId = (stateId) => {
          const fromState = objs[stateId];
          for (let [event,toId] of Object.entries(fromState.byEvent)) {
            // Rewrite e.g. 2s -> anim 2s
            if (!Number.isNaN(+event.substring(0,event.length-1))) event = 'anim '+event;

            let onEvent = mySeq[event];
            if (!onEvent) onEvent = mySeq[event] = {};
            // For simplicity, the initial state has a well-known name
            if (stateId === send(s, 'id')) stateId = 'start';
            // On the event, if s is in state [stateId], move to state [toId] (and execute its cmds)
            onEvent[stateId] = toId;

            // If the event is a timer-completion event, set the timer on entry to the from-state
            if (event.startsWith('wait')) objs[stateId].cmds.push(event.split(' '));
            // If it's an animation event, replace from-state cmds with single anim cmd
            else if (event.startsWith('anim')) {
              const animCmd = event.split(' ');
              animCmd.push(objs[stateId].cmds);
              animCmd.push(objs[toId].cmds);
              objs[stateId].cmds = [animCmd];
            }
            exploreFromId(toId); // depth-first traversal
          }
        }
        exploreFromId(send(s, 'id'));
      }
      return [seqsBySource,objs,seqName];
    });
    const byEvent = {};
    const cmdsByState = {};
    // Shuffle around the nesting order to go: event -> src -> state -> state
    for (const [eventsBySource, objs, seqName] of seqs) {
      for (const [src, statesByEvent] of Object.entries(eventsBySource)) {
        for (const [event, nextStateByState] of Object.entries(statesByEvent)) {
          let seqNamesBySource = byEvent[event];
          if (!seqNamesBySource) seqNamesBySource = byEvent[event] = {};
          const srcStr = send(byId(src), 'string'); // eg "e1, e2"
          const srcNames = srcStr.split(',').map(t => t.trim());
          for (const srcName of srcNames) {
            let statesBySeqName = seqNamesBySource[srcName];
            if (!statesBySeqName) statesBySeqName = seqNamesBySource[srcName] = {};
            statesBySeqName[seqName] = nextStateByState;
          }
        }
      }
      for (const [state, { cmds }] of Object.entries(objs)) cmdsByState[state] = cmds;
    }
    return { vtable: 'AnimationController', eltsByName: names, byEvent, cmdsByState, namingElts };
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

    const isWait = event instanceof Array;
    const timerId = isWait? event[1] : null;
    if (isWait) event = event[0];
    
    const seqByEltName = self.byEvent[event];
    if (!seqByEltName) {
      console.warn("Ignoring unknown event '"+event+"'");
      return;
    }
    
    for (const [eltName, statesBySeqName] of Object.entries(seqByEltName)) {
      const elt = self.eltsByName[eltName];
      if (isWait && elt.timerId !== timerId) continue;
      if (elt.activeAnim) {
        elt.activeAnim.cancel();
        elt.activeAnim = null;
      }
      let eltStatesBySeqName = elt.animState;
      if (!eltStatesBySeqName) eltStatesBySeqName = elt.animState = {};
      for (const [seqName, nextStateByState] of Object.entries(statesBySeqName)) {
        const eltState = eltStatesBySeqName[seqName] || 'start';
        const nextState = nextStateByState[eltState];
        if (!nextState) continue;
        const cmds = self.cmdsByState[nextState];
        for (const cmd of cmds) send(self, 'execute:', cmd, 'on:', elt);
        eltStatesBySeqName[seqName] = nextState;
      }
    }

    if (isWait) send(self, 'waitComplete:', [event,timerId]);
    self.timerId++;
  },
  ['execute:on:']: (self, [op,...args], elt) => {
    if (op === 'opacity') {
      elt.style.opacity = args[0];
    } else if (op === 'stroke') {
      elt.style.stroke = args[0];
    } else if (op === 'scale') {
      attrs(elt, {transform: 'scale('+args[0]+')', transform_origin: send(elt, 'center').join(' ') });
    } else if (op === 'text') {
      // SMELL DOM munging
      // SMELL split on spaces, first token only
      elt.querySelector('text').textContent = args[0];
    } else if (op === 'wait') {
      const duration = args[0];
      if (!duration.endsWith('s')) {
        console.warn('Unknown duration: "'+duration+'"');
        return;
      }
      const secondsToWait = duration.substring(0, duration.length-1);
      elt.timerId = self.timerId;
      send(self, 'waitFor:', secondsToWait, 'withPrefix:', args[1]);
    } else if (op === 'anim') {
      const [duration, beforeCmds, afterCmds] = args;
      // SMELL much duped from rest of method
      if (!duration.endsWith('s')) {
        console.warn('Unknown duration: "'+duration+'"');
        return;
      }
      const durationMs = (+duration.substring(0, duration.length-1))*1000;
      
      const cmdToKeyVal = cmd => {
        if (cmd[0] === 'stroke') return cmd;
        else if (cmd[0] === 'scale') {
          // Make sure transform-origin is set
          attr(elt, 'transform-origin', send(elt, 'center').join(' '));
          return ['transform', 'scale('+cmd[1]+')'];
        } // TODO rest
      };
      const before = Object.fromEntries(beforeCmds.map(cmdToKeyVal));
      const after  = Object.fromEntries( afterCmds.map(cmdToKeyVal));

      elt.activeAnim = elt.animate([before, after], {duration: durationMs, fill: 'forwards'});
      send(self, 'execute:', ['wait', duration, 'anim'], 'on:', elt); // End with a wait
    }
  },
  ['waitFor:withPrefix:']: (self, secondsToWait, prefix) => {
    if (!prefix) prefix = 'wait';
    const timerStr = prefix + ' ' + secondsToWait + 's '+self.timerId;
    if (!self.activeTimers.has(timerStr)) {
      const event = [prefix + ' ' + secondsToWait + 's', self.timerId];
      setTimeout(() => {
        send(self, 'doEvent:', event);
      }, secondsToWait*1000);
      log(...event);
      self.activeTimers.add(timerStr);
    }
  },
  ['waitComplete:']: (self, [event, timerId]) => {
    const timerStr = event + 's '+timerId;
    self.activeTimers.delete(timerStr);
  },
  ['beginSlideshow']: (self) => {
    self.timerId = 1;
    self.activeTimers = new Set();
    send(self, 'doEvent:', 'init');
    self.clickCount = 1;
    svg_parent.onclick = () => {
      const suffix = self.clickCount === 1 ? '' : ' ' + self.clickCount;
      send(self, 'doEvent:', 'click'+suffix);
      self.clickCount++;
    }
  }
};