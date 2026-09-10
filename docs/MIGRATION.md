# Multi-club upgrade: operator checklist

This upgrades the existing database. **Do not reset Supabase, delete tables, recreate users, or rerun the single-club baseline on the current project.** The live database was inspected read-only; this repository does not claim that the live migration has already run.

## 1. Back up and plan a short maintenance window

In your existing Supabase project, open **Database > Backups** and confirm what recovery options your plan provides. If a managed backup is unavailable, export the affected tables from **Table Editor** and keep the exports privately: `events`, `announcements`, `club_settings`, `event_officer_details`, and `admins`. Account credentials are managed separately by Supabase Auth; do not delete/recreate them. Prefer testing the upgrade in a separate staging project first.

Record row counts and inspect your existing BSU content before running the migration:

```sql
select 'events' as table_name, count(*) from public.events
union all select 'announcements', count(*) from public.announcements
union all select 'club_settings', count(*) from public.club_settings
union all select 'event_officer_details', count(*) from public.event_officer_details
union all select 'admins', count(*) from public.admins;
```

The old frontend will stop reading anonymously as soon as the migration commits. Apply the SQL and deploy the new frontend together during a quiet period. Do not restore public policies to make an old deployment work.

## 2. Run the upgrade once

Open **Supabase > SQL Editor > New query**. Paste the entire contents of [`migrations/001_multi_club.sql`](../migrations/001_multi_club.sql), then choose **Run**.

It is a single transaction: errors roll back the changes. A completed migration refuses to rerun. Do not execute only selected lines. The migration expects the existing schema represented by this repository's baseline, including `event_type`, `secretary_notes`, `club_name`, and `color_scheme`. If your schema differs, stop and inspect the error before editing anything.

For a completely new, empty staging project only: run `supabase-setup.sql` first, then this migration. The baseline now refuses to run after multi-club installation.

After the multi-club migration succeeds, run [`migrations/002_meeting_minutes_times.sql`](../migrations/002_meeting_minutes_times.sql) as a second complete SQL operation. It adds officer-only start and end time fields for meeting minutes and extends the agenda save RPC atomically. It does not expose those fields to public members. The file is also a single transaction and refuses to run twice.

### What this does to BSU

- Creates a club with `legacy_key = 'bsu'` and the name Black Student Union.
- Attaches all existing events, announcements, settings, and private meeting-detail rows to its UUID. Existing row IDs, content, dates, and edit/creation timestamps are retained.
- Keeps legacy `meeting_*` settings columns if present. They are historical; the current schedule remains the source of the Next event card, as before this upgrade.
- Copies every existing `admins` account into a BSU `officer` membership. It does not automatically promote anyone to Super Admin.
- Imports each nonempty legacy agenda/minutes record as one talking point titled “Imported meeting record,” preserving both original text fields. Former meetings classified as Other retain their points, which become editable when changed back to Meeting.
- Keeps `event_officer_details` read-only for authorized officers and leaves `admins` as a locked legacy reference. New authorization does not use `admins`.
- Takes a private JSON snapshot of the original five tables for verification. This is an additional in-database audit copy, **not a substitute for an independent backup**.
- Does not change or delete any Supabase Auth account, email, or password.

## 3. Make only your existing account Super Admin

Open **Authentication > Users**, select your existing account, and copy its **User UID / ID**. Use the UUID, not your email and not an API key.

In **SQL Editor > New query**, replace the placeholder below with that exact UUID:

```sql
insert into public.app_admins (user_id)
values ('YOUR_EXISTING_AUTH_USER_UUID'::uuid)
on conflict (user_id) do nothing;
```

Check the result:

```sql
select user_id, created_at from public.app_admins;
```

Initially there should be exactly one row: yours. Do not copy all old officers into this table. Your existing BSU officer membership is also retained separately.

## 4. Verify the preserved data

Run this before officers start editing the new app. Every `unchanged` value should be `true`. It compares legacy columns and timestamps against the snapshot, excluding only the newly added `club_id`.

```sql
with current_rows as (
  select 'events' as source_table, coalesce(jsonb_agg(to_jsonb(t)-'club_id'),'[]') as records from public.events t
  union all select 'announcements', coalesce(jsonb_agg(to_jsonb(t)-'club_id'),'[]') from public.announcements t
  union all select 'club_settings', coalesce(jsonb_agg(to_jsonb(t)-'club_id'),'[]') from public.club_settings t
  union all select 'event_officer_details', coalesce(jsonb_agg(to_jsonb(t)-'club_id'),'[]') from public.event_officer_details t
  union all select 'admins', coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.admins t
)
select s.source_table,
       jsonb_array_length(s.records) as before_count,
       jsonb_array_length(c.records) as after_count,
       s.records @> c.records and c.records @> s.records as unchanged
from private.legacy_bsu_snapshot s join current_rows c using (source_table);

select c.name, m.user_id, m.role
from public.club_memberships m join public.clubs c on c.id=m.club_id
where c.legacy_key='bsu';

select e.id, e.name, a.title, a.talking_point, a.secretary_notes
from public.meeting_agenda_items a join public.events e on e.id=a.meeting_id;
```

Review the private notes only in a trusted environment. Do not publish screenshots containing codes, accounts, or meeting records.

## 5. Configure authentication

In **Authentication > Sign In / Providers**, enable the Email provider and allow new user signups. Keep **Confirm email** enabled. Require a minimum password length of at least 8 characters to match the registration form. Existing confirmed accounts keep working.

In **Authentication > URL Configuration**, set **Site URL** to your production site's origin. Add your exact local or staging URLs to the allowed redirect URLs when needed. When adding a custom domain later, update these settings. No Vercel hostname is hardcoded in the frontend.

Configure an appropriate email sender/SMTP service in Supabase before inviting the whole club. Test confirmation delivery to actual school email addresses; school filters and provider email limits are external to this application. See [Supabase Auth configuration](https://supabase.com/docs/guides/auth/general-configuration) and [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

## 6. Set browser and server configuration

The existing two browser values in `js/config.js` were preserved:

- `SUPABASE_URL`: the base project URL.
- `SUPABASE_PUBLISHABLE_KEY`: a publishable/browser-safe key for the same project.

Code redemption now needs a small server function so users cannot forge identities or reset the rate limiter. In **Vercel > your project > Settings > Environment Variables**, add:

| Server variable | Value |
| --- | --- |
| `SUPABASE_URL` | The same base Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | The project's server-only legacy `service_role` JWT key |

Find the service-role key under **Supabase > Project Settings > API Keys > Legacy anon/service_role API keys** (dashboard labels may vary). Add it only to Vercel's server environment. **Never put it in `config.js`, HTML, Git, a public environment variable, a screenshot, or a chat.** This implementation uses the service-role JWT for the server RPC; do not substitute the browser publishable key.

Enable these environment variables only for deployments that should use this database. Use a separate staging database for preview deployments that need write testing.

For local development, create an ignored `.env.local` using `.env.example`, fill the two server values privately, and run:

```sh
node --env-file=.env.local scripts/serve.mjs
```

Without server variables, ordinary signed-in club features still use Supabase directly, but code entry reports that server setup is missing. No mock login or demo data is used by the application.

## 7. Deploy and smoke-test

Use your existing Vercel project/repository connection. Framework preset: **Other**. Root directory: this project folder. `vercel.json` sets the build command to `node scripts/build.mjs` and the output directory to `dist`. Use Node 22 or newer. The root `api/access.js` is a separate Vercel Node function; do not deploy only `dist` to a static-only host. See [Vercel Node functions](https://vercel.com/docs/functions/runtimes/node-js).

Redeploy after adding the environment variables. No deployment was submitted automatically by this change.

Then test with real accounts:

1. Log in with your existing account. Confirm BSU and its original data. Open previous meetings and check imported agenda/minutes text.
2. As Super Admin, create a clearly named disposable test club. Open **Club access** to see both codes.
3. Create and confirm a separate test account. Join using the Member Code. Reload and sign in again; membership should remain.
4. Enter the Officer Code with that account. Check that its single membership upgrades. Test schedule, announcements, settings, and agendas.
5. Use an incognito guest window with the Member Code. Confirm it cannot show private agendas or codes. Refresh to require re-entry.
6. Rotate both codes and confirm old codes fail, new codes work, and existing memberships remain. Guest sessions from a rotated Member Code should fail their next data request.
7. Test the same person as officer in one club and member in another. Inspect network responses, not just button visibility.
8. Delete only your disposable test club using its exact-name confirmation. Verify BSU and all Auth accounts remain.

## Operational notes

- Rotate an Officer Code if it is shared accidentally. Rotation alone does not remove users who already redeemed it. The owner must review memberships and revoke inappropriate access separately.
- To revoke a specific membership, use Table Editor on `club_memberships` with both the exact `club_id` and `user_id` selected. Do not delete the Auth user just to remove one club membership. There is intentionally no complex roster-management system in this expansion.
- Code requests are limited to 12 per network-address hash, 12 per authenticated account, and 300 globally per 15-minute window. This intentionally favors security but can interrupt a large group on one school's shared network. Adjust the documented constants in a reviewed follow-up migration, or add a CAPTCHA, before large-scale enrollment.
- Six-digit reusable Officer Codes are shareable access credentials, not high-entropy invitations. For many clubs or public exposure, stronger abuse controls and monitoring are recommended. Never post Officer Codes on a public board.
- Agenda saves are atomic and reject stale versions. On conflicts, the draft remains visible; copy unsaved text before reopening the latest version. Drafts are in-memory, not crash-recoverable offline storage.
- Old snapshot retention is an owner decision. Do not delete the snapshot until preservation is verified and an independent backup exists. Club deletion removes active data but intentionally does not rewrite this historical BSU snapshot.
- If the migration fails, inspect the SQL error and confirm the transaction rolled back. If it succeeded, do not roll back just the frontend or rerun the baseline. Use a reviewed forward fix or restore a verified backup with the appropriate matching app version.
