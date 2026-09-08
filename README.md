# Club Link

Club Link is a focused web dashboard for a high school club. Members can check the closest scheduled event, browse upcoming meetings and activities, review previous events, read announcements, and find basic club information without needing an account. Authorized officers can sign in to manage that shared information.

The project is intentionally built with semantic HTML, CSS, and vanilla JavaScript so the application flow is understandable without a frontend framework.

## Why it exists

Club information is often split across messages, documents, and word of mouth. Club Link provides one public place for current logistics while keeping publishing controls restricted to approved officer accounts.

## Features

### For members

- A dashboard that automatically prioritizes the closest upcoming schedule item and newest announcement
- One chronological schedule for meetings, events, and other club activities
- Upcoming-event cards with text search and 30-day or 90-day filters
- A previous-events archive inside Club Information, ordered newest first
- An announcement feed ordered newest first
- Club description, joining instructions, and a contact address
- Purpose-built desktop and mobile layouts
- Useful loading, empty, setup, success, and error states

### For authorized officers

- Email and password login through Supabase Authentication
- Create, edit, and delete meetings or events in the shared schedule
- Choose **Meeting** or **Other** when adding a schedule item; Other reveals a custom event-name field
- Add private notes to meetings through an officer-only details section
- Manage previous events with the same edit and delete controls
- Create, edit, and delete announcements
- Update public club information
- Local-session sign out
- Database-enforced authorization through PostgreSQL Row Level Security

There is no public officer registration flow. Accounts are created and authorized by a project administrator in Supabase.

## Technology

- HTML5 for semantic page structure
- CSS for the design system and responsive layouts
- Vanilla JavaScript modules for state, rendering, CRUD, and authentication
- Supabase PostgreSQL for durable shared data
- Supabase Authentication for officer sessions
- PostgreSQL Row Level Security for authorization
- Vercel-compatible static deployment
- Node's built-in test runner for dependency-free project checks

The only browser dependency is Supabase's official JavaScript client, constrained to its current major version through jsDelivr. No service key or database password is used by the frontend.

## Architecture

`app.js` owns UI state, accessible dialogs, rendering, filtering, feedback, and form workflows. `database.js` is the only module that queries or changes application tables. `auth.js` handles sessions and reads the signed-in user's officer record. `utils.js` contains deterministic date and filter helpers that can be tested without a browser. Public schedule loading never requests private meeting notes; those are fetched separately only after officer authorization succeeds.

The browser does hide officer controls when a visitor is logged out or unauthorized, but that is only a usability feature. Security does not depend on hidden buttons. The SQL policies check the authenticated user's ID against the `admins` table for every insert, update, and delete.

## Database model

| Table | Purpose | Public access | Officer access |
| --- | --- | --- | --- |
| `events` | All dated schedule items, including upcoming and previous meetings or events | Select | Insert, update, delete |
| `event_officer_details` | Private notes attached to meetings | None | Select, insert, update, delete |
| `announcements` | Officer updates | Select | Insert, update, delete |
| `club_settings` | Club description, membership details, and contact information | Select | Insert, update |
| `admins` | Explicit officer allowlist | None | A user can read only their own role |

The `private.is_officer()` security-definer function is available only to authenticated database requests and is used inside write policies. It has a fixed empty `search_path`, and its object references are schema-qualified.

## Connect Supabase

Club Link needs exactly two browser-safe values:

1. `SUPABASE_URL`
2. `SUPABASE_PUBLISHABLE_KEY`

Find both in **Supabase Dashboard > Project Settings > API**. Depending on the Supabase dashboard version, the public key may be labeled **Publishable key** or the legacy **anon public key**.

1. Create a Supabase project.
2. Open **SQL Editor**, paste the complete contents of [`supabase-setup.sql`](supabase-setup.sql), and run it.
3. Open [`js/config.js`](js/config.js) and replace the two clearly labeled placeholder strings.
4. In **Authentication > Users**, create an officer login. Do not add a sign-up button to the public site.
5. Return to **SQL Editor** and run the officer authorization statement at the bottom of `supabase-setup.sql`, replacing `officer@example.com` with the account email.
6. Start the local site and test that account.

Never use a `service_role` key, database password, or other secret in `js/config.js`. The public key identifies the Supabase project; RLS decides what each request may do.

If Club Link was connected before event types and private meeting notes were added, rerun the complete SQL file once. Its idempotent migration adds the `event_type` column and the officer-only `event_officer_details` table without deleting existing events.

## Local development

Node 20 or newer is recommended. There are no packages to install.

```bash
npm start
```

Open `http://127.0.0.1:4173`.

Run the automated checks with:

```bash
npm run check
```

The checks verify required files and local paths, page metadata, anchor targets, RLS declarations, safe rendering conventions, event filtering, date helpers, and search behavior.

## Deploy to Vercel

### Vercel dashboard

1. Push this folder to a GitHub repository.
2. In Vercel, choose **Add New > Project** and import the repository.
3. Confirm the framework preset is **Other**. `vercel.json` already sets this explicitly.
4. Leave the build command empty and use the repository root as the output directory.
5. Deploy.

### Vercel CLI

If the Vercel CLI is already installed and authenticated:

```bash
vercel
```

`vercel.json` supplies clean URLs and conservative security headers. The application does not hard-code a deployment hostname, so a custom domain can be added later from the Vercel project settings without code changes.

## Security approach

- Every exposed table has Row Level Security enabled.
- Anonymous users receive only `SELECT` grants for public club content.
- Anonymous and unauthorized users receive no access to `event_officer_details`; its RLS policies call the same officer-authorization function used for content changes.
- Authenticated users still cannot write unless their user ID is in `admins` with an `officer` or `admin` role.
- Officer authorization is checked by the database for every write operation.
- The `admins` table cannot be modified from the browser.
- User-created content is rendered with `textContent`, not injected as HTML.
- Field length checks exist in both forms and PostgreSQL constraints.
- A Content Security Policy limits scripts, connections, images, frames, and forms.
- Sign out uses local scope so it ends the session on the current browser without unexpectedly signing out other devices.

## Project structure

```text
club-link/
├── assets/
│   └── favicon.svg
├── js/
│   ├── app.js
│   ├── auth.js
│   ├── config.js
│   ├── database.js
│   └── utils.js
├── scripts/
│   └── serve.mjs
├── styles/
│   └── styles.css
├── tests/
│   ├── project-check.mjs
│   └── utils.test.mjs
├── index.html
├── privacy.html
├── terms.html
├── supabase-setup.sql
├── vercel.json
└── package.json
```

## Technical concepts demonstrated

- CRUD operations across multiple PostgreSQL tables
- Promise-based asynchronous JavaScript and parallel data loading
- Session-based authentication with Supabase Auth
- Role-based authorization enforced through PostgreSQL RLS
- Relational database design, constraints, indexes, triggers, and policies
- Safe DOM rendering of database content
- Client-side searching and date-range filtering
- Responsive layout design and touch-friendly controls
- Accessible labels, landmarks, dialogs, keyboard focus, and live status messages
- Static hosting, deployment headers, and custom-domain readiness

## Customization before launch

After connecting Supabase, sign in as an authorized officer and use **Edit information** to replace the empty club description, membership instructions, and contact address. Then add the first schedule item and announcement. The repository intentionally ships without invented club names, officer names, dates, achievements, or statistics.

## License

This project does not currently declare an open-source license. Add one before inviting outside reuse or contributions.
