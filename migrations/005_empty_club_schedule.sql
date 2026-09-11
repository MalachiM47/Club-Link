-- Run after 004 using the Supabase SQL editor as postgres.
-- https://supabase.com/docs/guides/cron/install
begin;
create extension if not exists pg_cron with schema pg_catalog;
-- Named schedule is updated rather than duplicated if rerun.
select cron.schedule('club-link-empty-club-cleanup','* * * * *','select private.delete_expired_empty_clubs()');
commit;
