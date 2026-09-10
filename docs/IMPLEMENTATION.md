# Multi-club implementation report

## Status

The existing application has been expanded in this working project, run locally, and tested. **The live Supabase migration and Vercel deployment have not been performed.** The repository is ready for the operator steps in [MIGRATION.md](MIGRATION.md), not a claim that production has already been upgraded.

The prior live read-only inspection returned one BSU settings row, one event, and zero announcements through the public API. Private officer records, meeting notes, Auth accounts, and backup settings could not be inspected with the browser key. No live content, account, code, or permission was changed during implementation.

## What changed

- Added a landing screen with login, minimal account registration, and Member Code guest entry.
- Added My Clubs, per-club role labels, joining as member/officer, and club switching.
- Added a separate platform Super Admin permission, club creation, and exact-name-confirmed deletion.
- Preserved the existing dashboard, schedule, Meeting/Other event types, CRUD dialogs, announcements, color themes, club information, midnight archive, mobile navigation, favicon, and toast feedback.
- Refactored content requests to use the selected club ID. Club switches clear prior content and private state; outdated responses are ignored.
- Replaced the single agenda/minutes text areas with ordered talking points and per-point secretary notes. One meeting workspace supports adding, editing, deleting, reordering, and saving without opening a dialog per point.
- Added recoverable code display/copy/rotation for that club's officers, plus a server-only redemption endpoint and database rate limiting.
- Updated privacy/terms language, setup documentation, deployment configuration, and regression tests.

## Database changes

New public tables: `clubs`, `profiles`, `app_admins`, `club_memberships`, `meeting_agenda_items`, and officer-only `meeting_minutes`.

New private tables: `club_access_codes`, `guest_sessions`, `code_attempts`, `legacy_bsu_snapshot`, and `club_link_migrations`.

Modified existing tables:

| Table | Change |
| --- | --- |
| `events` | Required `club_id` foreign key, unique `(id, club_id)`, club/date index |
| `announcements` | Required `club_id` foreign key, club/posting-date index |
| `club_settings` | Required `club_id` becomes primary key; original `id` and any historical meeting columns remain |
| `event_officer_details` | Required `club_id`, composite event/club foreign key, read-only legacy access |
| `admins` | Existing rows retained; browser grants removed; no longer used for current authorization |

Memberships have a unique club/user primary key and only `member`/`officer` roles. Profiles and memberships reference Auth users. Club creator references use `ON DELETE SET NULL`; deleting a club does not delete accounts. Active club content and memberships cascade with club deletion. Agenda points reference their meeting event, have bounded text, and have unique ordering per meeting. Code formats and active uniqueness are database constraints. Tenant IDs cannot be reassigned through content updates.

## RLS and server boundaries

- Anonymous users have no direct table read/write grants for club content. A validated guest token exposes only that token's club through a fixed JSON projection.
- Members read normal content only in their memberships. They cannot write events, announcements, settings, membership roles, or platform roles.
- Officers manage normal content, agendas, and codes only in clubs where they have an officer membership.
- Super Admin is checked from `app_admins`, independently of memberships. Only this permission can invoke club creation/deletion. The table starts empty until the owner inserts their existing UUID.
- Private agendas are separate from member content. Direct agenda writes are revoked; a version-checked, atomic RPC validates officer access and applies the whole ordered list.
- Meeting start/end times live in the RLS-protected `meeting_minutes` table and are saved atomically with the agenda. Members cannot select or write them.
- Old permissive single-club policies are removed inside the migration transaction. Leaving them in place would make the new policies ineffective.
- Browser roles cannot modify memberships directly. Code redemption is executable only by the server's `service_role`; it upgrades one club/user row and never downgrades an existing officer.
- The server gets the account UUID from Supabase Auth's verified user response, never from request body fields. Its network rate-limit bucket is a keyed hash, not a client-supplied identifier.
- Security-definer functions have fixed search paths and explicit execution grants. Source files, environment files, migrations, and fixtures are excluded from the static build.

## BSU preservation

The migration creates the BSU club, backfills ownership on existing rows without changing their original IDs/text/dates/timestamps, and migrates the old officer allowlist into BSU officer memberships. It never recreates Auth users. Nonempty legacy agenda/minutes text is copied into an imported talking point without rewriting it. Former meetings classified as Other retain stored agenda records.

The original private details remain read-only, and a restricted snapshot stores the five original tables for an exact before/after comparison. Any historical `meeting_*` settings columns are retained but are not used as a second schedule. The current schedule still controls Next event and Previous events.

Preservation was verified using isolated migration fixtures. **Actual private BSU preservation must be checked after the owner runs the migration**, using the comparison query and UI checklist in MIGRATION.md.

## Authentication and codes

Signup collects only first name, last initial, email, and password. A database trigger creates the small profile from signup metadata. Email and password credentials stay with Supabase Auth; no custom table stores plaintext passwords. Existing accounts do not need new profile fields to log in. Login still uses `signInWithPassword`, trims email only, and logs only the Supabase error code/message, never the password.

Every club receives one `MEM-000-000` code and one `OFI-000-000` code. Generation uses cryptographically random UUID bits with rejection sampling, preserves leading zeros, and retries collisions. Validation normalizes case, whitespace, and separators, while keeping the two namespaces distinct. Full prefix formatting avoids ambiguity; six bare digits are interpreted only within the selected member/officer entry mode.

Codes are recoverable inside the unexposed private schema because officers must intentionally view/share them. They are not embedded in frontend source. Guest tokens, unlike the short display codes, are high-entropy tokens stored only as hashes in the database and only in memory in the tab. They expire after 8 hours, disappear on reload, and are bound to one club and member-code generation.

Failed code guesses increment persistent rate counters: 12 requests per IP hash, 12 per authenticated user, and 300 across the platform per 15 minutes. Invalid attempts return generic errors. Code rotation invalidates old codes while retaining registered memberships; member rotation also revokes old-generation guest tokens.

## Files

Added:

- `migrations/001_multi_club.sql`
- `migrations/002_meeting_minutes_times.sql`
- `api/access.js`
- `js/platform.js`, `js/agenda-editor.js`
- `scripts/build.mjs`
- `.env.example`, `pnpm-lock.yaml`
- `docs/MIGRATION.md`, `docs/IMPLEMENTATION.md`
- `tests/multi-club-rls.test.mjs`, `tests/access-api.test.mjs`, `tests/browser-fixture.js`

Updated existing frontend HTML/CSS and modules, legacy SQL safety guard, README/legal pages, server/build configuration, ignore files, package scripts, and existing tests. Existing browser configuration values were preserved.

## Test results

| Layer | Result and scope |
| --- | --- |
| Unit/contracts/API | 31 passing tests: dates/search/archive, config-based login, exact password handling, club-filtered queries and writes, settings, safe rendering contracts, API identity verification and error handling |
| PostgreSQL/RLS | Passing real PostgreSQL execution through PGlite with simulated Supabase roles/Auth schema, applied baseline and migration, preserved data/notes, role isolation, failed escalation, member/cross-club writes, private code/agenda protection, guest token binding, code rotation, duplicate upgrades, rate limiting, profile creation, atomic notes, concurrency conflicts, and scoped deletion |
| Browser | Passing headless Chrome/Edge fixture tests at 1440, 375, 390, and 430 pixels: login/signup, guest entry, My Clubs, switching roles, event/announcement create/edit/delete, settings changes, agenda add/edit/reorder/remove/save, failed-save draft retention, member-code rotation, Super Admin create/delete, navigation, long text, escaping, logout, empty/error states, legal pages, and overflow checks |
| Project/build | Required paths/imports, metadata/labels/anchors, JavaScript syntax, static build, and local server private-path denial checked |
| Visual review | Desktop/member and mobile agenda screenshots inspected; adjusted agenda action contrast and save-button sizing |

The browser fixtures are loaded only by tests. They do not substitute for the separate real PostgreSQL security tests. PGlite runs PostgreSQL locally but is not the hosted Supabase Auth/REST stack; live tokens, confirmation emails, provider configuration, and deployment still require the documented smoke tests.

## Required owner actions

1. Back up and review the existing Supabase tables.
2. Run the complete `001_multi_club.sql`, then the complete `002_meeting_minutes_times.sql`, in the existing project's SQL Editor.
3. Copy your existing Auth user UUID and insert only that UUID into `app_admins` using the template in MIGRATION.md.
4. Run the preservation comparison queries and confirm BSU membership/notes.
5. Configure email signup/confirmation and production Site URL in Supabase.
6. Add `SUPABASE_URL` and the server-only `SUPABASE_SERVICE_ROLE_KEY` to Vercel's environment. Keep the existing public frontend key separate.
7. Deploy the existing repository using the supplied build configuration, then test real accounts, guest entry, and a disposable club.

## Remaining concerns and limits

- Production migration/deployment and real-account email delivery are not verified yet. No credentials were invented and no live database changes were made.
- Reusable six-digit codes are intentionally shareable and have limited entropy. Keep Officer Codes private, rotate leaked codes, and separately revoke already-redeemed memberships. Add stronger abuse protection before broad public rollout.
- The conservative IP limit can interrupt enrollment on shared school Wi-Fi. Tune it deliberately rather than disabling rate limiting.
- Drafts are in-memory, not offline/crash-recoverable. Save before closing. Concurrent edits are rejected rather than silently overwriting another officer; conflict recovery requires retaining/copying the draft and reopening current data.
- Large selected-club histories currently load in full, subject to Supabase REST row limits. Pagination is not included.
- Membership revocation, account deletion, and snapshot/backup retention are owner-operated tasks. The retained BSU snapshot is not erased by club deletion and requires separate retention review.
- Existing third-party client/font delivery and Supabase/Vercel availability remain external dependencies. Browser checks intentionally block remote fonts and inject an isolated Supabase fixture for repeatability.
- An optional formatter installation was denied by the tool approval service. No formatter dependency was added; this does not block application functionality or the test suite.
