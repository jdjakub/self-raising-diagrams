/*
<path class="real"
d=" M_,cy
    C_,_ _,_ cx,ty
    ___"
style="stroke-width: 1px;
           stroke: #{MAGIC_CIRCLE_COLOR};
           fill: none;
           fill-opacity: 1;"/>
---
<circle class="real"
cx="#{cx}" cy="#{cy}" r="#{cy-ty}"
style="stroke-width: 1px;
           stroke: #141313;
           fill: none;
           fill-opacity: 1;"/>
*/
extractCircle = function(circPathElt) {
  const [opcodes,xs,ys] = extractPathCmds(circPathElt);
  if (opcodes !== 'MCCCCZ') return;
  const cy = ys[0];
  const cx = xs[1][2];
  const ty = ys[1][2];
  const r = cy-ty;
  return {cx, cy, r};
}

pass.normalizeCircles = function() {
  log('Normalizing circle <path>s to <circle>s.');
  const circs = all('path.real').filter(r => !r.classList.contains('connection'));
  circs.forEach((pathCirc,i) => {
    const params = extractCircle(pathCirc);
    if (!params) return;
    // Create a <circle> to replace the <path>
    const actualCirc = replaceTag(pathCirc, 'circle');
    attr(actualCirc, params);
    actualCirc.id = 'c'+(i+1); // ID each circle
    actualCirc.attributes.removeNamedItem('d'); // ... except the path geom
  });
}

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