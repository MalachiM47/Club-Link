# Membership and deletion update

Reviewed and approved for production. Migrations 004 and 005 were applied to the production Supabase project on September 11, 2026. For another installation, apply the database migrations before deploying the frontend.

## Changes

- Delete club: existing Super Admin permission is preserved. Type the exact club name in an inline form, then select Delete club.
- Delete account: type `Delete` in an inline form, then select Delete account. The existing server endpoint still verifies the signed-in account before deletion.
- Signup: hold the reveal button with a pointer, touch, Space, or Enter. Releasing, cancelling, leaving the button, switching tabs, or closing the form conceals the password.
- Members: officers can remove regular members using the × button and an inline confirmation. Only Super Admins can remove officers. Use Leave club for your own membership.
- Leave club: select Leave club, then confirm inline. Joining again requires a valid club code. Removal is not a permanent ban.
- An empty club is deleted after seven continuous days without registered members, including officers. Guest visitors and a Super Admin who has not joined do not count as members. Rejoining cancels the timer.
- Shared event records and attendance remain when someone leaves or is removed. Account deletion removes that account's attendance through existing cascading foreign keys.

## Deployment after review

The conditional last-member warning also requires `migrations/006_leave_club_warning.sql` before deploying its frontend change. It returns only whether the signed-in member is the last member, without exposing the member directory. Membership is checked when the Leave club confirmation opens.

1. Apply `migrations/004_membership_lifecycle.sql` once in the Supabase SQL editor as postgres. Existing empty clubs receive a fresh seven-day grace period; existing content is not deleted by this migration.
2. Apply `migrations/005_empty_club_schedule.sql`. This enables pg_cron and schedules the private cleanup function every minute. Deletion occurs on the first successful run after seven days. The schedule operates without a browser open. Reapplying the named schedule does not create duplicates.
3. Verify the job exists with `select jobname, schedule, active from cron.job where jobname = 'club-link-empty-club-cleanup';`. After its first run inspect `cron.job_run_details` for successful execution. Scheduling has not been exercised against production during local review.
4. Run `pnpm run check`, `pnpm run attendance-check`, `pnpm run membership-check`, `pnpm run browser-check`, and `pnpm run build`.
5. Commit and push the reviewed files to deploy through Vercel.

Browser checks use isolated fixtures and send no signup emails or account deletion requests to production. Database tests use PGlite and execute the real membership migration and cleanup function. Native iOS Safari and the production cron extension need a deployment smoke check.

The browser cannot set deletion timestamps, delete memberships directly, or invoke cleanup. Membership writes lock the club row to serialize changes with cleanup. The cleanup function checks both the timestamp and the absence of memberships before deleting.

Scheduler reference: https://supabase.com/docs/guides/cron/install
