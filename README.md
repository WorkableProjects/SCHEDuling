# SCHEDuling

An event scheduling platform modelled on Sched.com, running 100% on Netlify: React SPA, Netlify Functions, **Netlify Database** (Postgres) and **Netlify Blobs**. No external services.

Built from [`MASTER_PLAN.md`](MASTER_PLAN.md) (which wins on specifics), [`plan.md`](plan.md) and the Sched.com spec PDF.

## What it does

| Area | Features |
|---|---|
| **Admins (exactly 2)** | One-time `/setup` bootstrap, server-enforced cap, last-admin protection, audit log, user/role management, one-time invite and reset links |
| **Events** | Create, edit, publish/unpublish, archive, duplicate, delete. Privacy: public, invite-only, password. Branding, time zone, rules |
| **Schedule** | Sessions with draft/published/cancelled, tracks, rooms, speakers, capacity, waitlists, capacity labels, double-booking control, pinned and frozen sessions, CSV import (including bulk capacity updates by `id`) |
| **Attendees** | Sign-up or import, profile + photo, directory, personal agenda, session registration, "My ticket" QR, ICS calendar feed, notifications, feedback |
| **Speakers** | Created/invited by admins, edit own profile; edit own sessions' description and upload materials (when the event allows) |
| **Check-in** | QR scanner (camera), manual search, self check-in, event-level and session-level, idempotent duplicate scans, live counters, CSV exports, printable badges |
| **Staff role** | `checkin_staff` accounts can use only the check-in app, so volunteers don't use up the two admin seats |

**Agenda ≠ registration.** Adding a session to your agenda is a bookmark. *Registering* is what holds a seat and enforces capacity, waitlists, conflicts and attendance. Pinned sessions appear on everyone's agenda without registering anyone.

## Deploy to Netlify

One-time account steps (these can't be automated):

1. Push this repo to GitHub and **Add new project → Import from Git** in Netlify. The build settings come from `netlify.toml`.
2. Installing `@netlify/database` (already a dependency) makes Netlify provision the database on the first deploy. If it doesn't, create one under **Data & Storage → Database**.
3. Add a secret environment variable **`ADMIN_BOOTSTRAP_TOKEN`** (any long random string) and redeploy.
4. Visit **`https://<your-site>/setup`**, enter the token and the two admin emails. You get two one-time activation links. Send each admin theirs; each sets their own password. After that `/setup` returns 404 permanently.

Everything else is automatic: migrations in `netlify/database/migrations` run before each deploy is published (previews get their own database branch, so previews never touch production data).

### Cost and plan: what was verified

Checked against Netlify's docs on 2026-10-13:

- Netlify Database is listed for **credit-based plans**, and its limits table has a **Free** column (1 compute unit, 48 compute units per billing period, 5 GB storage, 5 GB bandwidth, sleeps after 5 minutes idle). The docs do **not** say outright whether Free accounts can use it, and storage is free only until July 1, 2026 with rates to be announced. **Confirm in your Netlify dashboard before relying on $0**, and watch the compute-unit cap: heavy use can exhaust the Free allowance.
- Netlify Functions, Blobs and static hosting have their own usage limits on every plan.
- Nothing in this app requires a payment method of its own. No payments are processed.

Don't describe this deployment as unlimited or permanently free.

## Local development

Requires Node 20+ and a local Postgres 15+.

```bash
npm install
createdb scheduling                       # or any database
export NETLIFY_DB_URL=postgres://user:pass@localhost:5432/scheduling
export NETLIFY_DB_DRIVER=server
export ADMIN_BOOTSTRAP_TOKEN=dev-token LOCAL_BLOBS_DIR=.local-blobs
npm run db:migrate:local                  # applies netlify/database/migrations/*.sql
npm run dev                               # Vite + the functions, http://localhost:5173
```

`npm run dev` serves the functions straight from `netlify/functions` through a Vite plugin. `npm run dev:netlify` runs the real `netlify dev` once the site is linked.

### Changing the schema

Edit `netlify/database/schema.ts`, then `npm run db:generate` (drizzle-kit writes SQL and `scripts/sync-migrations.mjs` copies it into `netlify/database/migrations`, the folder Netlify reads). Commit the new file. **Never run `drizzle-kit push` against the hosted database.** For breaking changes use expand-and-contract.

### Tests

```bash
createdb sched_test        # tests use postgres://sched:sched@localhost:5432/sched_test (override with TEST_DATABASE_URL)
npm run db:migrate:local   # with NETLIFY_DB_URL pointing at that test database
npm test                   # Vitest integration tests against real Postgres (permission matrix, admin cap, waitlist concurrency, conflicts, frozen sessions, idempotent check-in, CSV validation, ...)
npm run test:e2e           # Playwright: setup, event build, signup, agenda, register, waitlist, QR check-in, speaker editing, third-admin refusal
```

## Architecture

- `src/`: Vite + React + TypeScript + Tailwind SPA.
- `netlify/functions/*.ts`: one Netlify Function (v2) per resource, each declaring its `/api/...` path in `config.path`. Shared code in `netlify/lib/` (`router.ts` auth + CSRF, `permissions.ts`, `registration.ts`, `admins.ts`, ...).
- `netlify/database/`: Drizzle schema and committed SQL migrations.
- `shared/schemas.ts`: Zod schemas used for server validation.
- Files (photos, session materials) live in Netlify Blobs and are served through permission-checked functions, never public URLs.
- `maintenance.ts` is a scheduled function (every 15 min): session reminders and cleanup of expired sessions/tokens.

### Security notes

- Passwords: Argon2id (`@node-rs/argon2`). Login sessions are random opaque tokens; only a SHA-256 hash is stored. Cookie is `HttpOnly; Secure; SameSite=Lax`, and every mutating request needs a per-session CSRF token plus a same-origin check.
- Rate limiting: per-email and per-IP lockout on login; per-IP limits on signup, setup and event-password attempts.
- Roles are enforced server-side on every route (`createRouter` takes the allowed roles per route). Public sign-up can only ever create `attendee`.
- Admin cap: role changes and disabling run in a transaction under an advisory lock that counts admins first, so `MAX_ADMINS` can't be exceeded by concurrent requests and the last admin can't be removed.
- Capacity and waitlists: registration locks the session row (`SELECT … FOR UPDATE`) and the user (advisory lock); the test suite races 10 registrations for 3 seats.
- CSV exports neutralise spreadsheet formulas; uploads are verified by content (magic bytes) and size-limited.

## Operations runbook

- **First admin setup / lost admin access:** admins can reset each other's password from *Users & admins* (one-time link, 60 minutes). If both admins are locked out, delete the `users` rows with role `admin` in the Netlify database console, then visit `/setup` again.
- **Backups:** Netlify takes a daily backup and one before every production deploy is published (Free plan retention: 3 days of daily backups and only the latest deploy's backup; longer on paid plans). Restore from **Data & Storage → Database → Backups** (Team Owner role). Restoring discards data written after the backup. Rolling back a deploy does **not** roll back the database.
- **CSV exports** (attendees, registrations, attendance, sessions, feedback) are available per event under *Reports* / *Check-in* as an extra safety copy.
- **Emailing:** the app sends no email. Invites and resets are one-time links an admin copies and shares.

## Deferred (per MASTER_PLAN)

Call-for-papers and reviewer workflow, paid tickets and coupons (tickets are free labels only), sponsor/vendor roles, AI content tools, public API, website embeds. Email delivery is also out of scope: Netlify has no first-party sender.
