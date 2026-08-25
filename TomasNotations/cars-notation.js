vtables.CarsNotation = {
  _parent: vtables.NotationGrammar,

  /*['fromRegion:']: needsSuper((supr, self, scope) => {
    
  }),*/

  // Root = Car* RoadPath* Arrow*
  ['Root']: (self) => ({
    cars:   send(self, 'many:', () => send(self, 'Car')),
    paths:  send(self, 'many:', () => send(self, 'RoadPath')),
    arrows: send(self, 'many:', () => send(self, 'applyClaiming:', 'Arrow')),
  }),

  // Car = CarBody near Wheel Wheel
  ['Car']: (self) => {
    const body = send(self, 'claimMatching:', 'CarBody');
    const wheels = send(self, 'claimAll:', 'Wheel', 'near:', body, 'within:', send(self, 'wheelEpsilon'));
    send(self, 'pred:', wheels.length === 2);
    return { body, wheels };
  },

  // RoadPath = Path:p Marker*:ms (each m on p)
  ['RoadPath']: (self) => {
    const p = send(self, 'claimMatching:', 'Road');
    const ms = send(self, 'claimAll:', 'Marker', 'near:', p, 'within:', send(self, 'onEpsilon'));
    return { path: p, markers: ms };
  },

  // ---- vocabulary (focus rules) ----
  ['CarBodySel']: () => 'polygon',
  ['CarBody']: (self) => {
    const e = self.cursor.dict;
    send(self, 'pred:', e.matches(send(self, 'CarBodySel')) && send(e, 'vertices').length === 9);
    return e;
  },

  ['WheelSel']: () => 'circle',
  ['Wheel']: (self) => {
    const e = self.cursor.dict;
    send(self, 'pred:', e.matches(send(self, 'WheelSel')));
    return e;
  },

  ['RoadSel']: () => 'path',
  ['Road']: (self) => {
    const e = self.cursor.dict;
    send(self, 'pred:', e.matches(send(self, 'RoadSel')) && getComputedStyle(e).strokeWidth === '1.33333px');
    return e;
  },

  ['MarkerSel']: () => 'polygon',
  ['Marker']: (self) => {
    const e = self.cursor.dict;
    send(self, 'pred:', e.matches(send(self, 'MarkerSel')) && send(e, 'vertices').length === 10);
    return e;
  },

  ['ArrowSel']: () => 'g.connector-wrapper',
  ['Arrow']: (self) => {
    const e = self.cursor.dict;
    send(self, 'pred:', e.matches(send(self, 'ArrowSel')));
    return e;
  },

  ['wheelEpsilon']: () => 10,
  ['onEpsilon']:    () => 2,
};