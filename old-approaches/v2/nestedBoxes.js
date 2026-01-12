doAll = function() {
  pass.idLabels();
  pass.normalizeRects();
  pass.annotateAllContainments();
  pass.treeifyContainments();
  showContainmentTree(byId('r1'));
  pass.makeDOMReflectContainmentTree();
}