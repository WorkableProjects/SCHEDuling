import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false, // all files share one Postgres database
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      NETLIFY_DB_URL: process.env.TEST_DATABASE_URL ?? 'postgres://sched:sched@localhost:5432/sched_test',
      NETLIFY_DB_DRIVER: 'server',
      ADMIN_BOOTSTRAP_TOKEN: 'test-bootstrap-token',
    },
  },
});
