
split_punctuation = function(frag) {
  const spans = [];
  let span_start = 0;
  let dot_index = -1;
  for (let i=0; i<frag.length; i++) {
    const c = frag.at(i);
    if (['(',')','.'].includes(c)) {
      spans.push(frag.substring(span_start,i));
      spans.push(c);
      span_start = i+1;
      if (c === '.' && dot_index === -1) dot_index = spans.length-1;
    }
  }
  spans.push(frag.substring(span_start));
  if (dot_index !== -1) { // Try and form siblings into a Number literal
    const parts = [];
    if (dot_index-1 >= 0) {
      parts.push(spans[dot_index-1]);
      parts.push(spans[dot_index]);
      if (dot_index+1 < spans.length) {
        parts.push(spans[dot_index+1]);
        const lit = parts.join('');
        if (/^-?\d+(\.\d+)?$/.test(lit))
          spans.splice(dot_index-1, 3, lit);
      }
    }
  }
  return spans;
}

/*
Returns list of strings that fall into the following (implicit) classes:
HASH = "#"
ASSIGN = ":="
STRING_LIT eg "'ST[JS]'" "'Hello World Forever'" (notice includes closing/ending quotes)
KW eg "doSomethingWith:" "and:" (notice includes ending colon)
IDENT eg "foo" "endpoints" isDirected"
PAREN eg "(" ")"
NUM_LIT eg "-5.324"
PERIOD = "."
*/
tokenize_ST_frag = function(st_frag) {
  const quote_indexes = [];
  for (let i=0; i<st_frag.length; i++)
    if (st_frag.at(i) === "'") quote_indexes.push(i);
  if (quote_indexes.length % 2 === 1) throw 'Unmatched single quote';
  const quote_spans = [];
  for (let i=0; i<quote_indexes.length/2; i++)
    quote_spans.push([quote_indexes[2*i], quote_indexes[2*i+1]]);
  const spans = [];
  let last_i = -1;
  for (const [start,end] of quote_spans) {
    if (start > last_i+1) { // insert a non-quote span
      const span = [last_i+1, start-1];
      span.quoted = false;
      spans.push(span);
    }
    const span = [start,end];
    span.quoted = true;
    spans.push(span);
    last_i = end;
  }
  if (last_i+1 < st_frag.length) { // push last unquoted if applicable
    const span = [last_i+1, st_frag.length-1];
    span.quoted = false;
    spans.push(span);
  }
  const substrings = spans.map(span => {
    const [start,end] = span;
    const substring = new String(st_frag.substring(start,end+1));
    substring.quoted = span.quoted;
    return substring;
  });
  const tokenized = substrings.map(s => {
    if (s.quoted) return s.toString(); // unbox
    const de_puncted = s.replaceAll('\n',' ').split(/\s+/).map(split_punctuation);
    return de_puncted.flat();
  });
  return tokenized.flat().filter(s => s.length > 0);
}

// === Mostly Claude Opus 4.7 generated ===


classify_token = function(tok) {
  if (typeof tok !== 'string') {
    if (tok && tok.kind === 'hole') return 'HOLE';
    throw 'Unknown token: ' + JSON.stringify(tok);
  }
  if (tok === '#')  return 'HASH';
  if (tok === '(')  return 'PAREN_OPEN';
  if (tok === ')')  return 'PAREN_CLOSE';
  if (tok === '.')  return 'PERIOD';
  if (tok === ':=') return 'ASSIGN';
  const c0 = tok.at(0);
  if (c0 === "'") return 'STRING_LIT';
  if (c0 === '-' || (c0 >= '0' && c0 <= '9')) {
    if (/^-?\d+(\.\d+)?$/.test(tok)) return 'NUM_LIT';
    throw 'Malformed numeric token: ' + tok;
  }
  if (tok.at(-1) === ':') return 'KW';
  if (c0 >= 'A' && c0 <= 'Z') return 'IDENT_UPPER';
  if ((c0 >= 'a' && c0 <= 'z') || c0 === '_') return 'IDENT_LOWER';
  throw 'Unrecognized token: ' + tok;
}


// ST[JS] transpiler. Takes [st_frag1, js_hole1, st_frag2, js_hole2, ...]
// (alternating, starting with ST) and returns a string of JS.

function ST_with_holes_to_JS(st_with_holes /* = [ st_frag1, js_hole1, st_frag2, ... ] */) {
  // ---- Step 1: build a flat token stream of strings + hole objects ----
  const tokens = [];
  for (let i = 0; i < st_with_holes.length; i++) {
    if (i % 2 === 0) tokens.push(...tokenize_ST_frag(st_with_holes[i]));
    else             tokens.push({ kind: 'hole', code: st_with_holes[i] });
  }

  // ---- Step 2: recursive-descent parse ----
  let pos = 0;
  const kindAt  = (n=0) => pos+n >= tokens.length ? null : classify_token(tokens[pos+n]);
  const consume = () => tokens[pos++];
  const expect  = (k) => {
    if (kindAt() !== k) throw 'Expected ' + k + ', got ' + kindAt() + ' at token ' + pos;
    return consume();
  };

  const parsePrimary = () => {
    const k = kindAt();
    if (k === 'IDENT_UPPER') return { kind: 'vtable', name: consume() };
    if (k === 'HASH') {
      consume();
      const s = expect('STRING_LIT');
      return { kind: 'vtable', name: s.slice(1, -1) }; // strip quotes
    }
    if (k === 'PAREN_OPEN') {
      consume();
      const e = parseExpr();
      expect('PAREN_CLOSE');
      return e;
    }
    if (k === 'NUM_LIT' || k === 'STRING_LIT') return { kind: 'literal', code: consume() };
    if (k === 'HOLE')        return { kind: 'raw', code: consume().code };
    if (k === 'IDENT_LOWER') return { kind: 'var', name: consume() };
    throw 'Expected primary, got ' + k + ' at token ' + pos;
  };

  const parseUnaryChain = () => {
    let acc = parsePrimary();
    while (true) {
      const k = kindAt();
      if (k === 'IDENT_LOWER') acc = { kind: 'send', recv: acc, pairs: [{ k: consume() }] };
      else if (k === 'HOLE')   acc = { kind: 'cont', expr: acc, code: consume().code };
      else break;
    }
    return acc;
  };

  const parseExpr = () => {
    const recv = parseUnaryChain();
    if (kindAt() !== 'KW') return recv;
    const pairs = [];
    while (kindAt() === 'KW') {
      const k = consume();
      const a = parseUnaryChain();
      pairs.push({ k, a });
    }
    return { kind: 'send', recv, pairs };
  };

  const parseStmt = () => {
    // assignment: lowerId ':=' expr
    if (kindAt(0) === 'IDENT_LOWER' && kindAt(1) === 'ASSIGN') {
      const target = consume();
      consume(); // ASSIGN
      return { kind: 'assign', target, value: parseExpr() };
    }
    // raw statement: a HOLE that isn't extended by anything chainable
    if (kindAt(0) === 'HOLE') {
      const next = kindAt(1);
      if (next === null || next === 'PERIOD') return { kind: 'raw', code: consume().code };
    }
    return parseExpr();
  };

  const parseProgram = () => {
    if (kindAt() === null) return { kind: 'program', stmts: [] };
    const stmts = [parseStmt()];
    while (kindAt() === 'PERIOD') {
      consume();
      if (kindAt() === null) break; // trailing dot
      stmts.push(parseStmt());
    }
    if (kindAt() !== null) throw 'Expected end of input, got ' + kindAt() + ' at token ' + pos;
    return { kind: 'program', stmts };
  };

  // ---- Step 3: codegen ----
  return ST_AST_to_JS(parseProgram());
}

// Pure tree-walker so the AST is inspectable for debugging.
ST_AST_to_JS = function(node) {
  const gen = ST_AST_to_JS;
  switch (node.kind) {
    case 'program': return node.stmts.map(gen).join(';\n');
    case 'assign':  return node.target + ' = ' + gen(node.value);
    case 'raw':     return node.code;
    case 'send': {
      const parts = [gen(node.recv)];
      for (const p of node.pairs) {
        parts.push("'" + p.k + "'");
        if (p.a !== undefined) parts.push(gen(p.a));
      }
      return 'send(' + parts.join(', ') + ')';
    }
    case 'cont':    return gen(node.expr) + node.code;
    case 'vtable':  return "{vtable: '" + node.name + "'}";
    case 'literal': return node.code;
    case 'var':     return node.name;
    default:        throw 'Unknown AST kind: ' + node.kind;
  }
};

HOLE_DELIMS = ['{[',']}'];
carve_non_nested_holes = str => str.split(HOLE_DELIMS[0]).flatMap(s => s.split(HOLE_DELIMS[1]));

compile_non_nested_holes = str => ST_with_holes_to_JS(carve_non_nested_holes(str));