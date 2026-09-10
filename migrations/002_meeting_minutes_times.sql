-- Apply after migrations/001_multi_club.sql.
-- Adds officer-only start/end times to meeting minutes without changing public event content.
begin;

create schema if not exists private;
create table if not exists private.club_link_migrations (version text primary key, applied_at timestamptz default now());
do $$ begin
  if exists (select 1 from private.club_link_migrations where version = '002_meeting_minutes_times') then
    raise exception '002_meeting_minutes_times is already applied. No changes were made.';
  end if;
end $$;

create table public.meeting_minutes (
  meeting_id uuid primary key references public.events(id) on delete cascade,
  meeting_started_time time without time zone,
  meeting_ended_time time without time zone,
  updated_at timestamptz not null default now(),
  check (
    (meeting_started_time is null and meeting_ended_time is null)
    or (meeting_started_time is not null and meeting_ended_time is not null and meeting_ended_time >= meeting_started_time)
  )
);
create trigger meeting_minutes_set_updated_at
before update on public.meeting_minutes
for each row execute function private.set_updated_at();

alter table public.meeting_minutes enable row level security;
revoke all on public.meeting_minutes from anon,authenticated;
grant select on public.meeting_minutes to authenticated;
create policy meeting_minutes_officer on public.meeting_minutes for select to authenticated
using (private.can_manage_meeting(meeting_id));

-- This overload keeps the existing agenda RPC contract intact while saving minutes
-- timing atomically with the ordered agenda and its optimistic concurrency check.
create or replace function public.save_meeting_agenda(
  p_meeting uuid,
  p_items jsonb,
  p_expected timestamptz,
  p_started_time time without time zone,
  p_ended_time time without time zone
) returns timestamptz language plpgsql security definer set search_path='' as $$
declare saved_version timestamptz;
begin
  if (p_started_time is null) <> (p_ended_time is null) then
    raise exception 'Start and end times must be entered together';
  end if;
  if p_started_time is not null and p_ended_time < p_started_time then
    raise exception 'The meeting end time must be after the start time';
  end if;

  saved_version := public.save_meeting_agenda(p_meeting,p_items,p_expected);
  insert into public.meeting_minutes(meeting_id,meeting_started_time,meeting_ended_time)
  values(p_meeting,p_started_time,p_ended_time)
  on conflict(meeting_id) do update set meeting_started_time=excluded.meeting_started_time,meeting_ended_time=excluded.meeting_ended_time;
  return (select updated_at from public.events where id = p_meeting);
end $$;

revoke all on function public.save_meeting_agenda(uuid,jsonb,timestamptz,time without time zone,time without time zone) from public,anon,authenticated;
grant execute on function public.save_meeting_agenda(uuid,jsonb,timestamptz,time without time zone,time without time zone) to authenticated;
insert into private.club_link_migrations(version) values('002_meeting_minutes_times');
commit;
