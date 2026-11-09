// Every *.jstalk.js must be listed in ./compile-jstalk, and its committed .js must be
// exactly what the transpiler produces from it today (i.e. nobody edited the .js by
// hand, or forgot to run ./compile-jstalk). No browser needed.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { test, expect } = require('@playwright/test');
const { REPO } = require('../lib');

const sources = execFileSync('git', ['-c', 'core.quotepath=off', 'ls-files', '*.jstalk.js'], { cwd: REPO })
  .toString().trim().split('\n').filter((f) => f && !f.startsWith('old-approaches/'));
const compileScript = fs.readFileSync(path.join(REPO, 'compile-jstalk'), 'utf8');

for (const src of sources) {
  const out = src.replace(/\.jstalk\.js$/, '.js');
  test(`generated JS up to date: ${out}`, () => {
    expect(compileScript, `${src} is missing from ./compile-jstalk`).toContain(`< ${src} > ${out}`);
    const expected = execFileSync('perl', [path.join(REPO, 'JSTalk/jstalk2js.pl')],
      { input: fs.readFileSync(path.join(REPO, src)) }).toString();
    const committed = fs.readFileSync(path.join(REPO, out), 'utf8');
    expect(committed === expected, `${out} differs from what ./compile-jstalk would produce`).toBe(true);
  });
}
