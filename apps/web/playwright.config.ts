import { defineConfig, devices } from '@playwright/test';

// Cross-browser (chromium/firefox/webkit) + cross-platform (desktop/mobile viewport)
// coverage in one config, per CAMP-13.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html'], ['github']] : 'list',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'npm run start -- -p 3000',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
  projects: [
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
