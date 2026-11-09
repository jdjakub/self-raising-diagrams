// Stage 1: smoke test for every SVG fixture.
// For each fixture, record:
//   - which <script href> files it asks for, and whether they exist;
//   - page errors, console errors and dialogs while loading and running init();
//   - whether init() exists, and what it returned or threw.
// The snapshot records current behaviour, failures included (characterisation).
const { test, expect } = require('@playwright/test');
const fixtures = require('../fixtures');
const { snapshotName, scrub, toSnapshot, scriptReferences, openFixture, IN_PAGE_DESCRIBE } = require('../lib');

for (const { file } of fixtures) {
  test(`smoke: ${file}`, async ({ page }) => {
    const scripts = scriptReferences(file);
    const events = await openFixture(page, file);

    const initResult = await page.evaluate((describeSrc) => {
      (0, eval)(describeSrc);
      if (typeof init !== 'function') return { defined: false };
      try {
        return { defined: true, ok: true, returned: __describe(init()) };
      } catch (e) {
        return { defined: true, ok: false, threw: __describe(e) };
      }
    }, IN_PAGE_DESCRIBE);

    const report = { file, scripts, init: JSON.parse(scrub(JSON.stringify(initResult))), events };
    expect(toSnapshot(report)).toMatchSnapshot(snapshotName(file));
  });
}
