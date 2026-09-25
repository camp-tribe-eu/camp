import { defineConfig, devices } from '@playwright/test';
import { serverlessRun } from './src/lib/cli-args';

// Cross-browser (chromium/firefox/webkit) + cross-platform (desktop/mobile viewport)
// coverage in one config, per CAMP-13.
// 🔴 Debt #3 (CAMP-60): visual regression, and deliberately narrow.
//
// Chromium only, two viewports, four pages. Screenshotting 1000
// generated campsite pages would produce 1000 baselines that all change
// together whenever a shared component does — a diff nobody reviews and
// therefore a guard nobody reads. These are the layouts where a CSS
// regression is invisible to every other test we have.
//
// ❌ Percy is not used: it is paid, and by the owner's standing decision
// never through the UTD account. `toHaveScreenshot()` is free and
// already in the stack.
const visualProject = {
  name: 'visual',
  testDir: './tests/visual',
  use: { ...devices['Desktop Chrome'] },
};

/** Projects that never touch a page, so they never need a server. */
const SERVERLESS_PROJECTS = new Set(['unit']);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // 🔴 The JSON report is not decoration. `retries: 1` means a test that
  // fails and then passes leaves the job GREEN, and on 23.09.2026 that
  // hid a real design fault for a whole CI run — the error reporter
  // attached its listeners after hydration, and the only evidence was a
  // retry line nobody would read. scripts/ci/check-flaky.mjs reads this
  // file and fails the build on any flake, so "green" means green.
  reporter: process.env.CI
    ? [['html'], ['github'], ['json', { outputFile: 'playwright-report/report.json' }]]
    : 'list',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  // \ud83d\udd34 The unit project is pure logic \u2014 no browser, no server \u2014 and
  // making it wait 60 s for `next start` (which needs a build that may
  // not exist) is how a fast check stops being run at all. If every
  // project asked for on the command line is a serverless one, no server
  // is started. Any other selection, and CI's full run, behave as before.
  webServer: process.env.BASE_URL || serverlessRun(process.argv, SERVERLESS_PROJECTS)
    ? undefined
    : {
        command: 'npm run start -- -p 3000',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
  // Baselines are per-platform by nature — a font renders differently on
  // macOS and on Linux. Ours are generated on the CI runner and only
  // compared there; the path carries the platform so a locally generated
  // one can never be mistaken for the real baseline.
  snapshotPathTemplate:
    '{testDir}/__screenshots__/{testFileName}/{arg}-{platform}{ext}',

  // 🔴 The visual project is NOT in the default set, and the split is
  // made by a flag rather than by listing project names on the command
  // line. `npm run test:e2e` is a bare `playwright test`, so a project
  // added here joins it automatically — which is what we want for a new
  // browser, and exactly what we do not want for the screenshots, whose
  // baselines only exist for the CI platform.
  //
  // A hand-written `--project=…` list in package.json would have the
  // failure this repository has already been bitten by twice: a scope
  // maintained by hand that silently stops covering what it names.
  projects: process.env.VISUAL
    ? [visualProject]
    : [
    // 🔴 Pure logic, no browser and no server. The map filters decide what
    // a reader is shown, and that decision is worth testing in
    // milliseconds rather than only through six browsers — the same rule
    // the API side follows, where filters.ts has its own unit spec.
    { name: 'unit', testDir: './tests/unit' },
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox-desktop', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit-desktop', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 14'] } },
    { name: 'tablet', use: { ...devices['iPad Mini'] } },
  ],
});
