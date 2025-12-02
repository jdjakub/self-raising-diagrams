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

class BackedRadiusPoint extends BackedPoint {
  applyDelta([dx,dy]) {
    this.value[0] += dx;
    this.backer.notifyChanged(this);
  }
}

class Circle {
  constructor(circleElt) {
    this.domElt = circleElt;
    const center = attrs(circleElt, 'cx', 'cy').map(x=>+x);
    this.center = new BackedPoint(this, center);
    const radius = +attr(circleElt, 'r');
    this.radius = new BackedRadiusPoint(this, [radius,0]);
  }

  exposeCenter() {
    return this.center;
  }

  exposeRadius() {
    return this.radius;
  }

  notifyChanged(what) {
    const v = what.value;
    if (what === this.center) {
      attr(this.domElt, {cx: v[0], cy: v[1]});
    } else if (what === this.radius) {
      attr(this.domElt, 'r', v[0]);
    }
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
  }

  exposePoint(n) {
    return this.cmpts[n-1][1];
  }

  notifyChanged() {
    const new_d = this.cmpts.map(c => c[0]+c[1].toString()).join(' ');
    attr(this.domElt, 'd', new_d);
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
  constructor(xLinks, yLinks) {
    this.xLinks = xLinks; this.yLinks = yLinks;
  }

  applyDelta([dx,dy]) {
    this.xLinks.forEach(l=>l.applyDelta(dx));
    this.yLinks.forEach(l=>l.applyDelta(dy));
  }
}

class Rect {
  constructor(rectElt) {
    this.domElt = rectElt;

    const pos = k => new AttrDeltaForwarder(this.domElt, k);
    const neg = k => new AttrDeltaForwarder(this.domElt, k, x=>-x);

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
      [ pos('x'), neg('width') ], [ pos('y'), neg('height') ]
    );
    this.points.topR = new DeltaForwarderPoint(
      [ pos('width') ], [ pos('y'), neg('height') ]
    );
    this.points.botL = new DeltaForwarderPoint(
      [ pos('x'), neg('width') ], [ pos('height') ]
    );
    this.points.botR = new DeltaForwarderPoint(
      [ pos('width') ], [ pos('height') ]
    );
    // Move entire rectangle
    this.points.center = new DeltaForwarderPoint(
      [ pos('x') ], [ pos('y') ]
    );
    // Resize from top = topL ∩ topR
    this.points.top = new DeltaForwarderPoint(
      [], [ pos('y'), neg('height') ]
    )
    // Rezise from left = topL ∩ botL
    this.points.left = new DeltaForwarderPoint(
      [ pos('x'), neg('width') ], []
    )
    // Resize from right = topR ∩ botR
    this.points.right = new DeltaForwarderPoint(
      [ pos('width') ], []
    )
    // Resize from bottom = botL ∩ botR
    this.points.bottom = new DeltaForwarderPoint(
      [], [ pos('height') ]
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
    let delta = vsub(currPos,lastPos);
    for (const l of mouseDeltaFwdLinks) l.applyDelta(delta);
    lastPos = currPos;
  }
}