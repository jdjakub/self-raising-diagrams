// What init()'s magic-red step (MagicRedNotation; PRINCIPLES Decision 3) does to
// each diagram that has magic-red boxes: the names it applied and where they
// landed, the diagram errors it reported, the code boxes in the order they ran
// with each outcome, and any red elements left in the document afterwards.
// Elements are described by appearance (no auto ids), so reports stay stable.
const { test, expect } = require('@playwright/test');
const { openFixture, inPage, scrub } = require('../lib');

const DEMOS = [
  'magic-red-id-test.svg',
  'containment-stress-test.svg',
  'solid-physics-test-2.svg',
  'notational-dispatch.svg',
];

for (const file of DEMOS) {
  test(`magic-red boxes: ${file}`, async ({ page }) => {
    await openFixture(page, file);
    const lines = await inPage(page, () => {
      const out = [];
      try { init(); } catch (e) { out.push('## init() threw', '  ' + JSON.stringify(__describe(e))); }
      if (typeof magicRed === 'undefined') return out.concat('## no magicRed summary');

      const boxText = (box) => [...(send(box, 'interior') || box).querySelectorAll('g.text-wrapper')]
        .map(t => t.dataset.string).join(' / ');
      const outcome = (x) => {
        if (x === 'ok') return 'ok';
        if (x instanceof Error) return x.name + ': ' + x.message;
        if (Array.isArray(x)) return x.map(v => v instanceof Element ? __el(v) : String(v)).join(' ');
        return String(x);
      };

      out.push('## names applied');
      magicRed.names.forEach(n => out.push('  #' + n.name + ' -> ' + __el(n.target) + (n.probe ? '  (via probe)' : '  (container)')));
      out.push('## diagram errors');
      magicRed.errors.forEach(e => out.push('  ' + e.message + '  [box ' + JSON.stringify(boxText(e.box)) + ']'));
      out.push('## warnings');
      magicRed.warnings.forEach(w => out.push('  ' + w.message));
      out.push('## code boxes, in run order');
      magicRed.codeBoxes.forEach(cb => out.push('  ' + JSON.stringify(cb.firstLine) + ' -> ' + outcome(cb.outcome)));

      // Red things still in the document: error boxes, their probes, red one-headed arrows.
      out.push('## red elements left');
      const seen = new Set();
      for (const e of document.querySelectorAll('*')) {
        if (!(e.style && e.style.stroke === MAGIC_RED)) continue;
        const thing = e.closest('g.connector-wrapper') || e;
        if (seen.has(thing)) continue;
        seen.add(thing);
        out.push('  ' + __el(thing) + (thing.matches('.boundary-shape') ? ' ' + JSON.stringify(boxText(thing)) : ''));
      }
      return out;
    });
    expect(scrub(lines.join('\n')) + '\n').toMatchSnapshot(file.replace('.svg', '.txt'));
  });
}
