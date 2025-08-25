// Requires: annotateArrowConnections
pass.generateJS = function() {
  log('Generating JS.');
  const arrows = getArrows();
  const js_lines = arrows.map(a => {
    const origin_name = a.originLabel.dom.textContent;
    const target_name = a.targetLabel.dom.textContent;
    return `arrow('${origin_name}', '${target_name}');`;
  });
  generated_js = js_lines.join('\n');
}

passReqs = {};

(function() {
  const arrow = function(origin, target) {
    let reqs = passReqs[origin];
    if (reqs === undefined) passReqs[origin] = reqs = [];
    reqs.push(target);
  }
  // Generated from labelGraph-deps.svg
  arrow('annotateContainments', 'idLabels');
  arrow('annotateContainments', 'idArrows');
  arrow('restoreComments', 'generateJS');
  arrow('generateJS', 'annotateArrowConnections');
  arrow('checkFormat', 'annotateContainments');
  arrow('annotateArrowConnections', 'hideComments');
  arrow('hideComments', 'annotateComments');
  arrow('annotateComments', 'annotateContainments');
  arrow('annotateContainments', 'normalizeRects');
  arrow('annotateParagraphs', 'idLabels');
  arrow('hideComments', 'checkFormat');
  arrow('checkFormat', 'annotateParagraphs');
})()

donePasses = new Set();

nextReq = (root) => {
  if (donePasses.has(root)) return null;
  const reqs = passReqs[root];
  if (!reqs) return root;
  for (let req of reqs) {
    if (!donePasses.has(req)) return nextReq(req);
  }
  return root;
}

nextPass = () => {
  const next = nextReq('restoreComments');
  if (next) {
    pass[next]();
    donePasses.add(next);
    return true;
  }
  return false;
};

doAll = function() {
  while (nextPass());
  testIt();
  return generated_js;
}

const CORRECT_OUTPUT = {
  boxGraph:
`arrow('annotateContainments', 'normalizeRects');
arrow('annotateContainments', 'idLabels');
arrow('annotateArrowConnections', 'normalizeRects');
arrow('annotateArrowConnections', 'idArrows');
arrow('generateJSOG', 'nameBoxesIfApplicable');
arrow('nameBoxesIfApplicable', 'labelArrows');
arrow('nameBoxesIfApplicable', 'normalizeRects');
arrow('labelArrows', 'idArrows');
arrow('generateJSOG', 'annotateArrowConnections');
arrow('labelArrows', 'idLabels');
arrow('nameBoxesIfApplicable', 'annotateContainments');`,
  labelGraph:
`arrow('annotateContainments', 'idLabels');
arrow('annotateContainments', 'idArrows');
arrow('restoreComments', 'generateJS');
arrow('generateJS', 'annotateArrowConnections');
arrow('checkFormat', 'annotateContainments');
arrow('annotateArrowConnections', 'hideComments');
arrow('hideComments', 'annotateComments');
arrow('annotateComments', 'annotateContainments');
arrow('annotateContainments', 'normalizeRects');
arrow('annotateParagraphs', 'idLabels');
arrow('hideComments', 'checkFormat');
arrow('checkFormat', 'annotateParagraphs');`
};

function testIt() {
  const info = getMetaInfo();
  const str = generated_js;
  if (info.test && str !== CORRECT_OUTPUT[info.test]) throw str;
  log('Great Success!');
}

function oldDoAll() {
  // --- Likely common to all formats ---
  pass.idArrows();
  pass.idLabels();
  pass.annotateParagraphs();
  pass.normalizeRects();
  pass.annotateContainments();
  pass.checkFormat();
  pass.annotateComments();
  pass.hideComments();
    // --- Format-specific ---
  pass.annotateArrowConnections();
  pass.generateJS();
  pass.restoreComments();
  const info = getMetaInfo();
  const str = generated_js;
  if (info.test && str !== CORRECT_OUTPUT[info.test]) throw str;
  log(str);
}