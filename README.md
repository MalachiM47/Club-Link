# Club Link

A school-club platform built with HTML, CSS, vanilla JavaScript, and Supabase. Members find schedules and announcements in one place; officers manage their own clubs; the platform owner creates and deletes clubs.

This expands the original single-club dashboard. It retains the existing schedule, event archive, announcements, club settings, color themes, dialogs, and responsive layout.

**Upgrading the existing Black Student Union project? Start with [the migration checklist](docs/MIGRATION.md). Do not reset the database or rerun the old setup file.**

## Why it exists

Club logistics are often scattered across messages, documents, and word of mouth. Club Link gives each club a shared information hub without requiring a separate website. Guest access remains available for students who do not want an account.

## Features

- **My Clubs:** one account, multiple independent memberships, clickable club cards, and a simple return button.
- **Accounts:** first name, last initial, email, and password only. Supabase handles authentication and email confirmation.
- **Account controls:** confirmed sign-out and a three-step account deletion flow backed by a server-only Supabase Auth endpoint.
- **Member access:** join permanently with a Member Code, or view a club temporarily without an account.
- **Officer access:** a reusable Officer Code upgrades the authenticated user's membership without creating duplicates.
- **Club dashboard:** next schedule item, chronological upcoming events, text/date filtering, latest announcements, and club information.
- **Schedule management:** Meeting/Other selector, custom activity names, create/edit/delete, and automatic Previous events after local midnight.
- **Meeting workspace:** ordered talking points, per-point secretary notes, keyboard-accessible reorder buttons, atomic saves, conflict detection, and unsaved-change warnings.
- **Club access management:** authorized officers can view, copy, and rotate both codes.
- **Super Admin:** create clubs and delete them with exact-name confirmation. This is separate from membership roles.
- **Existing design:** CL identity, SVG favicon, club color palettes, responsive navigation, loading/error/empty states, and Privacy/Terms pages.

## Technology and architecture

The frontend remains framework-free. The only browser library is Supabase JavaScript v2, loaded through jsDelivr. Node runs one small Vercel function for code redemption. PGlite is a **development-only** PostgreSQL engine used to test the real migration and RLS locally.

| Module | Responsibility |
| --- | --- |
| `js/app.js` | Existing dashboard rendering, dialogs, CRUD forms, schedule/archive, navigation |
| `js/platform.js` | My Clubs, signup/login screens, joining, switching, codes, create/delete club |
| `js/database.js` | Supabase queries, explicit club filters, RPC calls |
| `js/auth.js` | Supabase sessions, signup, password login, sign-out |
| `js/agenda-editor.js` | In-memory meeting drafts, point ordering, notes and versioned saves |
| `js/utils.js` | Date, archive, search and formatting helpers |
| `api/access.js` | Verified-account/guest code entry, trusted network bucket, server-only RPC |
| `api/account.js` | Server-only, bearer-verified Supabase Auth account deletion |
| `migrations/001_multi_club.sql` | BSU migration, relationships, permissions, codes and atomic agenda saves |

Registered content reads go directly to Supabase with a selected `club_id`. RLS independently checks access. The browser does not download all clubs' content and filter it afterward. Switching clubs immediately clears the previous club and private agenda state; late responses from an old selection are ignored.

Code entry goes through the server because a browser must not choose its own user ID or rate-limit bucket. The server verifies a supplied access token through Supabase Auth, hashes the trusted network address, and calls a service-role-only database function. A guest receives an unguessable, hashed-at-rest, expiring token. The guest data function accepts that token, **not a club ID**, and returns only a fixed member-facing projection.

## Database

| Table | Purpose |
| --- | --- |
| `clubs` | Club identity, description, creator, timestamps |
| `profiles` | Account first name and last initial |
| `app_admins` | Explicit platform-owner UUID allowlist |
| `club_memberships` | One member/officer row per club and account |
| `events` | Club-scoped meetings and other schedule items |
| `announcements` | Club-scoped updates |
| `club_settings` | One settings row per club, including name and theme |
| `meeting_agenda_items` | Ordered meeting points, talking text, secretary notes |
| `meeting_minutes` | Officer-only actual start/end times for meeting minutes |
| `event_officer_details`, `admins` | Preserved, locked legacy records |
| `private.club_access_codes` | Recoverable codes for intentional officer sharing |
| `private.guest_sessions` | Hashed guest tokens, club binding, expiry and generation |
| `private.code_attempts` | Persistent rate-limit counters |
| `private.legacy_bsu_snapshot` | Original rows retained for migration verification |

Foreign keys enforce club ownership. Memberships have a composite primary key; roles are constrained to `member`/`officer`. Agenda order is unique per meeting. Club/date and user/club indexes support scoped queries. Deleting a club cascades its active content, memberships, codes and guest sessions, **not Auth users**.

## Security model

- No anonymous table-wide content reads after migration. Guests use only the token-bound projection.
- Members read only their joined clubs and cannot modify content, memberships, or platform privileges.
- Officers have the same permissions within their own clubs only. There are no president/secretary/treasurer permission tiers.
- Only an explicitly assigned Super Admin can create/delete clubs. No account is automatically promoted.
- Private agendas and secretary notes are never returned by member or guest queries.
- Security-definer functions use a fixed empty search path, schema-qualified objects, and explicit execution grants.
- Old permissive policies are removed transactionally so they cannot combine with tenant policies.
- Agenda writes go through one version-checked transaction; direct browser table writes are revoked.
- Text is rendered with `textContent`, not HTML injection. Database field constraints supplement form validation.
- Code formats are exactly `MEM-000-000` and `OFI-000-000`, with secure random digits, leading zeros, separate namespaces, and unique active codes.
- Failed code attempts commit their rate counters. Current limits are 12 per IP hash, 12 per account, and 300 globally per 15 minutes.
- Rotation invalidates the old code without deleting registered memberships. Member-code rotation also invalidates its guest tokens.
- Browser code contains only public configuration. The service-role key stays in the server environment. Static builds use a file allowlist.
- Account deletion verifies the signed-in bearer token on the server and requires three client-side confirmations. The service-role key never reaches the browser.

See [Supabase's RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security) for the database mechanism. These tests verify this project's policies; they are not an independent security audit.

## Setup and deployment

Follow [docs/MIGRATION.md](docs/MIGRATION.md) for exact Supabase screens, backup checks, the owner UUID SQL, environment variables, and rollout verification.

Browser configuration in `js/config.js` uses exactly two browser-safe values:

1. `SUPABASE_URL`
2. `SUPABASE_PUBLISHABLE_KEY`

The new server code-entry endpoint additionally needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in Vercel's private environment. Never copy the service-role key into frontend code.

For a fresh empty development database, run `supabase-setup.sql`, then `migrations/001_multi_club.sql`, then `migrations/002_meeting_minutes_times.sql`. For the existing BSU database, run both migrations after backing up and checking the schema. Owner privileges require a separate explicit UUID insert.

### Local development

Use Node 22+ and pnpm:

```sh
pnpm install --frozen-lockfile
pnpm start
```

Open `http://127.0.0.1:4173`. For working code redemption, create an ignored `.env.local` from `.env.example`, fill in the server values privately, then start:

```sh
node --env-file=.env.local scripts/serve.mjs
```

Without server configuration, the code-entry form clearly reports the missing setup. There is no runtime demo-auth path. The local server serves only frontend files and the access endpoint.

### Vercel

Use the existing repository with framework preset **Other**. The checked-in configuration builds the static frontend into `dist` and deploys `api/access.js` as a Node function. Add the two server environment variables, deploy, and configure Supabase's Site URL and confirmation-email settings. Adding a custom domain later requires dashboard URL/DNS changes, not hardcoded frontend replacements.

Do not upload `dist` alone to a static-only host: club-code validation needs the server function.

## Testing

```sh
pnpm run check
pnpm run browser-check
pnpm run build
```

- Unit/contract checks cover date boundaries, search, payloads, tenant filters, exact password handling, settings, and safe API behavior.
- PGlite runs real PostgreSQL with simulated Supabase roles and `auth.uid()`. It applies the baseline and migration to an isolated test database, verifies preservation, then attempts forbidden queries and RPC calls.
- Headless Chrome/Edge tests use fixtures injected by the test runner, never live data. They exercise desktop and 375/390/430px layouts, navigation, auth forms, guest access, switching, CRUD, private agendas, code rotation, and Super Admin workflows.
- Generated screenshots are placed in ignored `test-artifacts/`.
- The local tests do **not** prove live email delivery, actual account passwords, production environment variables, provider limits, or deployment success. Complete the real-account smoke tests in the migration checklist.

## Project structure

```text
Club-Link/
  api/access.js
  assets/favicon.svg
  docs/MIGRATION.md
  docs/IMPLEMENTATION.md
  js/                     # Framework-free frontend modules
  migrations/001_multi_club.sql
  scripts/build.mjs
  scripts/serve.mjs
  styles/styles.css
  tests/                  # Unit, API, PostgreSQL RLS and browser tests
  index.html
  privacy.html
  terms.html
  supabase-setup.sql       # Legacy baseline, not the production upgrade
  .env.example            # Names only, no real secrets
  package.json
  pnpm-lock.yaml
  vercel.json
```

## Technical concepts demonstrated

CRUD; asynchronous JavaScript; authentication versus authorization; relational PostgreSQL design; multi-tenant RLS; foreign keys and constraints; secure server functions; rate limiting; bearer-token scope; transactional migrations; optimistic concurrency; safe DOM rendering; responsive/accessibility work; automated negative security tests; and static-plus-serverless deployment.

## Practical limits

Short reusable codes are intentionally easy to share. They are not equivalent to high-entropy invitations, and an Officer Code grants real editing power. Rate limits can also affect a group using shared school Wi-Fi. Before expanding to many clubs, review enrollment limits and add stronger abuse protection if needed.

Agenda drafts survive failed saves while the page remains open, but are not offline/crash-recoverable. Large clubs currently load their full selected-club schedule and announcement history; pagination is a future improvement. Account deletion removes the Auth account and cascaded memberships, while shared club content remains for the club. No billing, district management, or customizable role hierarchy is included.

## License

No open-source license is currently declared. Choose one before inviting outside reuse.
