vtables.AnimationNotation = {
  _parent: vtables.NotationGrammar,

  // Root = BiGraph(Label,NameArrow,Any):names Named(SeqBox)*:seqs
  ['Root']: (self) => ({
    names: send(self, 'BiGraphFrom:', 'Label', 'via:', 'NameArrow', 'to:', 'Any'),
    seqs:  send(self, 'many:', () => send(self, 'NamedSeqBox')),
  }),

  ['NamedSeqBox']: (self) => {
    const nb = send(self, 'Named:', 'SeqBox');
    const graph = send(self, 'lend:', self.vtable, 'input:', send(nb.inner, 'interior'), 'rule:', 'SeqGraph');
    return { name: nb.name, graph };
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

  ['LabelSel']: () => 'g.text-wrapper:not(.is-multiline)',
  ['Label']: (self) => self.cursor.dict,
};