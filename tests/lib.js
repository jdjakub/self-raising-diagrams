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

module.exports = { REPO, fixturePath, snapshotName, scrub, toSnapshot, scriptReferences, openFixture, IN_PAGE_DESCRIBE };
