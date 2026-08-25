vtables.CarsNotation = {
  _parent: vtables.NotationGrammar,

  /*['fromRegion:']: needsSuper((supr, self, scope) => {
    
  }),*/

  // Root = Car* RoadPath* Arrow*
  ['Root']: (self) => ({
    cars:   ⟦self many: () => ⟦self Car⟧⟧,
    paths:  ⟦self many: () => ⟦self RoadPath⟧⟧,
    arrows: ⟦self many: () => ⟦self applyClaiming: 'Arrow'⟧⟧,
  }),

  // Car = CarBody near Wheel Wheel
  ['Car']: (self) => {
    const body = ⟦self claimMatching: 'CarBody'⟧;
    const wheels = ⟦self claimAll: 'Wheel' near: body within: ⟦self wheelEpsilon⟧⟧;
    ⟦self pred: wheels.length === 2⟧;
    return { body, wheels };
  },

  // RoadPath = Path:p Marker*:ms (each m on p)
  ['RoadPath']: (self) => {
    const p = ⟦self claimMatching: 'Road'⟧;
    const ms = ⟦self claimAll: 'Marker' near: p within: ⟦self onEpsilon⟧⟧;
    return { path: p, markers: ms };
  },

  // ---- vocabulary (focus rules) ----
  ['CarBodySel']: () => 'polygon',
  ['CarBody']: (self) => {
    const e = self.cursor.dict;
    ⟦self pred: e.matches(⟦self CarBodySel⟧) && ⟦e vertices⟧.length === 9⟧;
    return e;
  },

  ['WheelSel']: () => 'circle',
  ['Wheel']: (self) => {
    const e = self.cursor.dict;
    ⟦self pred: e.matches(⟦self WheelSel⟧)⟧;
    return e;
  },

  ['RoadSel']: () => 'path',
  ['Road']: (self) => {
    const e = self.cursor.dict;
    ⟦self pred: e.matches(⟦self RoadSel⟧)
                && getComputedStyle(e).strokeWidth === '1.33333px'⟧;
    return e;
  },

  ['MarkerSel']: () => 'polygon',
  ['Marker']: (self) => {
    const e = self.cursor.dict;
    ⟦self pred: e.matches(⟦self MarkerSel⟧) && ⟦e vertices⟧.length === 10⟧;
    return e;
  },

  ['ArrowSel']: () => 'g.connector-wrapper',
  ['Arrow']: (self) => {
    const e = self.cursor.dict;
    ⟦self pred: e.matches(⟦self ArrowSel⟧)⟧;
    return e;
  },

  ['wheelEpsilon']: () => 10,
  ['onEpsilon']:    () => 2,
};