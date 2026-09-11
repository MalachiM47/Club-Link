-- Apply once, after 002. Existing schedule and secretary notes are preserved.
begin;
create table public.event_sessions (
 event_id uuid primary key references public.events(id) on delete cascade,
 actual_start_time timestamptz not null,
 actual_end_time timestamptz,
 duration_minutes numeric generated always as (extract(epoch from (actual_end_time-actual_start_time))/60) stored,
 status text generated always as (case when actual_end_time is null then 'active' else 'completed' end) stored,
 check(actual_end_time is null or actual_end_time>=actual_start_time)
);
create table public.attendance (
 event_id uuid not null references public.events(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 checked_in_at timestamptz not null default now(),
 primary key(event_id,user_id)
);
create index attendance_user_idx on public.attendance(user_id,event_id);
alter table public.event_sessions enable row level security;
alter table public.attendance enable row level security;
revoke all on public.event_sessions,public.attendance from anon,authenticated;
grant select on public.event_sessions,public.attendance to authenticated;
create policy sessions_read on public.event_sessions for select to authenticated using(exists(select 1 from public.events e where e.id=event_id and private.can_read_club(e.club_id)));
create policy attendance_read on public.attendance for select to authenticated using(exists(select 1 from public.events e where e.id=event_id and (private.can_manage_club(e.club_id) or (user_id=auth.uid() and private.can_read_club(e.club_id)))));

-- Every transition and check-in locks the same event row. An end and a
-- check-in cannot pass their status checks concurrently with each other.
create function public.event_action(p_event uuid,p_action text,p_start timestamptz default null,p_end timestamptz default null) returns void
language plpgsql security definer set search_path='' as $$
declare e public.events; s public.event_sessions;
begin
 select * into e from public.events where id=p_event for update;
 if not found or auth.uid() is null then raise exception 'Event unavailable'; end if;
 select * into s from public.event_sessions where event_id=p_event;
 if p_action='check_in' then
   if not exists(select 1 from public.club_memberships where club_id=e.club_id and user_id=auth.uid()) then raise exception 'Join this club before checking in'; end if;
   if s.event_id is null or s.actual_end_time is not null then raise exception 'This event is not active'; end if;
   insert into public.attendance(event_id,user_id) values(p_event,auth.uid()) on conflict do nothing;
   return;
 end if;
 if not private.can_manage_club(e.club_id) then raise exception 'Officer access required'; end if;
 if p_action='start' then
   if clock_timestamp()<e.event_date-interval '1 hour' then raise exception 'Start is available one hour before the scheduled event'; end if;
   if s.event_id is not null then raise exception 'Event already started'; end if;
   insert into public.event_sessions(event_id,actual_start_time) values(p_event,clock_timestamp());
 elsif p_action='end' then
   if s.event_id is null or s.actual_end_time is not null then raise exception 'Event is not active'; end if;
   update public.event_sessions set actual_end_time=clock_timestamp() where event_id=p_event;
 elsif p_action='edit' then
   if s.event_id is null then raise exception 'Start the event first'; end if;
   if p_start is null or p_start>clock_timestamp() or (p_end is not null and (p_end<p_start or p_end>clock_timestamp())) then raise exception 'Use valid past times with end at or after start'; end if;
   if (s.actual_end_time is null)<>(p_end is null) then raise exception 'Use End Event to complete an active event; completed events cannot be reopened'; end if;
   update public.event_sessions set actual_start_time=p_start,actual_end_time=p_end where event_id=p_event;
 else raise exception 'Unknown event action'; end if;
end $$;

create function public.club_activity(p_club uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.can_read_club(p_club) then raise exception 'Club access required'; end if;
 return jsonb_build_object(
 'sessions',coalesce((select jsonb_agg(to_jsonb(s)||case when private.can_manage_club(p_club) then jsonb_build_object('attendee_count',(select count(*) from public.attendance a where a.event_id=s.event_id)) else '{}'::jsonb end) from public.event_sessions s join public.events e on e.id=s.event_id where e.club_id=p_club),'[]'::jsonb),
 'checked_in',coalesce((select jsonb_agg(a.event_id) from public.attendance a join public.events e on e.id=a.event_id where e.club_id=p_club and a.user_id=auth.uid()),'[]'::jsonb),
 'attended',(select count(*) from public.attendance a join public.events e on e.id=a.event_id join public.event_sessions s on s.event_id=e.id where e.club_id=p_club and a.user_id=auth.uid() and s.actual_end_time is not null));
end $$;

create function public.club_officer_report(p_club uuid,p_event uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare held bigint; checkins bigint;
begin
 if auth.uid() is null or not private.can_manage_club(p_club) then raise exception 'Officer access required'; end if;
 if p_event is not null and not exists(select 1 from public.events where id=p_event and club_id=p_club) then raise exception 'Event unavailable'; end if;
 select count(*) into held from public.event_sessions s join public.events e on e.id=s.event_id where e.club_id=p_club and s.actual_end_time is not null;
 select count(*) into checkins from public.attendance a join public.events e on e.id=a.event_id join public.event_sessions s on s.event_id=e.id where e.club_id=p_club and s.actual_end_time is not null;
 return jsonb_build_object(
 'members',coalesce((select jsonb_agg(jsonb_build_object('first_name',coalesce(p.first_name,'Member'),'last_initial',coalesce(p.last_initial,'')) order by lower(p.first_name),p.last_initial,m.user_id) from public.club_memberships m left join public.profiles p on p.user_id=m.user_id where m.club_id=p_club),'[]'::jsonb),
 'attendees',coalesce((select jsonb_agg(jsonb_build_object('first_name',coalesce(p.first_name,'Member'),'last_initial',coalesce(p.last_initial,'')) order by lower(p.first_name),p.last_initial,a.user_id) from public.attendance a left join public.profiles p on p.user_id=a.user_id where a.event_id=p_event),'[]'::jsonb),
 'total_members',(select count(*) from public.club_memberships where club_id=p_club),
 'events_held',held,'check_ins',checkins,'average_attendance',case when held=0 then 0 else checkins::numeric/held end,
 'event_minutes',(select coalesce(sum(s.duration_minutes),0) from public.event_sessions s join public.events e on e.id=s.event_id where e.club_id=p_club and s.actual_end_time is not null));
end $$;
revoke all on function public.event_action(uuid,text,timestamptz,timestamptz),public.club_activity(uuid),public.club_officer_report(uuid,uuid) from public,anon;
grant execute on function public.event_action(uuid,text,timestamptz,timestamptz),public.club_activity(uuid),public.club_officer_report(uuid,uuid) to authenticated;
insert into private.club_link_migrations(version) values('003_attendance');
commit;
