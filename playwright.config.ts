import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { existsSync } from 'node:fs';
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export default defineConfig({
  testDir: './tests/browser',
  timeout: 95000,
  expect: { timeout: 12000 },
  workers: 1,
  fullyParallel: false,
  globalSetup: './tests/setup.ts',
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4317',
    viewport: { width: 1440, height: 1100 },
    headless: true,
    launchOptions: {
      executablePath: existsSync(chrome) ? chrome : undefined,
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        `--use-file-for-fake-audio-capture=${path.resolve('.local/microphone.wav')}`,
      ],
    },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:4317/api/status',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
