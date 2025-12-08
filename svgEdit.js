class BackedPoint {
  constructor(backer, pt) {
    this.backer = backer;
    this.value = pt;
  }

  applyDelta([dx,dy]) {
    this.value[0] += dx; this.value[1] += dy;
    this.backer.notifyChanged(this);
  }

  toString() {
    return this.value[0] + ',' + this.value[1];
  }
}

class Circle {
  constructor(circleElt) {
    this.domElt = circleElt;
    const center = attrs(circleElt, 'cx', 'cy').map(x=>+x);
    this.center = new BackedPoint(this, center);
    const radius = +attr(circleElt, 'r');
    this.radius = new AttrDeltaForwarder(circleElt, 'r', (dv) => {
      // Begin with r2 = (p-c).(p-c) where p is lastPos, c is center
      // differentiate and simplify, assume dc = 0 (center not moving simultaneously)
      // you get dr = normed(p-c).dp
      // i.e: motion along the circle (dp perp to p-c) => radius stays the same
      // motion out (dp . (p-c) is positive) => radius increases
      // motion in (dp . (p-c)) is negative) => radius decreases
      // GRATIAS NEVVTONI!
      const center = this.center.value;
      const lastPos_from_center = vsub(lastPos, center); // HACK! accessing lastPos - delta violation
      const n = vnormed(lastPos_from_center);
      const dr = vdot(n,dv);
      return dr;
    });
  }

  exposeCenter() {
    return this.center;
  }

  exposeRadius() {
    return this.radius;
  }

  notifyChanged() {
    const v = this.center.value;
    attr(this.domElt, {cx: v[0], cy: v[1]});
  }
}

class Path {
  constructor(pathElt) {
    this.domElt = pathElt;
    let [opcodes,xs,ys] = extractPathCmds(pathElt);
    this.cmpts = [];
    for (let i=0; i<opcodes.length; i++) {
      const [op,x,y] = [opcodes.charAt(i),xs[i],ys[i]];
      this.cmpts.push([op, new BackedPoint(this, [x,y])]);
    }
    // Warning: won't receive updates to path element
    let arrowhead = pathElt.parentElement.querySelector('g');
     if (arrowhead) { // Assume it's the endpoint arrowhead
      this.arrowhead = arrowhead; // <g>
     }
  }

  exposePoint(n) {
    return this.cmpts[n-1][1];
  }

  notifyChanged(what) {
    const new_d = this.cmpts.map(c => c[0]+c[1].toString()).join(' ');
    attr(this.domElt, 'd', new_d);
    if (what === last(this.cmpts)[1]) {
      if (this.arrowhead) {
        const m = this.arrowhead.transform.baseVal[0].matrix;
        const v = what.value;
        m.e = v[0]; m.f = v[1];
        // New get the angle right
        const vPrev = last(this.cmpts,2)[1].value;
        const dv = vsub(v,vPrev);
        const n = vnormed(dv);
        // Empirically determined based on Mathcha's arrowhead coord sys
        m.a = -n[0]; m.c =  n[1];
        m.b = -n[1]; m.d = -n[0];
      }
    }
  }
}

class AttrDeltaForwarder {
  constructor(domElt, attrName, f) {
    this.domElt = domElt;
    this.attrName = attrName;
    this.transform = f? f : x=>x;
  }

  applyDelta(dx) {
    attr(this.domElt, this.attrName, x => (+x)+this.transform(dx));
  }
}

class DeltaForwarderPoint {
  constructor(xLinks, yLinks, pt) {
    this.xLinks = xLinks; this.yLinks = yLinks;
    this.value = pt;
  }

  applyDelta([dx,dy]) {
    this.value[0] += dx; this.value[1] += dy;
    this.xLinks.forEach(l=>l.applyDelta(dx));
    this.yLinks.forEach(l=>l.applyDelta(dy));
  }
}

class Rect {
  constructor(rectElt) {
    this.domElt = rectElt;

    const pos = k => new AttrDeltaForwarder(this.domElt, k);
    const neg = k => new AttrDeltaForwarder(this.domElt, k, x=>-x);

    let [x,y,w,h] = attrs(rectElt, 'x', 'y', 'width', 'height').map(x=>+x);

    this.points = {};
    // Pretty sure the JS here could be automatically generated
    // by differencing the following equations:
    // 
    // width = topR x - topL x = botR x - botL x
    // height = botR y - topR y = botL y - topL y
    // x = topL x = botL x
    // y = topL y = topR y

    // Resize from corners
    this.points.topL = new DeltaForwarderPoint(
      [ pos('x'), neg('width') ], [ pos('y'), neg('height') ], [x,y]
    );
    this.points.topR = new DeltaForwarderPoint(
      [ pos('width') ], [ pos('y'), neg('height') ], [x+w,y]
    );
    this.points.botL = new DeltaForwarderPoint(
      [ pos('x'), neg('width') ], [ pos('height') ], [x,y+h]
    );
    this.points.botR = new DeltaForwarderPoint(
      [ pos('width') ], [ pos('height') ], [x+w,y+h]
    );
    // Move entire rectangle
    this.points.center = new DeltaForwarderPoint(
      [ pos('x') ], [ pos('y') ], [x+w/2,y+h/2]
    );
    // Resize from top = topL ∩ topR
    this.points.top = new DeltaForwarderPoint(
      [], [ pos('y'), neg('height') ], [x+w/2,y]
    )
    // Rezise from left = topL ∩ botL
    this.points.left = new DeltaForwarderPoint(
      [ pos('x'), neg('width') ], [], [x,y+h/2]
    )
    // Resize from right = topR ∩ botR
    this.points.right = new DeltaForwarderPoint(
      [ pos('width') ], [], [x+w,y+h/2]
    )
    // Resize from bottom = botL ∩ botR
    this.points.bottom = new DeltaForwarderPoint(
      [], [ pos('height') ], [x+w/2,y+h]
    )
  }
}

controlShape = function(domElt) {
  switch (domElt.tagName) {
    case "circle": return new Circle(domElt);
    case "path": return new Path(domElt);
    case "rect": return new Rect(domElt);
  }
}

lastPos = null;
svg_parent.onmousedown = e => {
  lastPos = [e.offsetX,e.offsetY];
}
svg_parent.onmouseup = e => {
  lastPos = null;
}

mouseDeltaFwdLinks = [];
svg_parent.onmousemove = e => {
  let currPos = [e.offsetX,e.offsetY];
  if (lastPos) {
    let [dx,dy] = vsub(currPos,lastPos);
    for (const [[wx,wy],l] of mouseDeltaFwdLinks) l.applyDelta([wx*dx,wy*dy]);
    lastPos = currPos;
  }
}

fwdMouse = function(l,w) {
  if (w) mouseDeltaFwdLinks.push([w,l]);
  else mouseDeltaFwdLinks.push([[1,1],l]);
}

clearMouse = function() {
  mouseDeltaFwdLinks.splice(0, mouseDeltaFwdLinks.length);
}

// Towards rect point handles (flawed)
function init() {
  Object.entries(rect.points).forEach(([name,backedPt]) => {
    const [cx,cy] = backedPt.value;
    const handleElt = svgel('circle', {style: 'fill: green', cx, cy, r: 5 });
    backedPt.handle = controlShape(handleElt);
    handleElt.onmousedown = () => {
      fwdMouse(backedPt);
      fwdMouse(backedPt.handle.exposeCenter())
    };
    handleElt.onmouseup = () => {
      clearMouse();
    };
  });
}