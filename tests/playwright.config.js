// Playwright configuration for the VVE regression harness.
// Firefox only for now; adding Chromium/WebKit projects later will reveal
// where the project relies on browser-specific behaviour (PRINCIPLES.md Decisions 2).
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './specs',
  // Keep snapshots in one readable tree: tests/snapshots/<spec>/<fixture>.json
  snapshotPathTemplate: '{testDir}/../snapshots/{testFileName}/{arg}{ext}',
  fullyParallel: true,
  reporter: [['list']],
  projects: [
    { name: 'firefox', use: { browserName: 'firefox', headless: true } },
  ],
});
