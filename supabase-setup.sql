-- Club Link database setup
-- Run this entire file once in Supabase Dashboard > SQL Editor.
-- It is safe to rerun when updating a development project.

begin;

create extension if not exists pgcrypto;
create schema if not exists private;

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null default 'other' check (event_type in ('meeting', 'other')),
  name text not null check (char_length(name) between 1 and 120),
  event_date timestamptz not null,
  location text not null check (char_length(location) between 1 and 160),
  description text check (description is null or char_length(description) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Add the type column when upgrading an existing Club Link database.
alter table public.events
add column if not exists event_type text not null default 'other'
check (event_type in ('meeting', 'other'));

create table if not exists public.event_officer_details (
  event_id uuid primary key references public.events(id) on delete cascade,
  notes text not null check (char_length(notes) between 1 and 4000),
  updated_at timestamptz not null default now()
);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 140),
  body text not null check (char_length(body) between 1 and 4000),
  posted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.club_settings (
  id smallint primary key default 1 check (id = 1),
  club_description text not null default 'Club details will be posted here soon.' check (char_length(club_description) between 1 and 1500),
  membership_info text not null default 'Membership information has not been posted yet.' check (char_length(membership_info) between 1 and 1000),
  contact_email text check (contact_email is null or char_length(contact_email) <= 254),
  updated_at timestamptz not null default now()
);

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'officer' check (role in ('officer', 'admin')),
  created_at timestamptz not null default now()
);

insert into public.club_settings (id)
values (1)
on conflict (id) do nothing;

create index if not exists events_event_date_idx on public.events (event_date);
create index if not exists announcements_posted_at_idx on public.announcements (posted_at desc);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists events_set_updated_at on public.events;
create trigger events_set_updated_at
before update on public.events
for each row execute function private.set_updated_at();

drop trigger if exists event_officer_details_set_updated_at on public.event_officer_details;
create trigger event_officer_details_set_updated_at
before update on public.event_officer_details
for each row execute function private.set_updated_at();

drop trigger if exists announcements_set_updated_at on public.announcements;
create trigger announcements_set_updated_at
before update on public.announcements
for each row execute function private.set_updated_at();

drop trigger if exists club_settings_set_updated_at on public.club_settings;
create trigger club_settings_set_updated_at
before update on public.club_settings
for each row execute function private.set_updated_at();

create or replace function private.is_officer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admins
    where user_id = (select auth.uid())
      and role in ('officer', 'admin')
  );
$$;

revoke all on schema private from public;
grant usage on schema private to authenticated;
revoke all on function private.is_officer() from public;
grant execute on function private.is_officer() to authenticated;

alter table public.events enable row level security;
alter table public.event_officer_details enable row level security;
alter table public.announcements enable row level security;
alter table public.club_settings enable row level security;
alter table public.admins enable row level security;

revoke all on table public.events from anon, authenticated;
revoke all on table public.event_officer_details from anon, authenticated;
revoke all on table public.announcements from anon, authenticated;
revoke all on table public.club_settings from anon, authenticated;
revoke all on table public.admins from anon, authenticated;

grant select on table public.events to anon, authenticated;
grant insert, update, delete on table public.events to authenticated;
grant select, insert, update, delete on table public.event_officer_details to authenticated;
grant select on table public.announcements to anon, authenticated;
grant insert, update, delete on table public.announcements to authenticated;
grant select on table public.club_settings to anon, authenticated;
grant insert, update on table public.club_settings to authenticated;
grant select on table public.admins to authenticated;

drop policy if exists "Public can read events" on public.events;
create policy "Public can read events"
on public.events for select
to anon, authenticated
using (true);

drop policy if exists "Officers can add events" on public.events;
create policy "Officers can add events"
on public.events for insert
to authenticated
with check ((select private.is_officer()));

drop policy if exists "Officers can update events" on public.events;
create policy "Officers can update events"
on public.events for update
to authenticated
using ((select private.is_officer()))
with check ((select private.is_officer()));

drop policy if exists "Officers can delete events" on public.events;
create policy "Officers can delete events"
on public.events for delete
to authenticated
using ((select private.is_officer()));

drop policy if exists "Officers can read private meeting details" on public.event_officer_details;
create policy "Officers can read private meeting details"
on public.event_officer_details for select
to authenticated
using ((select private.is_officer()));

drop policy if exists "Officers can add private meeting details" on public.event_officer_details;
create policy "Officers can add private meeting details"
on public.event_officer_details for insert
to authenticated
with check ((select private.is_officer()));

drop policy if exists "Officers can update private meeting details" on public.event_officer_details;
create policy "Officers can update private meeting details"
on public.event_officer_details for update
to authenticated
using ((select private.is_officer()))
with check ((select private.is_officer()));

drop policy if exists "Officers can delete private meeting details" on public.event_officer_details;
create policy "Officers can delete private meeting details"
on public.event_officer_details for delete
to authenticated
using ((select private.is_officer()));

drop policy if exists "Public can read announcements" on public.announcements;
create policy "Public can read announcements"
on public.announcements for select
to anon, authenticated
using (true);

drop policy if exists "Officers can add announcements" on public.announcements;
create policy "Officers can add announcements"
on public.announcements for insert
to authenticated
with check ((select private.is_officer()));

drop policy if exists "Officers can update announcements" on public.announcements;
create policy "Officers can update announcements"
on public.announcements for update
to authenticated
using ((select private.is_officer()))
with check ((select private.is_officer()));

drop policy if exists "Officers can delete announcements" on public.announcements;
create policy "Officers can delete announcements"
on public.announcements for delete
to authenticated
using ((select private.is_officer()));

drop policy if exists "Public can read club settings" on public.club_settings;
create policy "Public can read club settings"
on public.club_settings for select
to anon, authenticated
using (id = 1);

drop policy if exists "Officers can create club settings" on public.club_settings;
create policy "Officers can create club settings"
on public.club_settings for insert
to authenticated
with check (id = 1 and (select private.is_officer()));

drop policy if exists "Officers can update club settings" on public.club_settings;
create policy "Officers can update club settings"
on public.club_settings for update
to authenticated
using (id = 1 and (select private.is_officer()))
with check (id = 1 and (select private.is_officer()));

drop policy if exists "Users can read their own officer role" on public.admins;
create policy "Users can read their own officer role"
on public.admins for select
to authenticated
using ((select auth.uid()) = user_id);

commit;

-- AFTER RUNNING THIS FILE:
-- 1. Create each officer in Supabase Dashboard > Authentication > Users.
-- 2. Authorize that existing user by running this separately with their email:
--
-- insert into public.admins (user_id, role)
-- select id, 'officer'
-- from auth.users
-- where email = 'officer@example.com'
-- on conflict (user_id) do update set role = excluded.role;
--
-- To remove authorization without deleting the login account:
-- delete from public.admins
-- where user_id = (select id from auth.users where email = 'officer@example.com');

-- Shared officer-managed appearance settings.
alter table public.club_settings add column if not exists club_name text not null default 'Club Link' check (char_length(btrim(club_name)) between 1 and 80);
alter table public.club_settings add column if not exists color_scheme text not null default 'default' check (color_scheme in ('default','forest','plum','sunset'));

-- Keep legacy notes as the agenda; add separate secretary notes.
alter table public.event_officer_details add column if not exists secretary_notes text not null default '' check (char_length(secretary_notes) <= 4000);
alter table public.event_officer_details drop constraint if exists event_officer_details_notes_check;
alter table public.event_officer_details add constraint event_officer_details_notes_check check (char_length(notes) <= 4000);
