# RuralAttend

RuralAttend is a rural-school attendance project built on the existing React + Vite application, with an Express/PostgreSQL API, offline attendance storage, and role-scoped server operations. The interface keeps an explicitly labeled local evaluation mode and a separate server-authenticated mode.

## Architecture

- `src/App.jsx` retains the current navigation and demo workflows. Production login, APIs, reports, directories, parent pages, preferences, and notifications use the authenticated API.
- `src/services/attendanceStore.js` owns the versioned IndexedDB database: sessions, normalized attendance records, outbox, metadata, and sync errors. UI components do not access IndexedDB directly.
- `src/services/attendanceSync.js` is a single-flight coordinator. It retains idempotency keys on retry, persists actual request failures, marks server-confirmed records, and records conflicts rather than overwriting them.
- `src/services/apiClient.js` centralizes credentialed requests and session-expiration behavior.
- `src/services/reportPdf.js` creates downloadable attendance PDFs from report data; CSV export remains available.
- Hindi UI text and report PDFs use the OFL licensed Noto Sans Devanagari font. The source WOFF-to-TTF conversion is reproducible with `node scripts/convert-deva-font.mjs`.
- Browser QR scans use `@zxing/browser`. Production QR contents are school-issued, signed, expiring identifiers verified by the authenticated API before attendance can be marked.
- `server/` contains Express middleware, PostgreSQL access, routes, migrations, seeding, validation, auth, and the email-delivery adapter.
- Department school analytics return full-scope totals, attendance averages, and verification counts separately from the paginated directory rows, so dashboard metrics do not shrink to the current page. Department CSV export fetches every page for the chosen date and filters and uses the formula-safe shared CSV serializer.
- `server/migrations/001_initial.sql` defines schools, users, roles, academic years, classes, staff assignments, students, parent links, attendance, idempotency, devices, notifications, audit logs, and expiring tokens. `002_user_activation_timestamp.sql` distinguishes claimed accounts from pending invitations.

## Prerequisites

- Node.js 24+ and npm.
- PostgreSQL 15+ (the schema uses `gen_random_uuid`).
- A PostgreSQL database role with permission to create application tables.
- Optional Resend email credentials for real invitation and password-reset delivery.

## Install and configure

```powershell
npm install
Copy-Item .env.example .env
```

Edit `.env` locally. Do not commit it. Set `DATABASE_URL`, `JWT_SECRET` (at least 32 random characters), `APP_ORIGINS`, and a unique `SEED_PASSWORD` of at least 12 characters. For the frontend role-picker evaluation flow, keep `VITE_DEMO_MODE=true`. For server authentication, set `VITE_DEMO_MODE=false` and restart Vite.

Example local PostgreSQL setup, run as a PostgreSQL administrator and replace the sample password yourself:

```sql
CREATE ROLE ruralattend_user LOGIN PASSWORD 'replace-with-a-private-password';
CREATE DATABASE ruralattend OWNER ruralattend_user;
```

Then set `DATABASE_URL=postgresql://ruralattend_user:<your-password>@127.0.0.1:5432/ruralattend` in `.env`. URL-encode reserved characters in the password. Keep passwords and generated JWT secrets out of source control and chat.

## Migrate and seed

```powershell
npm run db:migrate
npm run db:seed
```

The seed command refuses to run without `SEED_PASSWORD`. It creates clearly named demo identities from the `SEED_*_EMAIL` settings; all use the locally supplied seed password. Seed accounts are for isolated development only. Do not seed them into production. The email adapter logs invitation/reset links locally in development when no provider is configured; protect the local API logs.

## Start the complete app

Use two terminals after database setup:

```powershell
npm run api
```

```powershell
npm run dev
```

Vite serves the frontend at `http://localhost:5173` and proxies `/api` to Express at `http://127.0.0.1:3001`. In production, serve the built frontend and API behind HTTPS with the configured origin allowlist. The service worker is registered only in production builds.

## Demo mode

In development, the sign-in role selector is available unless `VITE_DEMO_MODE=false`. It uses illustrative local data and does not authenticate against PostgreSQL. Production builds cannot use the role picker: they require a server-issued HttpOnly session cookie. Never treat demo mode as an authorization boundary.

## Tests and checks

```powershell
npm run build
npm run lint
npm test
npm run smoke:browser
```

The browser smoke command expects the development demo to be open in Chromium on port 5173 with the DevTools Protocol enabled on port 9222; `CHROME_CDP_ORIGIN` and `RURALATTEND_ORIGIN` can override those addresses. It navigates the role/page set at 390px, 768px, and 1280px and fails on missing headings, runtime errors, or document-level horizontal overflow.

The tests cover IndexedDB draft persistence, idempotency, offline correction protection, migration from the previous localStorage shape, sync failure retention/recovery, server/local conflict resolution, single-flight requests, formula-safe CSV output, generated PDF output, no fabricated production parent attendance, Hindi translation coverage for key screens, unauthenticated API rejection, mocked authenticated parent-child privacy and school-tenant scope, school-admin role denial, CORS rejection, and the health endpoint response shape. The test command uses Node's `--test-force-exit` because the API test process otherwise retains an open handle after reporting results. Mocked route-scope tests do not replace database-backed integration/security tests.

Local verification (2026-10-22): `npm.cmd test` passed 35/35 tests; `npm.cmd run build` passed; `npm.cmd run lint` passed without warnings; `node --check` passed for 22 backend JavaScript files; and the browser role/page smoke visited 126 role/page/viewport combinations (42 pages at 390px, 768px, and 1280px) with no missing headings, runtime errors, or horizontal overflow. The API process starts, but its health endpoint returns HTTP 503 because this workspace has no local `.env`/database password. This browser sweep used the development app and is not a production database test.

## Offline attendance behavior

Drafts and submitted payloads are persisted in IndexedDB. Each submission gets a UUID idempotency key; the server records that key transactionally with the submission. A failed request stays queued with an error and retry backoff. The UI distinguishes local, pending, syncing, synced, failed, and conflict states. A correction cannot replace an unacknowledged payload. The production service worker caches the built application shell; it does not imply that the server is reachable. Sync only becomes server-confirmed after an API response.

## Email configuration

To deliver invitations and password recovery, configure `RESEND_API_KEY` and `MAIL_FROM` in `.env`. Without them, production email delivery is unavailable; the API does not claim that a message was sent. SMS, push notifications, and other providers are not configured.

## Known limitations and verification status

- The API process starts, but this workspace has no `.env`/`DATABASE_URL` or PostgreSQL password. During local verification on 2026-10-22 its health endpoint returned HTTP `503` and the pool reported a missing SCRAM password. Migrations, seed, database-backed login, report SQL, notifications, and role-authorization checks against PostgreSQL have therefore **not been run** here. Configure credentials and run migrations before using production mode.
- Real authentication uses PostgreSQL-backed users, bcrypt password hashing, HttpOnly SameSite cookies, a database session version, rate limits, strict input schemas, allowlisted CORS, school/parent/teacher scope checks, and one-time hashed reset/invitation tokens. Automated DB-backed authorization tests are still needed before deployment.
- Production workflows include students/classes, teacher invitations/updates/deactivation and class assignments, parent invitations and activation, parent-child linking, parent-account suspension/reactivation, department school verification across pending/verified/rejected states, paginated school directories with complete filtered CSV export, preferences, academic-year create/edit/archive, scoped audit search, and school device registration/monitoring. Parent status changes invalidate all account sessions and are audited. Device revocation removes the registry entry and invalidates all sessions for the account; it does not revoke an individual session. Academic years containing classes or attendance cannot be archived, preserving history. Parent dashboard/history queries only include submitted or approved attendance.
- **Server-side role permission matrix:** Teachers can read their active class assignments and associated students, submit/correct attendance for assigned classes, view scoped reports and their own audit events, and manage their own registered devices. Principals can read and manage students/classes and teacher assignments within their school, review/approve attendance, and access school reports, audit events, and devices; class deletion, account provisioning, and academic-year management are reserved for school administrators. School administrators can manage school-scoped students, classes, assignments, staff/parent accounts, academic years, school details, notifications, audit events, and school devices. Education department users can read only their configured district's school directory, reports, and audit data and update school verification; they cannot perform school-level student or attendance management. Parents can read only their linked children's records, attendance, reports, notifications, and personal preferences. Backend routes enforce these role and data-scope rules; frontend visibility is not an authorization boundary. Mocked role-denial tests are not a substitute for database-backed testing.
- Camera QR scanning uses `@zxing/browser` with camera selection where available, permission/error messaging, and a manual token fallback. Hardware camera testing remains device-dependent.
- Attendance reports generate authorized class, daily, monthly, student, and school summaries through server-side aggregation, with PDF files from `jsPDF` and CSV export.
- English/Hindi preferences persist. Navigation, login/password-recovery screens, role dashboards, the attendance register and its offline/sync states, settings, demo history/notifications/accounts/devices/audit screens, audit/report controls, production directory/account/notification/device workflows, camera and conflict-recovery states, parent attendance views, and the help/not-found pages have translated labels and actions; Hindi report pages use browser text shaping and are rasterized into the PDF. Full Hindi coverage across every page and server-provided error messages remains incomplete. Names and stored class/school labels stay as entered.
- Notification delivery is in-app. Email requires provider configuration; no SMS, push, or third-party messaging is claimed.
- Offline conflicts are retained for review. The attendance page loads the current server register and lets a user adopt it or queue their complete local register as a correction against the current revision. A real PostgreSQL conflict test remains outstanding.
- Do not enter real student information until the database, deployment security, backup, retention, and privacy requirements have been reviewed.

### Remaining verification checklist

1. Configure a private PostgreSQL URL and `SEED_PASSWORD` in the local `.env`; run `npm run db:migrate` and `npm run db:seed` against a development database.
2. Run database-backed login, tenant-isolation, parent-child privacy, role authorization, attendance idempotency/correction, teacher assignment, report, notification, and device-revocation tests. Confirm both allowed and denied cases across roles and schools.
3. Start the API and Vite in production-auth mode (`VITE_DEMO_MODE=false`), sign in with seeded development accounts, and exercise attendance sync, conflict review, management, and exports against PostgreSQL.
4. Test QR scanning on a camera-enabled HTTPS/localhost device, including denied permission, missing camera, camera selection, duplicate scans, and invalid/expired tokens.
5. Review Hindi translations across all pages and dialogs, then verify responsive layouts, keyboard access, contrast, and reduced-motion behavior on desktop and mobile sizes.
