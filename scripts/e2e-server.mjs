// Recreates the e2e database from the committed migrations, then starts the dev server on :5199.
import pg from 'pg';
import { spawn, execFileSync } from 'node:child_process';
const url = process.env.E2E_DATABASE_URL;
const admin = new pg.Client({ connectionString: url.replace(/\/[^/]+$/, '/postgres') });
await admin.connect();
const name = new URL(url).pathname.slice(1);
await admin.query(`drop database if exists ${name} with (force)`);
await admin.query(`create database ${name}`);
await admin.end();
execFileSync('node', ['scripts/migrate-local.mjs'], { stdio: 'inherit', env: { ...process.env, NETLIFY_DB_URL: url } });
spawn('npx', ['vite', '--port', '5199', '--strictPort'], { stdio: 'inherit' });
