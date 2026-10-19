import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: process.env.LAB_URL || 'http://127.0.0.1:5173',
    viewport: { width: 1440, height: 1050 },
    launchOptions:
      process.platform === 'darwin'
        ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }
        : {},
    screenshot: 'only-on-failure',
  },
  reporter: 'list',
});
