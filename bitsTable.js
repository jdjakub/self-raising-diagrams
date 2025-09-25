isNearZero = function(x) {
  return Math.abs(x) < 0.0001;
}

// .arrow-line gets id, .is-line, .is-hor/.is-vertical, originPt, targetPt,
// CONFLICTS with arrow stuff; TODO fix
pass.idLines = function() {
  log('Identifying lines.');
  const lines = all('.arrow-line');
  lines.forEach((l,i) => {
    l.id = 'l'+(i+1);
    l.classList.add('is-line');
    const {originPt, targetPt} = extractArrow(l);
    const from_origin = vsub(targetPt, originPt);
    if      (isNearZero(from_origin[0])) l.classList.add('is-vertical');
    else if (isNearZero(from_origin[1])) l.classList.add('is-horizontal');
    l.dataset.originPt = vtoa(originPt);
    l.dataset.targetPt = vtoa(targetPt);
  });
}
  
// DOM -> JS
getLine = function(domElement) {
  const l = domElement;
  let l_js = l.jsdata;
  if (l_js === undefined) l.jsdata = l_js = { dom: l };
  // Set by idLines
  l_js.originPt = atov(l.dataset.originPt);
  l_js.targetPt = atov(l.dataset.targetPt);
  if (l.classList.contains('is-vertical')) l_js.type = 'vertical';
  else if (l.classList.contains('is-horizontal')) l_js.type = 'horizontal';
  return l_js;
}

getLines = () => all('.is-line').map(getLine);

lineInsideRect = function(l, rect) {
  return containsPt(rect, l.originPt) && containsPt(rect, l.targetPt);
}

// Requires: idLines, normalizeRects
pass.annotateLineContainments = function() {
  log('Annotating line containment relationships.');
  const rects = getRects();
  const lines = getLines();
  const perItem = l => {
    const containers = rects.filter(r => lineInsideRect(l, r));
    containers.forEach(r => {
      // WARNING: assumes single level of hierarchy. Will overwrite mult containments
      l.dom.dataset.containedIn = r.dom.id;
    });
  }
  lines.forEach(perItem);
}

// Requires: annotateLineContainments
pass.makeTableRows = function() {
  log('Creating table rows.');
  let horLines = getLines().filter(l => l.type === 'horizontal');
  const rect = getRect(byId(horLines[0].dom.dataset.containedIn));
  horLines.push({originPt: rect.topLeft, targetPt: rect.topRight}); // dummy
  horLines.push({originPt: rect.botLeft, targetPt: rect.botRight}); // dummy
  const ys = horLines.map(l => ({line: l, key: l.originPt[1]}));
  ys.sort((y1, y2) => y1.key - y2.key);
  horLines = ys.map(y => y.line);

  let prevRow = null;
  horLines.forEach(({originPt,targetPt}, i) => {
    const topLeft = originPt[0] < targetPt[0] ? originPt : targetPt;
    let row = null;
    if (i !== horLines.length - 1) { // Create row rect below line
      const width = Math.abs(targetPt[0] - originPt[0]);
      const mathchaWrapper = svgel('g');
      row = svgel('rect', {x: topLeft[0], y: topLeft[1], width, height: 0}, mathchaWrapper);
      row.id = 'row'+(i+1); row.classList.add('is-rect'); // SMELL normalizeRects
      row.classList.add('is-row');
    }
    if (prevRow) {
      const prevHeight = topLeft[1] - (+attr(prevRow, 'y'));
      attr(prevRow, 'height', prevHeight);
    }
    prevRow = row;
  });
}

// Requires: makeTableRows
pass.makeTableCols = function() {
  log('Creating table columns / cells.')
  let verLines = getLines().filter(l => l.type === 'vertical');
  const rect = getRect(byId(verLines[0].dom.dataset.containedIn));
  verLines.push({originPt: rect.topLeft, targetPt: rect.botLeft}); // dummy
  verLines.push({originPt: rect.topRight, targetPt: rect.botRight}); // dummy
  const xs = verLines.map(l => ({line: l, key: l.originPt[0]}));
  xs.sort((x1, x2) => x1.key - x2.key);
  verLines = xs.map(x => x.line);

  const rows = all('.is-row').map(getRect);
  rows.forEach(row => {
    let prevCol_x = null;
    verLines.forEach(({originPt,targetPt}, i) => {
      const [topRight, botRight] = originPt[1] < targetPt[1] ? [originPt,targetPt] : [targetPt,originPt];
      const cut_x = originPt[0]; // === targetPt[0]
      if (i === 0) prevCol_x = cut_x;
      else {
        const cut_y1 = topRight[1];
        const cut_y2 = botRight[1];
        const row_y1 = row.topRight[1];
        const row_y2 = row.botRight[1];
        const k = CONTAINS_PT_EPSILON;
        const cutsThisRow = cut_y1 - k < row_y1 && row_y2 < cut_y2 + k;
        if (cutsThisRow) {
          const mathchaWrapper = svgel('g');
          // Make cell slightly smaller than the row, so that if it is the only cell, it doesn't
          // have exactly the same rect as the row, causing cyclic containment shenanigans...
          const cell = svgel('rect',
            {x: prevCol_x+1, y: row_y1+1, width: cut_x - prevCol_x -1, height: row.extent[1] -1},
          mathchaWrapper);
          cell.id = row.dom.id + '-col' + i;
          cell.classList.add('is-cell');
          prevCol_x = cut_x;
        }
      }
    });
  });
}

pass.splitHeaderText = function() {

}

function doAll() {
  pass.idLines();
  pass.normalizeRects();
  pass.annotateLineContainments();
  pass.makeTableRows();
  pass.makeTableCols();
  pass.idLabels();
  pass.annotateParagraphs();
  pass.annotateAllContainments();
}