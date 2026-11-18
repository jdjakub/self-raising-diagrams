// Stage 2: what the collaborator notations produce.
// Each test launches a diagram the way a person would in the console, then records
// the notation's result as a readable text report (snapshot). Element ids are kept
// out of reports (they shift whenever a diagram gains an element): elements are
// described by appearance, and any remaining ids are renamed #1, #2, ... in order.
const { test, expect } = require('@playwright/test');
const { openFixture, inPage, canonIds, scrub } = require('../lib');
const tomas = require('../expected/tomas-checkers.json');

const textSnapshot = (lines) => scrub(lines.join('\n')) + '\n';

// ── BoardGameNotation (checkers) ─────────────────────────────────────────────

/** Opening the diagram parses it (its page title names BoardGameNotation). Report every region in testCheckers' formats, then exportJSForApp. */
async function checkersReport(page, file) {
  await openFixture(page, file);
  const report = await inPage(page, () => {
    const sections = {};
    for (const [inst, sem] of Object.entries(semantics)) {
      const lines = [];
      switch (sem.fromRule) {
        case 'BoardLegend':
          sem.forEach((nt) => lines.push(nt.name + ': ' + __el(nt.inner)));
          break;
        case 'MoveSpec':
          sem.forEach(({ name, inner }) =>
            lines.push(inner.before + (name ? ' --' + name + '--> ' : ' -> ') + inner.after));
          break;
        case 'TransformSpec':
          sem.forEach(([zone, before, after]) => lines.push(before + ' in ' + zone + ' becomes ' + after));
          break;
        case 'BoardState':
          sem.pieces.forEach((p) => lines.push(p.join(',')));
          sections[inst + ' zones'] = sem.zones.map((z) => z.name);
          break;
        case 'CombosSpec':
          sections[inst + ' stateClasses'] = Object.entries(sem.stateClasses).map((kv) => kv.join(' is a '));
          sem.edges.forEach(([f, n, t]) => lines.push(f + ' --' + n + '--> ' + t));
          break;
      }
      sections[inst + ' (:' + sem.fromRule + ')'] = lines;
    }
    sections['exportJSForApp'] = send(semantics, 'exportJSForApp').split('\n');
    return sections;
  });
  // Ids appear in the combos graph and the exported JS; canonicalise across the whole report.
  const text = canonIds(Object.entries(report).map(([k, v]) => '## ' + k + '\n' + v.join('\n')).join('\n\n'));
  return { report, text };
}

for (const file of [
  'TomasNotations/checkers.svg',
  'TomasNotations/checkers-normalized.svg',
  'TomasNotations/checkers-turkish.svg',
  'TomasNotations/checkers-turkish-normalized.svg',
]) {
  test(`BoardGameNotation: ${file}`, async ({ page }) => {
    const { text } = await checkersReport(page, file);
    expect(textSnapshot([text])).toMatchSnapshot(file.replace(/^.*\//, '').replace('.svg', '.txt'));
  });
}

// Tomas's own regression test (BoardGameNotation>>testCheckers), ported. His expected
// strings are in expected/tomas-checkers.json, extracted verbatim. Ids are compared after
// renaming to #1, #2, ..., because his test hardcoded auto-ids that have since shifted.
for (const file of ['TomasNotations/checkers.svg', 'TomasNotations/checkers-normalized.svg']) {
  test(`testCheckers expectations hold: ${file}`, async ({ page }) => {
    const { report } = await checkersReport(page, file);
    const section = (key) => report[Object.keys(report).find((k) => k.startsWith(key + ' (:'))].join('\n');
    expect.soft(section('MOVES - REGULAR')).toBe(tomas['MOVES - REGULAR']);
    expect.soft(section('MOVES - REGULAR_JUMP')).toBe(tomas['MOVES - REGULAR_JUMP']);
    expect.soft(section('MOVES - KING')).toBe(tomas['MOVES - KING']);
    expect.soft(section('MOVES - KING_JUMP')).toBe(tomas['MOVES - KING_JUMP']);
    // Edges and state classes share one id numbering, as in the original test.
    const combos = canonIds(section('COMBINATIONS') + '\n' + report['COMBINATIONS stateClasses'].join('\n'));
    expect.soft(combos).toBe(canonIds(tomas['COMBINATIONS edges'] + '\n' + tomas['COMBINATIONS stateClasses']));
    expect.soft(section('INITIAL')).toBe(tomas['INITIAL pieces']);
    expect.soft(section('TRANSFORMS')).toBe(tomas['TRANSFORMS']);
  });
}

// ── CarsNotation ─────────────────────────────────────────────────────────────

test('CarsNotation: TomasNotations/cars.svg', async ({ page }) => {
  await openFixture(page, 'TomasNotations/cars.svg');
  const lines = await inPage(page, () => { // opening parsed it: its page title names CarsNotation
    const out = ['## cars'];
    semantics.cars.forEach((c) => out.push(__el(c.body) + ' wheels: ' + c.wheels.map(__el).join('; ')));
    out.push('', '## road paths');
    semantics.paths.forEach((p) => {
      out.push(__el(p.path) + ' markers: ' + p.markers.length);
      p.markers.forEach((m) => out.push('  ' + __el(m)));
    });
    out.push('', '## arrows');
    semantics.arrows.forEach((a) => out.push(__el(a)));
    return out;
  });
  expect(textSnapshot(lines)).toMatchSnapshot('cars.txt');
});

// ── AnimationNotation ────────────────────────────────────────────────────────

/**
 * Launch: opening parses the diagram (by its page title); start; then play `steps`
 * ('click', or a number of milliseconds to let timers run, on a fake clock).
 * Reports the compiled rule tables, then the named elements' state after each step.
 */
async function animationReport(page, file, steps) {
  await page.clock.install();
  await openFixture(page, file);
  const lines = await inPage(page, () => {
    const s = semantics;
    const out = ['## names'];
    for (const [name, elt] of Object.entries(s.eltsByName)) out.push(name + ' = ' + __el(elt));
    out.push('', '## transitions (event: element / sequence: state -> state)');
    for (const [event, byElt] of Object.entries(s.byEvent))
      for (const [elt, bySeq] of Object.entries(byElt))
        for (const [seq, moves] of Object.entries(bySeq))
          for (const [from, to] of Object.entries(moves))
            out.push(event + ': ' + elt + ' / ' + seq + ': ' + (from === 'start' ? 'start' : __canon(from)) + ' -> ' + __canon(to));
    out.push('', '## commands per state');
    for (const [state, cmds] of Object.entries(s.cmdsByState))
      out.push(__canon(state) + ': ' + JSON.stringify(cmds));
    return out;
  });
  const stateOf = () => inPage(page, () => Object.entries(semantics.eltsByName).map(([name, e]) =>
    '  ' + name + ': style=' + JSON.stringify(e.getAttribute('style') || '')
    + ' transform=' + JSON.stringify(e.getAttribute('transform') || '')
    + (e.hasAttribute('transform_origin') ? ' transform_origin=' + JSON.stringify(e.getAttribute('transform_origin')) : '')
    + (e.querySelector('text') ? ' text=' + JSON.stringify(e.querySelector('text').textContent) : '')));

  await inPage(page, () => send(semantics, 'start'));
  lines.push('', '## playback', 'after start:', ...(await stateOf()));
  for (const step of steps) {
    if (step === 'click') await inPage(page, () => svg_parent.dispatchEvent(new MouseEvent('click')));
    else await page.clock.runFor(step);
    lines.push('after ' + (step === 'click' ? 'click' : step + 'ms') + ':', ...(await stateOf()));
  }
  lines.push('', '## legend', ...(await inPage(page, () => __legend())));
  return lines;
}

test('AnimationNotation: CamilleNotations/Example — animating a stack.svg', async ({ page }) => {
  const lines = await animationReport(page, 'CamilleNotations/Example — animating a stack.svg',
    ['click', 'click', 'click', 'click']);
  expect(textSnapshot(lines)).toMatchSnapshot('animating-a-stack.txt');
});

test('AnimationNotation: CamilleNotations/anim-test.svg', async ({ page }) => {
  const lines = await animationReport(page, 'CamilleNotations/anim-test.svg',
    ['click', 2100, 'click', 2100]);
  expect(textSnapshot(lines)).toMatchSnapshot('anim-test.txt');
});

// ── BoxGraphOM ───────────────────────────────────────────────────────────────

test('BoxGraphOM: boxGraph-example.svg', async ({ page }) => {
  await openFixture(page, 'boxGraph-example.svg');
  const lines = await inPage(page, () => {
    const g = semantics; // page title (:BoxGraphOM)
    if (!g) return ['BoxGraphOM parse failed'];
    const name = (nt) => (nt.name === undefined ? '(unnamed)' : JSON.stringify(nt.name));
    const out = ['## boxes'];
    g.nodes.forEach((n) => out.push(name(n) + ': ' + __el(n.inner.dom)));
    out.push('', '## arrows');
    g.edges.forEach((e) => {
      let conn;
      try {
        conn = send(g, 'connectionsOf:', e).map((n) => (n ? name(n) : 'nothing')).join(' -> ');
      } catch (err) {
        conn = 'ERROR ' + err.message;
      }
      out.push(name(e) + ': ' + __el(e.inner.dom) + ' connects: ' + conn);
    });
    return out;
  });
  expect(textSnapshot(lines)).toMatchSnapshot('boxGraph-example.txt');
});
