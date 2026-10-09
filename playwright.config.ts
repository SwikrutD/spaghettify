import { defineConfig } from '@playwright/test';

// BASE_URL runs the suite against an already running server (for example the Docker container on
// http://localhost:8095) instead of starting the Vite dev server.
const external = process.env.BASE_URL;

export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  use: {
    baseURL: external ?? 'http://localhost:5173',
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  webServer: external
    ? undefined
    : {
        command: 'npm run dev -- --strictPort',
        url: 'http://localhost:5173',
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
