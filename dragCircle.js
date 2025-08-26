
pass.executeCode = function() {
  log('Executing embedded JS.');
  const paragraphs = all('.is-multiline');
  const scripts = paragraphs.map(p => p.dataset.string);
  scripts.forEach(eval); // your line manager's eyes pop out of his head
}

svg = document.documentElement;

/*
dragging = null;
svg.onmousedown = e => {
  const t = e.target;
  if (t.tagName === 'circle') dragging = t;
}
svg.onmouseup = e => {
  dragging = null;
}
svg.onmousemove = e => {
  if (dragging) {
    attr(dragging, {cx: e.clientX, cy: e.clientY});
  }
}
*/

doAll = function() {
    pass.idLabels();
    pass.annotateParagraphs();
    pass.normalizeCircles();
    pass.executeCode();
}