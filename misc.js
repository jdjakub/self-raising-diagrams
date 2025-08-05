// Mathcha SVG outputs simple shapes as paths and multiline text as separate text elements...
// Gotta recognise basic shapes. Computer Vector Vision

extractPathCmds = function(pathElt) {
    const d = pathElt.getAttribute('d')
    const clauses = d.split(' ').filter(c => c.length > 0);
    const cmds = clauses.map(c => [c[0], c.substr(1).split(',').map(s => Number.parseFloat(s))]);
    const opcodes = cmds.map(c => c[0]).join('');
    const xs = cmds.map(c => c[1][0]);
    const ys = cmds.map(c => c[1][1]);
    return [opcodes,xs,ys];
}

/*
<path class="real" d=" Mlx,ty Lrx,ty Lrx,by Llx,by Z" />
---
<rect x="lx" y="ty"
  width="rx-lx" height="by-ty" />
*/
extractRect = function(rectPathElt) {
    const [opcodes,xs,ys] = extractPathCmds(rectPathElt);
    if (opcodes !== 'MLLLZ') return;
    if (xs[0] !== xs[3]) return;
    if (ys[0] !== ys[1]) return;
    if (xs[1] !== xs[2]) return;
    if (ys[2] !== ys[3]) return;
    
    const [lx,ty,rx,by] = [xs[0],ys[0],xs[1],ys[2]];
    return [lx,ty,rx-lx,by-ty];
}

/*
<g class="arrow-line">
  <path class="real" d=" Mxo,yo Lxt,yt" />
</g>
---
arrow's origin is [xo,yo]
arrow's target is [xt,yt]
*/
extractArrow = function(arrowGroupElt) {
    const shaftPathElt = arrowGroupElt.querySelector('path.real');
    const [opcodes,xs,ys] = extractPathCmds(shaftPathElt);
    if (opcodes !== 'ML') return;
    const [xo,yo,xt,yt] = [xs[0],ys[0],xs[1],ys[1]];
    return {origin: [xo,yo], target: [xt,yt]};
}
