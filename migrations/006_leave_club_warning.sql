-- Apply before deploying the conditional leave-club warning.
begin;
create function public.is_last_club_member(p_club uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not exists(
    select 1 from public.club_memberships where club_id=p_club and user_id=auth.uid()
  ) then
    raise exception 'Club membership required' using errcode='42501';
  end if;
  return not exists(select 1 from public.club_memberships where club_id=p_club and user_id<>auth.uid());
end $$;
revoke all on function public.is_last_club_member(uuid) from public,anon;
grant execute on function public.is_last_club_member(uuid) to authenticated;
insert into private.club_link_migrations(version) values('006_leave_club_warning');
commit;
