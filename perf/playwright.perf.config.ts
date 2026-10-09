import { defineConfig } from '@playwright/test';

/** Performance probe on the real GPU, uncapped frame rate. See frame-time.spec.ts. */
export default defineConfig({
  testDir: '.',
  timeout: 600_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    launchOptions: {
      args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
    },
  },
  webServer: {
    command: 'npm run dev -- --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
