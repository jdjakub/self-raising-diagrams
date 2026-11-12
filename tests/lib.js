// Shared helpers for the VVE regression harness.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const REPO = path.resolve(__dirname, '..');
const REPO_URL = pathToFileURL(REPO).href;

/** Absolute path of a fixture given its repo-relative path. */
const fixturePath = (file) => path.join(REPO, file);

/** A filesystem-safe snapshot name for a fixture, e.g. 'TomasNotations__checkers.json'. */
const snapshotName = (file) =>
  file.replace(/\.svg$/, '').replace(/\//g, '__').replace(/[^A-Za-z0-9._-]+/g, '-') + '.json';

/** Replace machine-specific absolute paths/URLs with '<repo>' so snapshots are portable. */
const scrub = (text) => String(text).split(REPO_URL).join('<repo>').split(REPO).join('<repo>');

/** Serialise a result for a snapshot: stable, indented, trailing newline. */
const toSnapshot = (value) => JSON.stringify(value, null, 2) + '\n';

/**
 * The scripts an SVG asks for via <script href>, each with whether the file exists.
 * Read from the file itself, so it doesn't depend on browser error reporting.
 */
function scriptReferences(file) {
  const abs = fixturePath(file);
  const text = fs.readFileSync(abs, 'utf8');
  return [...text.matchAll(/<script\b[^>]*\bhref="([^"]+)"/g)].map(([, href]) => ({
    href,
    exists: fs.existsSync(path.resolve(path.dirname(abs), href)),
  }));
}

/**
 * Open a fixture over file:// and start recording page errors, console errors and
 * dialogs (alert/confirm are dismissed so they can't block the run).
 * Returns the list that events are appended to.
 */
async function openFixture(page, file) {
  const events = [];
  page.on('pageerror', (e) => events.push({ kind: 'pageerror', message: scrub(e.message) }));
  page.on('console', (m) => {
    if (m.type() === 'error') events.push({ kind: 'console.error', text: scrub(m.text()) });
  });
  page.on('dialog', async (d) => {
    events.push({ kind: 'dialog', type: d.type(), message: scrub(d.message()) });
    await d.dismiss();
  });
  await page.goto(pathToFileURL(fixturePath(file)).href, { waitUntil: 'load' });
  return events;
}

/**
 * Runs inside the page: turn any value (including thrown arrays of DOM elements,
 * which the engine uses as error values) into plain JSON-able data.
 * Elements become '<tag#id>'.
 */
const IN_PAGE_DESCRIBE = `
  globalThis.__describe = (x, depth = 0) => {
    if (depth > 3) return '...';
    if (x instanceof Error) return { error: x.name, message: x.message };
    if (x instanceof Element) return '<' + x.tagName + (x.id ? '#' + x.id : '') + '>';
    if (Array.isArray(x)) return x.map(v => __describe(v, depth + 1));
    if (x === undefined) return 'undefined';
    if (x === null || typeof x !== 'object') return x;
    return '[object]';
  };
`;

/**
 * Runs inside the page: helpers for describing results without auto-generated ids
 * (which shift whenever an element is added to a diagram).
 *   __el(element)  -> what it looks like: 'text "foo"', 'rect @10,20 30x40 fill=#fff', ...
 *   __canon(el|id) -> a stable label '#1', '#2', ... in order of first use
 *   __legend()     -> lines explaining each '#n' label via __el
 * Safe to install repeatedly: the label numbering survives re-installation.
 */
const IN_PAGE_HELPERS = IN_PAGE_DESCRIBE + `
  globalThis.__el = (e) => {
    if (!(e instanceof Element)) return String(e);
    if (e.matches('g.text-wrapper')) return 'text ' + JSON.stringify(e.dataset.string);
    if (e.matches('g.connector-wrapper.is-symmetric')) // ends in sorted order: their written order means nothing
      return 'connector ' + (e.dataset.endPts || '?').split(' ').sort().join(' -- ') + ' (symmetric)';
    if (e.matches('g.connector-wrapper'))
      return 'connector ' + (e.dataset.originPt || '?') + ' -> ' + (e.dataset.targetPt || '?');
    const r = Math.round;
    let bb = null;
    try { bb = e.getBBox(); } catch (err) { /* not rendered */ }
    const n = ['polygon', 'polyline'].includes(e.tagName) ? '(' + send(e, 'vertices').length + ')' : '';
    const fill = e.getAttribute('fill') || e.style.fill || '';
    return e.tagName + n + (bb ? ' @' + r(bb.x) + ',' + r(bb.y) + ' ' + r(bb.width) + 'x' + r(bb.height) : '')
      + (fill ? ' fill=' + fill : '');
  };
  globalThis.__canonMap = globalThis.__canonMap || new Map();
  globalThis.__canon = (x) => {
    const key = (typeof x === 'string' && document.getElementById(x)) || x;
    if (!__canonMap.has(key)) __canonMap.set(key, '#' + (__canonMap.size + 1));
    return __canonMap.get(key);
  };
  globalThis.__legend = () => [...__canonMap].map(([k, v]) => v + ' = ' + (k instanceof Element ? __el(k) : String(k)));
`;

/**
 * Run `fn` inside the page with the helpers installed. `fn` must be self-contained
 * (it is sent to the page as source text); `arg` is passed to it.
 */
async function inPage(page, fn, arg) {
  return page.evaluate(([helpers, src, a]) => {
    (0, eval)(helpers);
    return (0, eval)('(' + src + ')')(a);
  }, [IN_PAGE_HELPERS, fn.toString(), arg]);
}

/**
 * Rename auto-generated element ids (e411, c424, t41, ...) to #1, #2, ... in order of
 * first appearance, so text reports stay stable when ids shift.
 * Only for text known not to contain user-written names of the same shape.
 */
function canonIds(text) {
  const seen = new Map();
  return text.replace(/\b(?:pl|par|e|c|p|t|r|l|g|a)\d+\b/g, (id) => {
    if (!seen.has(id)) seen.set(id, '#' + (seen.size + 1));
    return seen.get(id);
  });
}

module.exports = {
  REPO, fixturePath, snapshotName, scrub, toSnapshot, scriptReferences, openFixture,
  IN_PAGE_DESCRIBE, IN_PAGE_HELPERS, inPage, canonIds,
};
