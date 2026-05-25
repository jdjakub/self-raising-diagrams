// Descartes - a mathematical-notation preprocessor for JS.
//
// Compiles infix arithmetic to runtime-polymorphic function calls:
//   +   -> add        -  -> sub (binary) / neg (unary)
//   *   -> mul        /  -> div
//   ·   -> dot        ∧  -> wedge
//   |x| -> mag      juxtaposition (x y) -> mul
//   ∑   -> sum             x²,x³,…,x⁻²  -> pow
//
// JS pass-through for identifiers, numeric literals, function calls,
// member access (a.b), and array indexing (a[i]).
//
// Whitespace rule: `f(x)` (no space) is a function call, `f (x)` (space) is
// juxtaposition multiplication. Same rule for member access and indexing —
// `a.b` is member access, `a .b` is a parse error (`.b` isn't an atom).
//
// Unary minus binds tighter than juxtaposition: `-k pos` => `mul(neg(k), pos)`.
// Magnitude bars don't nest at the same level (use parens or different
// scope), but nesting via deeper subexpressions works via recursive descent.

SUP_MAP = {
  '⁰':'0','¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9','⁻':'-'
};
SUP_CHARS = Object.keys(SUP_MAP).join('');

sup_to_num = text => text.split('').map(c => SUP_MAP[c] || c).join('');

tokenize_descartes = function(src) {
  const tokens = [];
  let i = 0, hadWs = false;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { hadWs = true; i++; continue; }
    if (/\d/.test(c)) {
      let j = i;
      while (j < src.length && /[\d.]/.test(src[j])) j++;
      tokens.push({ kind: 'NUM', text: src.substring(i, j), ws: hadWs });
      hadWs = false; i = j; continue;
    }
    if (/[a-zA-Z_$]/.test(c)) {
      let j = i;
      while (j < src.length && /[a-zA-Z_$0-9]/.test(src[j])) j++;
      tokens.push({ kind: 'IDENT', text: src.substring(i, j), ws: hadWs });
      hadWs = false; i = j; continue;
    }
    if (SUP_CHARS.includes(c)) {
      let j = i;
      while (j < src.length && SUP_CHARS.includes(src[j])) j++;
      tokens.push({ kind: 'SUP', text: src.substring(i, j), ws: hadWs });
      hadWs = false; i = j; continue;
    }
    const charKind = {
      '+': 'PLUS', '-': 'MINUS', '*': 'STAR', '/': 'SLASH', '·': 'CDOT',
      '(': 'LPAREN', ')': 'RPAREN', '[': 'LBRACK', ']': 'RBRACK',
      '.': 'PERIOD', ',': 'COMMA', '|': 'BAR', '∑': 'SUM', '∧': 'WEDGE',
    }[c];
    if (!charKind) throw 'Unrecognized char "' + c + '" at position ' + i;
    tokens.push({ kind: charKind, text: c, ws: hadWs });
    hadWs = false; i++;
  }
  return tokens;
};

parse_descartes = function(tokens) {
  let pos = 0, inBar = 0;
  const at = (n=0) => pos+n < tokens.length ? tokens[pos+n] : null;
  const peek = () => at(0)?.kind ?? null;
  const consume = () => tokens[pos++];
  const expect = (k) => {
    const t = consume();
    if (!t || t.kind !== k) throw 'Expected ' + k + ', got ' + (t?.kind ?? 'EOF') + ' at token ' + (pos-1);
    return t;
  };

  // Atom-starters for juxtaposition; MINUS deliberately omitted (it's binary subtraction at this level).
  const ATOM_STARTERS = ['NUM', 'IDENT', 'LPAREN', 'BAR', 'SUM', 'HOLE', 'LBRACK'];
  const canStartAtom = k => ATOM_STARTERS.includes(k);

  const parseExpr = () => parseAdditive();

  const parseAdditive = () => {
    let left = parseMul();
    while (peek() === 'PLUS' || peek() === 'MINUS') {
      const op = consume().kind === 'PLUS' ? 'add' : 'sub';
      const right = parseMul();
      left = { kind: 'binop', op, left, right };
    }
    return left;
  };

  const parseMul = () => {
    let left = parseJuxt();
    while (peek() === 'STAR' || peek() === 'SLASH') {
      const k = consume().kind;
      const op = k === 'STAR' ? 'mul' : k === 'SLASH' ? 'div' : 'dot';
      const right = parseJuxt();
      left = { kind: 'binop', op, left, right };
    }
    return left;
  };

  const parseJuxt = () => {
    let left = parseDotWedge();
    while (canStartAtom(peek()) && !(peek() === 'BAR' && inBar > 0)) {
      const right = parseDotWedge();
      left = { kind: 'binop', op: 'mul', left, right };
    }
    return left;
  };

  const parseDotWedge = () => {
    let left = parseUnary();
    while (peek() === 'CDOT' || peek() === 'WEDGE') {
      const op = consume().kind === 'CDOT' ? 'dot' : 'wedge';
      const right = parseUnary();
      left = { kind: 'binop', op, left, right };
    }
    return left;
  };

  const parseUnary = () => {
    if (peek() === 'SUM') {
      consume();
      return { kind: 'unary', op: 'sum', operand: parseUnary() };
    }
    if (peek() === 'MINUS') {
      consume();
      return { kind: 'unary', op: 'neg', operand: parseUnary() };
    }
    return parsePower();
  };

  const parsePower = () => {
    const base = parsePostfix();
    if (peek() === 'SUP') {
      const supTok = consume();
      return { kind: 'pow', base, exp: sup_to_num(supTok.text) };
    }
    return base;
  };

  const parsePostfix = () => {
    let x = parsePrimary();
    while (true) {
      const t = at(0);
      if (!t || t.ws) break;  // whitespace before postfix terminates the chain
      if (t.kind === 'PERIOD') {
        consume();
        const m = expect('IDENT');
        x = { kind: 'member', obj: x, name: m.text };
      } else if (t.kind === 'LPAREN') {
        consume();
        const args = parseArgs();
        expect('RPAREN');
        x = { kind: 'call', callee: x, args };
      } else if (t.kind === 'LBRACK') {
        consume();
        const idx = parseExpr();
        expect('RBRACK');
        x = { kind: 'index', obj: x, idx };
      } else break;
    }
    return x;
  };

  const parsePrimary = () => {
    const k = peek();
    if (k === 'NUM') return { kind: 'num', text: consume().text };
    if (k === 'IDENT') return { kind: 'ident', text: consume().text };
    if (k === 'LPAREN') {
      consume();
      const e = parseExpr();
      expect('RPAREN');
      return e;
    }
    if (k === 'BAR') {
      consume();
      inBar++;
      const e = parseExpr();
      inBar--;
      expect('BAR');
      return { kind: 'mag', expr: e };
    }
    if (k === 'LBRACK') {
      consume();
      const elements = [];
      if (peek() !== 'RBRACK') {
        elements.push(parseExpr());
        while (peek() === 'COMMA') { consume(); elements.push(parseExpr()); }
      }
      expect('RBRACK');
      return { kind: 'array', elements };
    }
    if (k === 'HOLE') return { kind: 'hole', code: consume().text };
    throw 'Expected primary, got ' + k + ' at token ' + pos;
  };

  const parseArgs = () => {
    if (peek() === 'RPAREN') return [];
    const args = [parseExpr()];
    while (peek() === 'COMMA') { consume(); args.push(parseExpr()); }
    return args;
  };

  const ast = parseExpr();
  if (pos < tokens.length) throw 'Unexpected token ' + peek() + ' at position ' + pos;
  return ast;
};

codegen_descartes = function(node) {
  const g = codegen_descartes;
  switch (node.kind) {
    case 'num':    return node.text;
    case 'ident':  return node.text;
    case 'mag':    return 'mag(' + g(node.expr) + ')';
    case 'binop':  return node.op + '(' + g(node.left) + ', ' + g(node.right) + ')';
    case 'unary':  return node.op + '(' + g(node.operand) + ')';
    case 'pow':    return 'pow(' + g(node.base) + ', ' + node.exp + ')';
    case 'member': return g(node.obj) + '.' + node.name;
    case 'index':  return g(node.obj) + '[' + g(node.idx) + ']';
    case 'array':  return '[' + node.elements.map(g).join(', ') + ']';
    case 'hole':   return node.code;
    case 'call':   return g(node.callee) + '(' + node.args.map(g).join(', ') + ')';
    default:       throw 'Unknown node kind: ' + node.kind;
  }
};

compile_descartes = src => codegen_descartes(parse_descartes(tokenize_descartes(src)));

// Holes-aware entry. Accepts an alternating list [frag, hole_js, frag, ...]
// (even indices are Descartes source fragments, odd are pre-compiled JS strings).
compile_descartes_with_holes = function(parts) {
  const tokens = [];
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) tokens.push(...tokenize_descartes(parts[i]));
    else             tokens.push({ kind: 'HOLE', text: parts[i], ws: false });
  }
  return codegen_descartes(parse_descartes(tokens));
};