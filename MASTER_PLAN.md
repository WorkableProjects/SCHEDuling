# Master Plan — Sched.com Replica on Netlify (100% Netlify)

Builds on [`plan.md`](plan.md) and the Sched.com Full Spec PDF. Constraints: Netlify Database + Netlify Blobs only (no external DB/services, D1 fallback dropped); exactly two admin accounts; core focus on attendees, speakers, admins, and check-in; call-for-papers and other minor features deferred.

## 1. Scope and priorities
| Priority | Feature area | Source |
|---|---|---|
| P0 | Admin accounts (2), auth, roles | User + PDF "Admin permission model" |
| P0 | Events: create, edit, publish, privacy (public / invite-only / password) | PDF "Event creation and privacy" |
| P0 | Sessions, tracks, rooms, drafts vs published, schedule browser with filters | PDF "Schedule and session management" |
| P0 | Speakers: admin-created or invited, can edit own profile and sessions | PDF "Speaker workflow" |
| P0 | Attendees: signup or import, profile, personal agenda, session registration | PDF "Attendee experience" |
| P0 | Check-in: QR scan, manual check-in, self check-in, event-level and session-level attendance, CSV export | PDF "Check-in and attendance" |
| P1 | Capacity limits, waitlists, capacity labels, double-booking control, pinned and frozen sessions | PDF |
| P1 | In-app announcements and notifications, ICS calendar feed, attendee directory | PDF |
| P1 | CSV import (attendees, sessions) and export (attendees, registrations, check-ins) | PDF "Data, exports" |
| P2 | Badge printing (printable HTML with QR), session feedback (1–5 rating + comment) | PDF |
| Deferred | Call-for-papers and reviewers, paid tickets and coupons, sponsor/vendor roles, AI content tools, public API, embeds | Minor, or needs a non-Netlify service |

Key rule from the PDF: **adding a session to your agenda ≠ registering for it.** A pinned session shows on everyone's agenda. Registration is the step that enforces capacity, waitlist and attendance.

## 2. Architecture (100% Netlify)
- **Frontend:** Vite, React and TypeScript SPA (React Router), deployed as a Netlify static site. Styling uses Tailwind and a small in-house component kit.
- **API:** Netlify Functions v2 (TypeScript) under `netlify/functions/`, with one function per resource behind `/api/*` redirects. Shared code goes in `netlify/lib/` (db, auth, validation, permissions).
- **Database:** Netlify Database with Drizzle ORM (`drizzle-orm/netlify-db`). Migrations are committed to `netlify/database/migrations` and applied automatically on deploy. Never run `drizzle-kit push` against the hosted DB. Preview deploys get their own database branches.
- **File storage:** Netlify Blobs for speaker and attendee photos and session materials, served through a function that checks permissions.
- **Scheduled jobs:** Netlify Scheduled Functions for session reminders and expiring old auth sessions.
- **QR:** generated client-side (`qrcode` npm package). Scanned with the browser camera (`BarcodeDetector`, falling back to the `html5-qrcode` package). No external API.
- **Validation:** Zod schemas shared by client and server.
- **No external services.** Consequences:
  - **No outbound email.** Netlify has no first-party email sender. Invites and password resets use one-time links that admins copy and share. Notifications are in-app only.
  - **No payments.** Tickets are free/RSVP types only. Paid tickets are deferred.
  - **Auth is built in-house.** Netlify Identity is deprecated.
- **Cost check, one time and before Phase 2.** Netlify's own pages disagree on whether the Free plan includes Netlify Database. If Free does not include it, the cheapest credit-based plan is the minimum. Document the outcome in the README. Do not claim "$0" until it is verified.

## 3. Roles and permissions (enforced server-side on every function)
| Role | Access |
|---|---|
| `admin` (max 2) | Everything: events, sessions, users, roles, check-in, exports, announcements |
| `speaker` | Own profile, own sessions' descriptions and materials (if the event allows), own agenda |
| `attendee` | Profile, agenda, session registration, self check-in, feedback, directory (if enabled) |
| `checkin_staff` (P1) | Scanner and manual check-in screens only. Lets volunteers help without using up admin seats. |

`requireRole()` middleware lives in `netlify/lib/auth.ts`. Ownership checks (for example, a speaker editing only their own sessions) live in `netlify/lib/permissions.ts`.

## 4. Authentication and admin provisioning
- Users sign in with email and password, hashed with Argon2id (`@node-rs/argon2`).
- Sessions are opaque random tokens; only the SHA-256 hash is stored in the `auth_sessions` table. The browser holds the token in an `HttpOnly; Secure; SameSite=Lax` cookie, and each session carries a CSRF token for mutating requests.
- **Rate limiting:** a `login_attempts` table enforces a per-IP and per-email lockout window.
- **Bootstrap (one time):**
  1. Set the secret env var `ADMIN_BOOTSTRAP_TOKEN` in the Netlify UI.
  2. Visit `/setup` and enter the token plus the two admin emails. The server creates two pending admin accounts and returns two one-time activation links.
  3. Each admin sets their own password through their link.
  4. `/setup` permanently returns 404 once any admin exists.
- **Admin cap:** `MAX_ADMINS=2` is enforced in code. Role changes go through a transaction that counts admins first. One admin cannot remove the other while they are the last remaining admin.
- Public signup always creates `attendee`. Speakers are created by an admin or invited (via invite link).
- Password reset: an admin generates a one-time reset link (60-minute TTL).

## 5. Data model (Drizzle schema, `netlify/database/schema.ts`)
- `users` (id, email unique, password_hash, name, role, title, org, bio, photo_key, status, created_at)
- `auth_sessions`, `one_time_tokens` (purpose: activate, reset, invite), `login_attempts`
- `events` (slug unique, name, description, tz, start/end dates, location, branding json, privacy enum, password_hash, published, archived, settings json: allow_conflicts, directory_visible, self_checkin, speaker_edit)
- `event_members` (event_id, user_id, role_in_event, ticket_type, checked_in_at, qr_token unique), unique on (event_id, user_id)
- `tracks`, `rooms` (per event)
- `sessions` (event_id, title, description, start/end, room_id, status: draft, published or cancelled, capacity, requires_registration, pinned, frozen)
- `session_tracks`, `session_speakers` (many-to-many tables)
- `agenda_items` (user_id, session_id): the personal schedule. Unique on the pair.
- `session_registrations` (session_id, user_id, status: registered or waitlisted, position, created_at). Unique on the pair.
- `session_checkins` (session_id, user_id, method: qr, manual or self, by_user_id, at). Unique on the pair.
- `announcements`, `notifications` (per user, read_at)
- `feedback` (session_id, user_id, rating, comment)
- `audit_log` (actor_id, action, entity, entity_id, diff json, at)

Indexes cover every foreign key plus `sessions(event_id, start)`. Capacity and waitlist changes run in a transaction with `SELECT … FOR UPDATE` on the session row. When a registered attendee cancels, the first waitlisted user is auto-promoted and notified.

## 6. Key workflows
1. **Event setup:** an admin creates the event (slug, dates, tz, privacy), adds tracks and rooms, imports sessions and speakers from CSV or enters them by hand, works in draft, then publishes.
2. **Attendee:** signup (or import plus invite link) → event access per privacy rules → browse the schedule (by day, track or room, with search) → add to agenda → register for capacity-limited sessions (conflict check, waitlist) → get a personal QR on "My Ticket" → ICS feed at `/api/ical/:token`.
3. **Speaker:** invite link → set password → edit profile and photo → edit assigned sessions if the event allows → upload materials to Blobs.
4. **Check-in:**
   - The scanner page (admin or staff) reads an attendee's QR (`qr_token`) and records the event check-in. If a session is selected, it records session check-in too.
   - Manual check-in: search by name or email, then tap Check in.
   - Self check-in: the attendee taps "I'm here" when the event allows it, within ±30 minutes of session start.
   - Duplicate scans return an "already checked in" result instead of erroring.
   - Live counters show checked-in versus registered.
   - Exports: event attendance and session attendance as CSV.
5. **Changes:** editing or cancelling a published session sends notifications to everyone with it on their agenda or registered.

## 7. UI map
- **Public/attendee:** `/` (event list) · `/e/:slug` (welcome) · `/e/:slug/schedule` · `/e/:slug/session/:id` · `/e/:slug/speakers` and `/speaker/:id` · `/e/:slug/directory` · `/e/:slug/my-agenda` · `/e/:slug/ticket` (QR) · `/account` · `/login`, `/signup`, `/activate/:token`
- **Admin control panel (`/admin`):** Dashboard (counts, check-in rate) · Events · Event → Settings, Sessions, Tracks/Rooms, Speakers, Attendees, Registrations, Check-in, Announcements, Reports/Exports · Users and Admins · Audit log
- **Check-in app:** `/checkin/:slug`, mobile-first with a large scanner and a manual search tab
- Design system first: tokens (color, type scale, spacing), Button, Input, Select, Dialog, Table (search, sort, paginate), Toast, Badge, EmptyState and Skeleton. Every list has loading, empty and error states.

## 8. Phases (each one ends with tests passing)
1. **Foundation:** scaffold Vite, React and Functions; set up `netlify.toml`, Drizzle, the first migration and `netlify dev`; verify the DB plan and cost.
2. **Auth:** users, sessions, CSRF, rate limiting, `/setup` bootstrap, the 2-admin cap, invite and reset links.
3. **Design system and shell:** components, layouts, responsive nav.
4. **Events:** CRUD, privacy modes, publish/unpublish/archive, branding.
5. **Sessions, tracks, rooms, speakers:** CRUD, drafts, CSV import, speaker self-edit, Blobs uploads.
6. **Attendee experience:** schedule browser and filters, agenda, session registration with capacity, waitlist and conflicts, pinned and frozen sessions, ICS, directory.
7. **Check-in:** QR tickets, scanner, manual check-in, self check-in, live stats, attendance exports, printable badges.
8. **Communications and reporting:** announcements, change notifications, scheduled reminders, feedback, reports, audit log.
9. **Hardening:** a permission test matrix (each role × each endpoint), input fuzzing, responsive and accessibility pass.
10. **Deploy:** production deploy, migrations verified on deploy, bootstrap of the two admins, README and runbook (including the DB backup/restore approach Netlify offers).

## 9. Testing
- **Unit and integration (Vitest):** the permission matrix, the admin cap, waitlist promotion under concurrency, the conflict check, frozen sessions, idempotent check-in, CSV import validation. Run against a local or branch Netlify DB.
- **E2E (Playwright, Chromium pre-installed):** signup → agenda → register → QR check-in, admin creating an event and session, speaker editing their profile, and the 2-admin setup flow.
- Run `netlify build` locally before each push.

## 10. Acceptance criteria
- Exactly two admins can be provisioned securely. A third admin is refused. No default passwords exist.
- Every P0 feature works end to end against Netlify Database, with no mock data.
- Check-in works on a phone camera, by manual search and by self check-in, and the attendance CSVs export correctly.
- No dependency on any service outside Netlify. Deferred items are listed in the README.
- Netlify plan and cost requirements are documented truthfully.

Sources: [Netlify Database docs](https://docs.netlify.com/build/data-and-storage/netlify-database/), [Drizzle and Netlify DB](https://orm.drizzle.team/docs/connect-netlify-db), [Netlify DB tooling](https://docs.netlify.com/build/data-and-storage/netlify-database/tooling/), [Netlify KB: Postgres on Netlify](https://www.netlify.com/knowledge-base/how-to-add-a-postgres-database-to-a-netlify-app.md)
