# Attendance and profile rollout

## Database

Back up first. On a database already running migrations 001 and 002, run the entire `migrations/003_attendance.sql` once in Supabase SQL Editor. Do not rerun the baseline or previous migrations. For a fresh staging database, apply baseline, 001, 002, then 003.

The migration adds `event_sessions` (one timing record per existing event) and `attendance` (one record per event/account). Club ownership is derived from the event foreign key, so a caller cannot supply a conflicting club ID. Existing events, announcements, meeting agendas, and manually entered secretary times remain intact. Old events do not automatically become completed attendance sessions or inflate statistics.

`event_action` handles start, end, corrected times, and check-in with an event-row lock. Writes to the two new tables are not granted to browser roles. RLS limits direct reads; report RPCs check membership or officer privileges. The existing Super Admin exception remains. Check-in requires an actual club membership, even for a Super Admin.

Duration is a stored generated value in minutes, including fractional minutes. Reports display at most one decimal place. Ended sessions cannot be reopened through the correction form. The original agenda time-of-day fields remain secretary notes; attendance statistics use the timestamp records in `event_sessions` exclusively.

## Auth and domain settings

No new environment variables or API secrets are needed. Use the existing Supabase project configuration.

Configure custom SMTP and keep email confirmation enabled. In Supabase Authentication URL Configuration, add the exact password recovery URL for each environment:

- Production: `https://YOUR_DOMAIN/?recovery=1`
- Local: `http://127.0.0.1:4173/?recovery=1`

If retaining the Vercel domain, add that origin with `/?recovery=1` as well. Set Site URL to the canonical production origin. The application generates redirect URLs from the current origin, so there is no domain hardcoded in the new feature. Keep secure email change enabled so Supabase handles confirmation. Custom recovery email templates must retain the confirmation link that supplies the recovery session, rather than linking directly to the page.

Open Profile by clicking the account avatar/name area. Name edits update the existing profiles table under self-only RLS. Email changes use Auth updateUser, not a separate email database field. Password changes verify the current password through an isolated, non-persistent Auth client before updating the main session's password. Reset links open a dedicated password form when Supabase emits PASSWORD_RECOVERY.

Signup recognizes explicit existing-user errors and empty-identity responses, and offers sign-in with the email filled in. Supabase may obscure existing accounts depending on confirmation settings, so exact duplicate detection cannot be guaranteed by the browser. The signup form always includes a sign-in option, which leads to Forgot password. No public email-lookup endpoint was added.

## Verification checklist

The new signup/duplicate-account and email-delivery flows are intentionally deferred until SMTP is ready. No live signup, recovery, or email-change requests were made for this change.

- Member: no Start/End/Reports buttons; check-in only while active; double-click creates one row; completed count changes only once the event ends.
- Officer: start is disabled until one hour before the scheduled time; early direct RPC calls also fail. Start, check-in, end, and inspect attendance.
- Second club: confirm officers cannot manage or read reports for a club where they are only members. Guests cannot check in or see reports.
- Timing: correct both timestamps on a completed event; check recalculated duration. Reject end-before-start, future timestamps, and reopening completed events.
- Privacy: inspect direct attendance queries as a member; only that member's records should return. Directory and stats RPCs must reject members. Names use first name and last initial; emails are not included.
- Stale page: end an event in another window; a later check-in must fail immediately at the database. Status refreshes every 30 seconds and when a visible tab resumes. Refresh attendance is also available manually.
- Stats: verify zero values before completion, per-club counts, total minutes, average check-ins per completed event, and attendance totals.
- Profile: change your name and check My Clubs and reopened officer reports. Request email change and verify confirmation before the new address replaces the old one.
- Password (after SMTP): reject a wrong current password or mismatched new passwords; test a valid reset link, an expired link, and a used link. Verify sign-in with the new password.
- Signup (after SMTP): try an existing confirmed email and follow sign-in to Forgot password. Try a new email and complete confirmation. Rate-limit errors must not imply successful registration.
- Mobile: inspect activity cards, reports, time forms, and Profile at 375, 390, and 430 pixels.

Run `pnpm run attendance-check` for isolated PostgreSQL authorization/timing tests. To run browser checks while leaving signup untested in PowerShell: `$env:SKIP_SIGNUP_TESTS='1'; pnpm run browser-check`.

Account deletion cascades attendance records, so historical attendance aggregates decrease when an account is deleted. No anonymous historical attendance records are retained.
