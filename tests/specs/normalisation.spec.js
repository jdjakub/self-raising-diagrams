// Stage 3: the normalised document itself, one diagram per editor.
// After init(), the whole <svg> tree is written out one element per line (indented by
// depth), preceded by a summary counting the canonical forms. To keep diffs about
// meaning rather than noise (until CLEANUP.md fire 3 settles caches vs meaning):
//   - auto-generated ids (e12, t41, ...) are shown as id=auto; ids from the editor or
//     the user are kept;
//   - attributes are sorted by name;
//   - numbers with 3+ decimals are rounded to 2 (standards let geometry functions vary
//     slightly between browsers; PRINCIPLES.md Decisions 2);
//   - values over 500 characters (embedded images, long path data) are shortened to
//     their start plus a fingerprint, so any change still shows up (paragraph text,
//     data-string, is never shortened).
const crypto = require('crypto');
const { test, expect } = require('@playwright/test');
const { openFixture, inPage, scrub } = require('../lib');

const AUTO_ID = /^(?:pl|par|e|c|p|t|r|l|g|a)\d+$/;
const NO_ROUNDING = new Set(['id', 'class', 'data-string']);

function formatValue(name, value) {
  if (name === 'id' && AUTO_ID.test(value)) return 'auto';
  let v = NO_ROUNDING.has(name) ? value : value.replace(/-?\d+\.\d{3,}/g, (n) => String(+(+n).toFixed(2)));
  if (v.length > 500 && name !== 'data-string') {
    const hash = crypto.createHash('sha1').update(value).digest('hex').slice(0, 10);
    v = v.slice(0, 60) + '…(' + value.length + ' chars, sha1 ' + hash + ')';
  }
  return JSON.stringify(v);
}

// A symmetric connector's ends (and their outward directions, kept paired with them)
// are written in no meaningful order (PRINCIPLES.md Decision 4), so sort them.
function sortSymmetricEnds(attrs) {
  const get = (k) => (attrs.find(([n]) => n === k) || [])[1];
  const pts = get('data-end-pts'), outs = get('data-end-outs');
  if (!pts || !outs) return attrs;
  const pairs = pts.split(' ').map((p, i) => [p, outs.split(' ')[i]]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return attrs.map(([k, v]) => [k, k === 'data-end-pts' ? pairs.map((p) => p[0]).join(' ')
    : k === 'data-end-outs' ? pairs.map((p) => p[1]).join(' ') : v]);
}

function formatTree(node, depth, out) {
  const attrs = sortSymmetricEnds([...node.attrs]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => k + '=' + formatValue(k, v)).join(' ');
  out.push('  '.repeat(depth) + '<' + node.tag + (attrs ? ' ' + attrs : '') + '>'
    + (node.text ? ' ' + JSON.stringify(node.text) : ''));
  node.kids.forEach((k) => formatTree(k, depth + 1, out));
}

function summary(root) {
  const tags = {}, forms = {};
  const visit = (n) => {
    tags[n.tag] = (tags[n.tag] || 0) + 1;
    const cls = (n.attrs.find(([k]) => k === 'class') || [, ''])[1].split(/\s+/);
    for (const c of ['boundary-wrapper', 'boundary-shape', 'shape-interior', 'connector-wrapper',
      'connector-shaft', 'connector-head', 'is-symmetric', 'text-wrapper', 'is-multiline'])
      if (cls.includes(c)) forms[c] = (forms[c] || 0) + 1;
    n.kids.forEach(visit);
  };
  visit(root);
  const fmt = (o) => Object.keys(o).sort().map((k) => '  ' + k + ': ' + o[k]);
  return ['## canonical forms', ...fmt(forms), '', '## elements by tag', ...fmt(tags)];
}

// magic-red-id-test exercises symmetric connectors (headless probe lines, a double-headed
// arrow). Its init() still throws later, in the magic-red step (CLEANUP.md fire 1), so its
// report records that error and the document as it stood when init() stopped.
for (const [editor, file, snap] of [
  ['Mathcha', 'boxGraph-example.svg', 'mathcha-boxGraph-example.txt'],
  ['Mathcha', 'magic-red-id-test.svg', 'mathcha-magic-red-id-test.txt'],
  ['Affinity', 'CamilleNotations/Example — animating a stack.svg', 'affinity-animating-a-stack.txt'],
  ['PowerPoint', 'TomasNotations/checkers.svg', 'powerpoint-checkers.txt'],
]) {
  test(`normalised DOM (${editor}): ${file}`, async ({ page }) => {
    await openFixture(page, file);
    const { root, error } = await inPage(page, () => {
      let error = null;
      try { init(); } catch (e) { error = (e instanceof Error) ? e.message : String(e); }
      const walk = (e) => ({
        tag: e.tagName,
        attrs: [...e.attributes].map((a) => [a.name, a.value]),
        text: [...e.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent).join('').trim(), // the element's own text, not its children's
        kids: [...e.children].map(walk),
      });
      return { root: walk(svg_parent), error };
    });
    const tree = [];
    formatTree(root, 0, tree);
    const head = error ? ['## init() threw', '  ' + error, ''] : [];
    const report = [...head, ...summary(root), '', '## tree', ...tree].join('\n');
    expect(scrub(report) + '\n').toMatchSnapshot(snap);
  });
}
