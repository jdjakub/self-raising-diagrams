// Configurable-bracket hole-carving + recursive compile dispatcher.
//
// A host JS string may declare its sub-language regions via a comment directive:
//   //! {[ SweetTalk ]} {< Descartes >}
// meaning: regions delimited by `{[ ... ]}` are SweetTalk, regions delimited by
// `{< ... >}` are Descartes. Top-level (outside any registered brackets) is JS.
//
// Nesting rule: a nested open-bracket of the *same kind* as the immediately
// enclosing region flips back to that region's container language. Different
// brackets nest independently. Bracket pairs are strictly matched (each open
// pairs with the next close of the same kind; mismatches are errors).
//
// Compile rule: each registered language has a compiler taking an alternating
// list [frag, child_compiled, frag, child_compiled, ...] (even indices are
// language-source fragments, odd indices are pre-compiled JS strings from
// sub-regions). The JS root is treated specially: it just concatenates.

parse_bracket_hole_spec = function(line) {
  // Strip leading whitespace + "//!"
  const m = line.match(/^\s*\/\/!\s*(.*)$/);
  if (!m) return null;
  const tokens = m[1].split(/\s+/).filter(t => t.length > 0);
  if (tokens.length % 3 !== 0) throw 'Bracket directive needs triples of <open> <lang> <close>';
  const spec = [];
  for (let i = 0; i < tokens.length; i += 3) {
    spec.push({ open: tokens[i], lang: tokens[i+1], close: tokens[i+2] });
  }
  // Refuse delimiter-substring collisions
  const delims = spec.flatMap(s => [s.open, s.close]);
  for (let i = 0; i < delims.length; i++) {
    for (let j = 0; j < delims.length; j++) {
      if (i !== j && delims[j].includes(delims[i])) {
        throw 'Delimiter "' + delims[i] + '" is a substring of "' + delims[j] +
              '" — choose different delimiters';
      }
    }
  }
  return spec;
};

carve_holes_via_brackets = function(src, spec) {
  // Returns a tree node: { lang, bracket?, parts: [string | childNode] }
  const root = { lang: 'JS', parts: [] };
  const stack = [root];
  let buf = '';
  let i = 0;

  const flush = () => {
    if (buf) { stack[stack.length-1].parts.push(buf); buf = ''; }
  };

  const matchAt = (p) => {
    for (const s of spec) {
      if (src.startsWith(s.open, p))  return { type: 'open',  spec: s };
      if (src.startsWith(s.close, p)) return { type: 'close', spec: s };
    }
    return null;
  };

  while (i < src.length) {
    const m = matchAt(i);
    if (m && m.type === 'open') {
      flush();
      const top = stack[stack.length-1];
      // Flip rule: same language as immediate container → pop one slot for the language
      const lang = (top.lang === m.spec.lang)
        ? (stack.length >= 2 ? stack[stack.length-2].lang : 'JS')
        : m.spec.lang;
      const child = { lang, bracket: m.spec, parts: [] };
      top.parts.push(child);
      stack.push(child);
      i += m.spec.open.length;
    } else if (m && m.type === 'close') {
      flush();
      const top = stack[stack.length-1];
      if (top === root) throw 'Unmatched close "' + m.spec.close + '" at position ' + i;
      if (top.bracket !== m.spec) {
        throw 'Mismatched close "' + m.spec.close + '" at position ' + i +
              '; expected "' + top.bracket.close + '"';
      }
      stack.pop();
      i += m.spec.close.length;
    } else {
      buf += src[i++];
    }
  }
  flush();
  if (stack.length !== 1) throw 'Unclosed bracket(s) at end of input';
  return root;
};

// Tree-walker. JS regions concatenate everything; sub-language regions get
// passed an alternating [frag, compiled_child, frag, ...] list.
compile_carved_tree = function(node, compilers) {
  if (node.lang === 'JS') {
    return node.parts.map(p =>
      typeof p === 'string' ? p : compile_carved_tree(p, compilers)
    ).join('');
  }
  // Build alternating list, inserting '' fillers to maintain the invariant
  const list = [];
  let expectStr = true;
  for (const part of node.parts) {
    const isStr = typeof part === 'string';
    if (isStr !== expectStr) list.push('');
    list.push(isStr ? part : compile_carved_tree(part, compilers));
    expectStr = !isStr;
  }
  const compiler = compilers[node.lang];
  if (!compiler) throw 'No compiler registered for language "' + node.lang + '"';
  return compiler(list);
};

// Top-level: parse optional first-line //! directive, carve, compile.
compile_with_directive = function(src, compilers) {
  const nl = src.indexOf('\n');
  const firstLine = nl === -1 ? src : src.slice(0, nl);
  const rest = nl === -1 ? '' : src.slice(nl + 1);
  let spec, body;
  if (firstLine.trimStart().startsWith('//!')) {
    spec = parse_bracket_hole_spec(firstLine);
    body = rest;
  } else {
    spec = [];
    body = src;
  }
  return compile_carved_tree(carve_holes_via_brackets(body, spec), compilers);
};
