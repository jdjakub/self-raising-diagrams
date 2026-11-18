// Stage 1: smoke test for every SVG fixture.
// For each fixture, record:
//   - which <script href> files it asks for, and whether they exist;
//   - page errors, console errors and dialogs while loading, which includes the
//     init() that opening runs (PRINCIPLES Decision 5);
//   - whether init() exists, and what the parse left in `semantics`.
// The snapshot records current behaviour, failures included (characterisation).
const { test, expect } = require('@playwright/test');
const fixtures = require('../fixtures');
const { snapshotName, scrub, toSnapshot, scriptReferences, openFixture } = require('../lib');

for (const { file } of fixtures) {
  test(`smoke: ${file}`, async ({ page }) => {
    const scripts = scriptReferences(file);
    const events = await openFixture(page, file);

    const initResult = await page.evaluate(() => {
      if (typeof init !== 'function') return { defined: false };
      if (typeof semantics === 'undefined') return { defined: true, semantics: 'undefined' };
      if (semantics === null) return { defined: true, semantics: null };
      const vt = semantics.vtable;
      return { defined: true,
        semantics: { vtable: typeof vt === 'string' ? vt : Object.keys(vtables).find(k => vtables[k] === vt),
                     keys: Object.keys(semantics).length } };
    });

    const report = { file, scripts, init: JSON.parse(scrub(JSON.stringify(initResult))), events };
    expect(toSnapshot(report)).toMatchSnapshot(snapshotName(file));
  });
}
