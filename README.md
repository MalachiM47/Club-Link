# Club Link

Club Link is a multi-club information hub for school organizations. Members can find the next scheduled event, upcoming events, announcements, club details, and previous events in one place. Officers can manage the schedule and announcements after signing in with an authorized account.

The project is intentionally built with HTML, CSS, and vanilla JavaScript so the code is easy to understand, maintain, and extend. Supabase provides authentication, PostgreSQL storage, and Row Level Security (RLS). Vercel hosts the static frontend and server functions.

## What it includes

- A responsive dashboard for phones, tablets, and desktop screens.
- My Clubs, member-code joining, temporary guest access, and club switching.
- Email/password authentication through Supabase Auth.
- Meeting and Other event types, chronological upcoming events, search, filters, and previous events.
- Officer CRUD controls for events, announcements, and club information.
- Officer-only meeting agendas, secretary notes, and actual start/end times.
- Officer access-code viewing and rotation.
- Explicit Super Admin controls for creating and deleting clubs.
- Loading, empty, error, confirmation, and success states.
- Accessible dialogs, labels, keyboard controls, visible focus styles, a custom SVG favicon, Privacy Policy, and Terms of Use pages.

There is no mock login, demo account, fake statistics, or fake club data in the runtime application.

## Technology

- HTML5, CSS3, and native ES modules
- Vanilla JavaScript
- Supabase JavaScript client v2
- Supabase Auth and PostgreSQL
- PostgreSQL Row Level Security
- Node.js 22+
- Vercel static hosting and Node serverless functions
- PGlite for isolated PostgreSQL/RLS tests
- Git-friendly, framework-free project structure

## How the application is organized

The browser loads the public Supabase URL and publishable key from `js/config.js`. It never receives a service-role key. Normal club reads and officer writes go through Supabase queries or database RPCs, and RLS checks the signed-in user's membership and role.

The two server functions are deliberately small:

- `api/access.js` handles member/officer code redemption, guest-token creation, authentication checks, and rate limiting.
- `api/account.js` verifies the signed-in bearer token before requesting account deletion from the private Supabase Auth admin endpoint.

The selected club is always included in database queries. Switching clubs clears the previous club's state before loading the new one. Private agenda data is only requested for officers.

## Database and authorization

The main tables are:

| Table | Purpose |
| --- | --- |
| `clubs` | Club identity and description |
| `profiles` | Account first name and last initial |
| `app_admins` | Explicit platform Super Admin allowlist |
| `club_memberships` | Member or officer access per club |
| `events` | Meetings and other scheduled events |
| `announcements` | Club updates |
| `club_settings` | Club name, description, contact, and theme |
| `meeting_agenda_items` | Officer-only agenda points and secretary notes |
| `meeting_minutes` | Officer-only meeting start and end times |

Private schemas store access codes, guest sessions, and rate-limit counters. Foreign keys and constraints keep records scoped to their club.

RLS rules enforce the important boundaries in the database, not just in the interface:

- Public users can read only public club information through the supported access paths.
- Members cannot create, edit, or delete club content.
- Officers can manage content only for clubs where they are officers.
- Super Admin privileges are granted only through an explicit `app_admins` row.
- Guests receive a short-lived token-bound public projection and never receive private agenda data.

For an existing single-club database, read [docs/MIGRATION.md](docs/MIGRATION.md) before running SQL. Do not reset the database or rerun the baseline setup against an existing project.

## Local development

Requirements: Node.js 22 or newer and pnpm.

```sh
pnpm install --frozen-lockfile
pnpm start
```

Open `http://127.0.0.1:4173`.

The browser needs these two public values in `js/config.js`:

```js
export const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'YOUR_PUBLISHABLE_KEY';
```

For member/officer code redemption and account deletion during local development, copy `.env.example` to an ignored `.env.local` and add the server-only values:

```text
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY
```

Then run:

```sh
node --env-file=.env.local scripts/serve.mjs
```

Never place the service-role key in `js/config.js`, HTML, Git, a public environment variable, or a screenshot.

## Supabase setup

For a new, empty development database:

1. Run `supabase-setup.sql` once.
2. Run `migrations/001_multi_club.sql` once.
3. Run `migrations/002_meeting_minutes_times.sql` once.
4. Add the intended platform owner's Auth user UUID to `public.app_admins`.
5. Confirm Email authentication is enabled and configure the Site URL and allowed redirect URLs.

For the existing club database, use the backup and verification procedure in [docs/MIGRATION.md](docs/MIGRATION.md). The migrations are transactional and are not designed to be run repeatedly.

## Deployment with Vercel

1. Push the repository to GitHub.
2. Import the repository into Vercel.
3. Use the **Other** framework preset.
4. Keep the project root as the repository root.
5. Add these private Vercel environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
6. Deploy with Node.js 22 or newer.
7. In Supabase Auth, set the production Site URL and confirmation-email settings.

`vercel.json` runs `node scripts/build.mjs`, outputs the allowlisted frontend files to `dist`, and leaves `api/access.js` and `api/account.js` as serverless functions. Do not upload only `dist` to a static-only host because code redemption and account deletion require the server functions.

Custom domains can be added later through Vercel and Supabase Auth settings. The frontend does not hard-code a Vercel hostname.

## Testing

Run the automated checks with:

```sh
pnpm run check
pnpm run browser-check
pnpm run build
```

The test suite covers:

- Date handling, event filtering, previous-event archiving, and search.
- Supabase query scoping and payload construction.
- Password handling and authentication error logging.
- API validation, bearer-token checks, rate limiting, and account deletion.
- PostgreSQL migrations, RLS isolation, memberships, guest access, code rotation, and concurrent agenda saves.
- Browser workflows for login, signup, guest access, club switching, CRUD, agendas, navigation, legal pages, and responsive layouts at 375px, 390px, 430px, and desktop widths.

Tests use isolated fixtures and databases. They do not prove live email delivery, real production credentials, Supabase plan limits, or a successful Vercel deployment. Those require a small real-account smoke test after setup.

## Project structure

```text
Club-Link/
├── api/
│   ├── access.js
│   └── account.js
├── assets/
│   └── favicon.svg
├── docs/
│   ├── IMPLEMENTATION.md
│   └── MIGRATION.md
├── js/
│   ├── app.js
│   ├── agenda-editor.js
│   ├── auth.js
│   ├── branding.js
│   ├── config.js
│   ├── database.js
│   ├── platform.js
│   └── utils.js
├── migrations/
│   ├── 001_multi_club.sql
│   └── 002_meeting_minutes_times.sql
├── scripts/
├── styles/styles.css
├── tests/
├── index.html
├── privacy.html
├── terms.html
├── supabase-setup.sql
├── vercel.json
└── package.json
```

## Technical concepts demonstrated

Club Link demonstrates CRUD, asynchronous JavaScript, authentication versus authorization, relational PostgreSQL design, multi-tenant RLS, foreign keys and constraints, secure server functions, rate limiting, token-scoped guest access, transactional migrations, optimistic concurrency, safe DOM rendering, responsive accessibility, automated negative tests, and static-plus-serverless deployment.

## Known limits

Access codes are intentionally short and shareable, so an officer code should be treated like a real credential. Rate limits can affect users on a shared school network. Agenda drafts are kept in memory while the page is open and are not offline or crash recovery storage. The application currently loads the selected club's full event and announcement history rather than paginating it.

## License

No open-source license has been declared yet. Add a license before accepting outside contributions or reuse.
