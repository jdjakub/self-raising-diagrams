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
          // It's essential that we keep the widths the same, else assignBitRanges will break...
          const cell = svgel('rect',
            {x: prevCol_x, y: row_y1+1, width: cut_x - prevCol_x, height: row.extent[1] -1},
          mathchaWrapper);
          cell.id = row.dom.id + '-col' + i;
          cell.classList.add('is-cell');
          prevCol_x = cut_x;
        }
      }
    });
  });
}

isHeaderSpec = function({string}) {
  const nums = string.trim().split(' ')
    .filter(s => s.length > 0).map(x => Number.parseInt(x, 10));
  return nums.every(x => !Number.isNaN(x));
}

getBitRange = function(str) {
  const nums = str.trim().split(' ')
    .filter(s => s.length > 0).map(x => Number.parseInt(x, 10));
  return [nums[0], last(nums)+1];
}

leftToRight = (a, b) => a.getBBox().x - b.getBBox().x;

// Requires: makeTableCols
pass.readHeaderText = function() {
  log('Reading header bit specification.')
  const rows = all('.is-row');
  const headerPara = getParagraphs().filter(isHeaderSpec)[0]; // fragile
  const headerRow = headerPara.dom.parentElement;
  headerRow.classList.add('is-header');
  const headerText = headerPara.dom.querySelector('text');

  // SMELL: duped
  let verLines = getLines().filter(l => l.type === 'vertical');
  const rect = getRect(byId(verLines[0].dom.dataset.containedIn));
  const xs = verLines.map(l => ({line: l, key: l.originPt[0]}));
  xs.sort((x1, x2) => x1.key - x2.key);
  verLines = xs.map(x => x.line);

  const headerCells = Array.from(headerRow.querySelectorAll('.is-cell'));
  headerCells.sort(leftToRight);
  let textCut_x = headerPara.dom.getBBox().x;
  let textCutStart_i = 0;
  const textLen = headerText.textContent.length;
  headerCells.forEach(c => {
    const r = getRect(c);
    const target_x = r.topRight[0];
    let textCut_i = textCutStart_i;
    while (textCut_x < target_x && textCut_i < textLen) {
      textCut_x += headerText.getExtentOfChar(textCut_i).width;
      textCut_i++;
    }
    const substring = headerText.textContent.substring(textCutStart_i, textCut_i);
    c.dataset.bitRange = vtoa(getBitRange(substring));
    textCutStart_i = textCut_i;
  });
}

// Requires: readHeaderText
pass.assignBitRanges = function() {
  log('Assigning bit ranges.');
  const headerCells = all('.is-header .is-cell');
  headerCells.sort(leftToRight);

  const rows = all('.is-row').filter(r => !r.parentElement.classList.contains('is-header'));
  rows.forEach(row => {
    const cells = Array.from(row.parentElement.querySelectorAll('.is-cell'));
    cells.sort(leftToRight);
    let headerStart_i = 0;
    cells.forEach(cell => {
      const myWidth = cell.getBBox().width;
      let headerEnd_i = headerStart_i;
      let totalWidth = 0;
      // -3 tolerance for misaligned ver lines; TODO pass.alignColLines()
      while (totalWidth < myWidth - 3) {
        totalWidth += headerCells[headerEnd_i].getBBox().width;
        headerEnd_i++;
      }
      const headerStartCell = headerCells[headerStart_i];
      const [startBit] = atov(headerStartCell.dataset.bitRange);
      let endBit = null;
      if (headerEnd_i < headerCells.length) {
        const headerEndCell = headerCells[headerEnd_i];
        [endBit] = atov(headerEndCell.dataset.bitRange);
      } else {
        [_,endBit] = atov(last(headerCells).dataset.bitRange);
      }
      cell.dataset.bitRange = vtoa([startBit,endBit]);
      headerStart_i = headerEnd_i;
    });
  });
}

// Requires: assignBitRanges
pass.generateStructData = function() {
  const data = [];
  const rows = all('.is-row').filter(r => !r.parentElement.classList.contains('is-header'));
  rows.forEach(row => {
    const cells = Array.from(row.parentElement.querySelectorAll('.is-cell'));
    cells.sort(leftToRight);
    cells.forEach(cell => {
      const t = cell.parentElement.querySelector('text');
      const [startBit,endBit] = atov(cell.dataset.bitRange);
      data.push([t.textContent, endBit-startBit]);
    });
  });
  return data;
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
  pass.treeifyContainments();
  pass.makeDOMReflectContainmentTree();
  pass.readHeaderText();
  pass.assignBitRanges();
  structData = pass.generateStructData();
  return structData;
}