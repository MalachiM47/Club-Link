-- Apply after 003_attendance. No existing accounts or clubs are deleted here.
begin;
alter table public.clubs add column empty_since timestamptz default now();
update public.clubs c set empty_since=case when exists(select 1 from public.club_memberships m where m.club_id=c.id) then null else now() end;

-- Serialize joins, leaves, account cascades and cleanup on the parent club.
create function private.lock_membership_club() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.club_id<>old.club_id then raise exception 'Move memberships by leaving and joining'; end if;
 perform 1 from public.clubs where id=case when tg_op='DELETE' then old.club_id else new.club_id end for update;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
create trigger membership_club_lock before insert or update or delete on public.club_memberships for each row execute function private.lock_membership_club();

create function private.track_empty_club() returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 target:=case when tg_op='DELETE' then old.club_id else new.club_id end;
 update public.clubs c set empty_since=case
   when exists(select 1 from public.club_memberships m where m.club_id=target) then null
   else coalesce(c.empty_since,clock_timestamp()) end where c.id=target;
 return null;
end $$;
create trigger membership_empty_club after insert or update or delete on public.club_memberships for each row execute function private.track_empty_club();

create function public.leave_club(p_club uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in first' using errcode='42501'; end if;
 perform 1 from public.clubs where id=p_club for update;
 delete from public.club_memberships where club_id=p_club and user_id=auth.uid();
 if not found then raise exception 'You are not a member of this club'; end if;
end $$;

create function public.remove_club_member(p_club uuid,p_user uuid) returns void language plpgsql security definer set search_path='' as $$
declare target_role text;
begin
 perform 1 from public.clubs where id=p_club for update;
 if auth.uid() is null or not private.can_manage_club(p_club) then raise exception 'Officer access required' using errcode='42501'; end if;
 if p_user=auth.uid() then raise exception 'Use Leave club to remove your own membership'; end if;
 select role into target_role from public.club_memberships where club_id=p_club and user_id=p_user;
 if not found then raise exception 'This person is no longer a member'; end if;
 if target_role='officer' and not private.is_super_admin() then raise exception 'Only a Super Admin can remove an officer' using errcode='42501'; end if;
 delete from public.club_memberships where club_id=p_club and user_id=p_user;
end $$;

-- Only the database scheduler/owner may run cleanup. Never exposed to browsers.
create function private.delete_expired_empty_clubs() returns integer language plpgsql security definer set search_path='' as $$
declare target uuid; removed integer:=0;
begin
 for target in select id from public.clubs where empty_since<=clock_timestamp()-interval '7 days' order by id for update skip locked loop
   delete from public.clubs c where c.id=target
     and c.empty_since<=clock_timestamp()-interval '7 days'
     and not exists(select 1 from public.club_memberships m where m.club_id=c.id);
   if found then removed:=removed+1; end if;
 end loop;
 return removed;
end $$;
revoke all on function private.lock_membership_club(),private.track_empty_club(),private.delete_expired_empty_clubs() from public,anon,authenticated,service_role;
revoke all on function public.leave_club(uuid),public.remove_club_member(uuid,uuid) from public,anon;
grant execute on function public.leave_club(uuid),public.remove_club_member(uuid,uuid) to authenticated;

create or replace function public.club_officer_report(p_club uuid,p_event uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare held bigint; checkins bigint;
begin
 if auth.uid() is null or not private.can_manage_club(p_club) then raise exception 'Officer access required'; end if;
 if p_event is not null and not exists(select 1 from public.events where id=p_event and club_id=p_club) then raise exception 'Event unavailable'; end if;
 select count(*) into held from public.event_sessions s join public.events e on e.id=s.event_id where e.club_id=p_club and s.actual_end_time is not null;
 select count(*) into checkins from public.attendance a join public.events e on e.id=a.event_id join public.event_sessions s on s.event_id=e.id where e.club_id=p_club and s.actual_end_time is not null;
 return jsonb_build_object(
 'members',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'role',m.role,'can_remove',(m.user_id<>auth.uid() and (m.role='member' or private.is_super_admin())),'first_name',coalesce(p.first_name,'Member'),'last_initial',coalesce(p.last_initial,'')) order by lower(p.first_name),p.last_initial,m.user_id) from public.club_memberships m left join public.profiles p on p.user_id=m.user_id where m.club_id=p_club),'[]'::jsonb),
 'attendees',coalesce((select jsonb_agg(jsonb_build_object('first_name',coalesce(p.first_name,'Member'),'last_initial',coalesce(p.last_initial,'')) order by lower(p.first_name),p.last_initial,a.user_id) from public.attendance a left join public.profiles p on p.user_id=a.user_id where a.event_id=p_event),'[]'::jsonb),
 'total_members',(select count(*) from public.club_memberships where club_id=p_club),
 'events_held',held,'check_ins',checkins,'average_attendance',case when held=0 then 0 else checkins::numeric/held end,
 'event_minutes',(select coalesce(sum(s.duration_minutes),0) from public.event_sessions s join public.events e on e.id=s.event_id where e.club_id=p_club and s.actual_end_time is not null));
end $$;

insert into private.club_link_migrations(version) values('004_membership_lifecycle');
commit;
