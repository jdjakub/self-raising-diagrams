vtables.AnimationNotation = {
  _parent: vtables.NotationGrammar,

  // Root = BiGraph(Label,NameArrow,Any):names Named(SeqBox)*:seqs
  ['Root']: (self) => ({
    names: ⟦self BiGraphFrom: 'Label' via: 'NameArrow' to: 'Any'⟧,
    seqs:  ⟦self many: () => ⟦self NamedSeqBox⟧⟧,
  }),

  ['NamedSeqBox']: (self) => {
    const nb = ⟦self Named: 'SeqBox'⟧;
    const graph = ⟦self lend: self.vtable input: ⟦nb.inner interior⟧ rule: 'SeqGraph'⟧;
    return { name: nb.name, graph };
  },

  ['SeqGraph']: (self) => ⟦self GraphWithVertices: 'Text'
                                andEdges: (self) => ⟦self Named: 'SeqArrow'⟧⟧,

  ['seqColor']:     () => 'rgb(184, 10, 10)',
  ['namingColor']:  () => 'rgb(45, 184, 10)',

  ['SeqBoxSel']: () => 'rect.boundary-shape',
  ['SeqBox']: (self) => {
    const elt = self.cursor.dict;
    ⟦self pred: elt.matches(⟦self SeqBoxSel⟧)
                && getComputedStyle(elt).stroke === ⟦self seqColor⟧⟧;
    return elt;
  },

  ['SeqArrowSel']: () => 'g.connector-wrapper',
  ['SeqArrow']: (self) => {
    const elt = self.cursor.dict;
    const shaft = elt.querySelector('.connector-shaft');
    ⟦self pred: elt.matches(⟦self NameArrowSel⟧)
                && getComputedStyle(shaft).stroke === ⟦self seqColor⟧⟧;
    return elt;
  },

  ['NameArrowSel']:() => 'g.connector-wrapper',
  ['NameArrow']: (self) => {
    const elt = self.cursor.dict;
    const shaft = elt.querySelector('.connector-shaft');
    ⟦self pred: elt.matches(⟦self NameArrowSel⟧)
                && getComputedStyle(shaft).stroke === ⟦self namingColor⟧⟧;
    return elt;
  },
  
  ['TextSel']: () => 'g.text-wrapper',
  ['Text']: (self) => self.cursor.dict,

  ['LabelSel']: () => 'g.text-wrapper:not(.is-multiline)',
  ['Label']: (self) => self.cursor.dict,
};