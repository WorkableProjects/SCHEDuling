import { defineConfig, devices } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';

// Use the pre-installed Chromium when present (CI/sandbox); otherwise Playwright's own.
const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
const dir = existsSync(root) ? readdirSync(root).find((d) => d.startsWith('chromium-')) : undefined;
const executablePath = dir ? [`${root}/${dir}/chrome-linux/chrome`, `${root}/${dir}/chrome-linux64/chrome`].find(existsSync) : undefined;

const DB = process.env.E2E_DATABASE_URL ?? 'postgres://sched:sched@localhost:5432/sched_e2e';
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5199', trace: 'retain-on-failure', screenshot: 'only-on-failure', permissions: [], launchOptions: { executablePath, args: ['--no-sandbox'] } },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath, args: ['--no-sandbox'] } } }],
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    url: 'http://localhost:5199/api/auth/me',
    reuseExistingServer: false,
    timeout: 60_000,
    env: { NETLIFY_DB_URL: DB, NETLIFY_DB_DRIVER: 'server', ADMIN_BOOTSTRAP_TOKEN: 'e2e-token', LOCAL_BLOBS_DIR: '.e2e-blobs', E2E_DATABASE_URL: DB },
  },
});
