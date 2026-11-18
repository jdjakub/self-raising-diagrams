// The default meta-notation (DefaultMetaNotation; PRINCIPLES Decision 5): which
// titled regions it finds, in what order, what each title resolves to, and the
// diagram errors it reports. No demo is drawn for it yet, so checkers.svg stands
// in: its regions sit on a page-sized white box (which must be looked through),
// and their titles name rules of BoardGameNotation, which plain
// DefaultMetaNotation doesn't have.
const { test, expect } = require('@playwright/test');
const { openFixture, inPage, scrub } = require('../lib');

const textSnapshot = (lines) => scrub(lines.join('\n')) + '\n';

// In-page: run `grammarName fromRegion:` over the whole document, then report
// the result table (title -> value) and the errors, in order.
const REPORT = (grammarName) => {
  const receiver = { vtable: grammarName };
  const table = send(receiver, 'fromRegion:', svg_parent);
  const out = ['## results, in parse order'];
  for (const [title, value] of Object.entries(table))
    out.push('  ' + JSON.stringify(title) + ' -> ' + (typeof value === 'string' ? value : typeof value));
  out.push('## diagram errors');
  receiver.errors.forEach(e => out.push('  ' + e.message));
  return out;
};

test('DefaultMetaNotation: checkers titles name no notation', async ({ page }) => {
  await openFixture(page, 'TomasNotations/checkers.svg');
  const lines = await inPage(page, (src) => {
    init();
    return eval(src)('DefaultMetaNotation');
  }, REPORT.toString());
  expect(textSnapshot(lines)).toMatchSnapshot('checkers-plain.txt');
});

// A notation built on DefaultMetaNotation with one rule of its own, plus a
// stand-in notation, exercises rule-then-notation lookup. Three titles are
// rewritten in the page to exercise the errors: one loses its TITLE, and two
// are given the same TITLE.
test('DefaultMetaNotation: rule, then notation; errors', async ({ page }) => {
  await openFixture(page, 'TomasNotations/checkers.svg');
  const lines = await inPage(page, (src) => {
    init();
    vtables.TestMetaNotation = {
      _parent: vtables.DefaultMetaNotation,
      ['BoardLegend']: () => 'rule TestMetaNotation>>BoardLegend',
      ['TransformSpec']: () => { throw fail; }, // a rule that doesn't match
    };
    vtables.CombosSpec = {
      _parent: vtables.NotationGrammar,
      ['fromRegion:']: () => { throw new Error('crashed'); }, // a notation that throws
    };
    vtables.MoveSpec = {
      _parent: vtables.NotationGrammar,
      ['fromRegion:']: () => 'notation MoveSpec',
    };
    vtables.BoardState = { ['fromRegion:']: () => 'not a notation' }; // no NotationGrammar parent
    const retitle = (from, to) => {
      const t = [...document.querySelectorAll('g.text-wrapper')].find(t => t.dataset.string === from);
      t.dataset.string = to;
    };
    retitle('MOVES - KING (:MoveSpec)', '(:MoveSpec)');
    retitle('MOVES - KING_JUMP (:MoveSpec)', 'TWIN (:MoveSpec)');
    retitle('MOVES - REGULAR_JUMP (:MoveSpec)', 'TWIN (:MoveSpec)');
    return eval(src)('TestMetaNotation');
  }, REPORT.toString());
  expect(textSnapshot(lines)).toMatchSnapshot('checkers-test-meta.txt');
});

test('DefaultMetaNotation: a diagram with no titles', async ({ page }) => {
  await openFixture(page, 'magic-red-id-test.svg');
  const lines = await inPage(page, (src) => {
    init();
    return eval(src)('DefaultMetaNotation');
  }, REPORT.toString());
  expect(textSnapshot(lines)).toMatchSnapshot('no-titles.txt');
});
