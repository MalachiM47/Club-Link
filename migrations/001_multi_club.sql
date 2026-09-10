-- Apply ONCE after the existing single-club setup. Run the whole file in one operation.
-- No Auth users or content rows are deleted. A failure rolls back the entire migration.
begin;
create schema if not exists private;
create table if not exists private.club_link_migrations (version text primary key, applied_at timestamptz default now());
do $$ begin
  if exists (select 1 from private.club_link_migrations where version = '001_multi_club') then
    raise exception '001_multi_club is already applied. No changes were made.';
  end if;
end $$;

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 1500),
  legacy_key text unique,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create table public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
-- Deliberately empty: only the owner UUID explicitly supplied by the operator is promoted.
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null check (char_length(btrim(first_name)) between 1 and 60),
  last_initial text not null check (char_length(btrim(last_initial)) = 1),
  created_at timestamptz not null default now()
);
create table public.club_memberships (
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('member','officer')),
  joined_at timestamptz not null default now(),
  primary key (club_id,user_id)
);
create index club_memberships_user_idx on public.club_memberships(user_id,club_id);

-- A private, immutable-in-the-app copy retains legacy fields verbatim for migration audits.
create table private.legacy_bsu_snapshot (source_table text primary key, records jsonb not null);
insert into private.legacy_bsu_snapshot values
 ('club_settings',(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from public.club_settings s)),
 ('events',(select coalesce(jsonb_agg(to_jsonb(e)),'[]') from public.events e)),
 ('announcements',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from public.announcements a)),
 ('event_officer_details',(select coalesce(jsonb_agg(to_jsonb(d)),'[]') from public.event_officer_details d)),
 ('admins',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from public.admins a));
insert into public.clubs(name,description,legacy_key)
select 'Black Student Union',coalesce((select club_description from public.club_settings where id=1),''),'bsu';

alter table public.events add column club_id uuid references public.clubs(id) on delete cascade;
alter table public.announcements add column club_id uuid references public.clubs(id) on delete cascade;
alter table public.club_settings add column club_id uuid references public.clubs(id) on delete cascade;
alter table public.event_officer_details add column club_id uuid references public.clubs(id) on delete cascade;
-- Adding ownership is not a content edit: preserve the original edit timestamps.
alter table public.events disable trigger events_set_updated_at;
alter table public.announcements disable trigger announcements_set_updated_at;
alter table public.club_settings disable trigger club_settings_set_updated_at;
alter table public.event_officer_details disable trigger event_officer_details_set_updated_at;
update public.events set club_id=(select id from public.clubs where legacy_key='bsu');
update public.announcements set club_id=(select id from public.clubs where legacy_key='bsu');
update public.club_settings set club_id=(select id from public.clubs where legacy_key='bsu');
update public.event_officer_details d set club_id=e.club_id from public.events e where e.id=d.event_id;
alter table public.events enable trigger events_set_updated_at;
alter table public.announcements enable trigger announcements_set_updated_at;
alter table public.club_settings enable trigger club_settings_set_updated_at;
alter table public.event_officer_details enable trigger event_officer_details_set_updated_at;
alter table public.events alter column club_id set not null;
alter table public.announcements alter column club_id set not null;
alter table public.club_settings alter column club_id set not null;
alter table public.event_officer_details alter column club_id set not null;
alter table public.club_settings drop constraint club_settings_pkey;
alter table public.club_settings add primary key(club_id);
-- The legacy id=1 and meeting_* columns remain intact, but no longer identify all clubs.
alter table public.events add constraint events_id_club_unique unique(id,club_id);
alter table public.event_officer_details add constraint details_event_club_fk
 foreign key(event_id,club_id) references public.events(id,club_id) on delete cascade;
create index events_club_date_idx on public.events(club_id,event_date);
create index announcements_club_date_idx on public.announcements(club_id,posted_at desc);
insert into public.club_memberships(club_id,user_id,role)
select c.id,a.user_id,'officer' from public.clubs c cross join public.admins a where c.legacy_key='bsu';

create table public.meeting_agenda_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.events(id) on delete cascade,
  title text not null check(char_length(btrim(title)) between 1 and 200),
  talking_point text not null default '' check(char_length(talking_point)<=4000),
  secretary_notes text not null default '' check(char_length(secretary_notes)<=4000),
  sort_order integer not null check(sort_order>=0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(meeting_id,sort_order) deferrable initially deferred
);
-- Preserve the old free-form agenda and minutes as one editable imported talking point.
insert into public.meeting_agenda_items(meeting_id,title,talking_point,secretary_notes,sort_order)
select d.event_id,'Imported meeting record',d.notes,d.secretary_notes,0
from public.event_officer_details d join public.events e on e.id=d.event_id
where d.notes<>'' or d.secretary_notes<>'';
-- If a former meeting was changed to Other, its imported points remain stored and
-- become editable again if an officer changes that schedule item back to Meeting.

create function private.is_super_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.app_admins where user_id=(select auth.uid()));
$$;
create function private.can_manage_club(p_club uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.is_super_admin() or exists(select 1 from public.club_memberships
 where club_id=p_club and user_id=(select auth.uid()) and role='officer');
$$;
create function private.can_read_club(p_club uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.is_super_admin() or exists(select 1 from public.club_memberships
 where club_id=p_club and user_id=(select auth.uid()));
$$;
create function private.can_manage_meeting(p_meeting uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.events where id=p_meeting and event_type='meeting' and private.can_manage_club(club_id));
$$;

-- Remove ALL single-club policies on affected tables. Otherwise an old permissive
-- policy would be OR-ed with the new tenant policies and expose other clubs.
do $$ declare r record; begin
 for r in select tablename,policyname from pg_policies where schemaname='public'
 and tablename in ('events','announcements','club_settings','event_officer_details','admins') loop
   execute format('drop policy %I on public.%I',r.policyname,r.tablename);
 end loop;
end $$;
revoke all on public.admins from anon,authenticated;
revoke all on public.event_officer_details from anon,authenticated;
-- Retained historical notes are readable by that club's officers, but are no longer edited.
grant select on public.event_officer_details to authenticated;
create policy legacy_notes_read on public.event_officer_details for select to authenticated using(private.can_manage_club(club_id));

do $$ declare t text; begin
 foreach t in array array['clubs','app_admins','profiles','club_memberships','meeting_agenda_items','events','announcements','club_settings'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
 end loop;
end $$;
grant select on public.clubs,public.app_admins,public.club_memberships to authenticated;
grant select,insert,update on public.profiles to authenticated;
grant select,insert,update,delete on public.events,public.announcements,public.meeting_agenda_items to authenticated;
grant select,update on public.club_settings to authenticated;
create policy clubs_read on public.clubs for select to authenticated using(private.can_read_club(id));
create policy admin_self_read on public.app_admins for select to authenticated using(user_id=(select auth.uid()));
create policy membership_self_read on public.club_memberships for select to authenticated using(user_id=(select auth.uid()) or private.is_super_admin());
create policy profile_self on public.profiles for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy event_read on public.events for select to authenticated using(private.can_read_club(club_id));
create policy event_write on public.events for all to authenticated using(private.can_manage_club(club_id)) with check(private.can_manage_club(club_id));
create policy announcement_read on public.announcements for select to authenticated using(private.can_read_club(club_id));
create policy announcement_write on public.announcements for all to authenticated using(private.can_manage_club(club_id)) with check(private.can_manage_club(club_id));
create policy settings_read on public.club_settings for select to authenticated using(private.can_read_club(club_id));
create policy settings_update on public.club_settings for update to authenticated using(private.can_manage_club(club_id)) with check(private.can_manage_club(club_id));
create policy agenda_officer on public.meeting_agenda_items for all to authenticated using(private.can_manage_meeting(meeting_id)) with check(private.can_manage_meeting(meeting_id));

-- Content may not be moved to another tenant, even by an officer of both clubs.
create function private.keep_club_id() returns trigger language plpgsql set search_path='' as $$
begin if new.club_id<>old.club_id then raise exception 'Club ownership cannot be changed' using errcode='42501'; end if; return new; end $$;
create trigger events_keep_club before update on public.events for each row execute function private.keep_club_id();
create trigger announcements_keep_club before update on public.announcements for each row execute function private.keep_club_id();
create trigger settings_keep_club before update on public.club_settings for each row execute function private.keep_club_id();
create function private.sync_club_info() returns trigger language plpgsql security definer set search_path='' as $$
begin update public.clubs set name=new.club_name,description=new.club_description where id=new.club_id; return new; end $$;
create trigger settings_sync_club after update on public.club_settings for each row execute function private.sync_club_info();

create function private.create_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if nullif(btrim(new.raw_user_meta_data->>'first_name'),'') is not null then
  insert into public.profiles(user_id,first_name,last_initial) values
   (new.id,btrim(new.raw_user_meta_data->>'first_name'),upper(btrim(new.raw_user_meta_data->>'last_initial')));
 end if;
 return new;
end $$;
create trigger club_link_profile after insert on auth.users for each row execute function private.create_profile();

-- Codes must be recoverable for intentional officer sharing. Store them only in the
-- unexposed private schema; NO browser role has direct table access.
create table private.club_access_codes (
 club_id uuid not null references public.clubs(id) on delete cascade,
 kind text not null check(kind in ('member','officer')),
 code text not null unique,
 generation uuid not null default gen_random_uuid(),
 primary key(club_id,kind),
 check((kind='member' and code ~ '^MEM-[0-9]{3}-[0-9]{3}$') or (kind='officer' and code ~ '^OFI-[0-9]{3}-[0-9]{3}$'))
);
create table private.code_attempts (bucket text primary key, starts_at timestamptz not null, attempts integer not null);
create table private.guest_sessions (
 token_hash text primary key,
 club_id uuid not null references public.clubs(id) on delete cascade,
 generation uuid not null,
 expires_at timestamptz not null
);
create index guest_session_expiry on private.guest_sessions(expires_at);
create function private.generate_code(p_club uuid,p_kind text) returns text language plpgsql security definer set search_path='' as $$
declare n bigint; digits text; result text; begin
 if p_kind not in ('member','officer') then raise exception 'Invalid code type'; end if;
 for i in 1..100 loop
  -- UUID v4 contains cryptographically random bits. Rejection avoids modulo bias.
  n := ('x'||substr(replace(gen_random_uuid()::text,'-',''),1,6))::bit(24)::bigint;
  if n>=16000000 then continue; end if;
  digits:=lpad((n%1000000)::text,6,'0');
  result:=(case p_kind when 'member' then 'MEM-' else 'OFI-' end)||substr(digits,1,3)||'-'||substr(digits,4,3);
  begin
   if exists(select 1 from private.club_access_codes where code=result) then continue; end if;
   insert into private.club_access_codes(club_id,kind,code) values(p_club,p_kind,result)
   on conflict(club_id,kind) do update set code=excluded.code,generation=gen_random_uuid();
   return result;
  exception when unique_violation then continue;
  end;
 end loop;
 raise exception 'Could not generate code. Try again.';
end $$;
select private.generate_code(id,'member'),private.generate_code(id,'officer') from public.clubs;

create function public.create_club(p_name text,p_description text default '') returns uuid language plpgsql security definer set search_path='' as $$
declare c uuid; begin
 if not private.is_super_admin() then raise exception 'Permission denied' using errcode='42501'; end if;
 insert into public.clubs(name,description,created_by) values(btrim(p_name),btrim(p_description),auth.uid()) returning id into c;
 insert into public.club_settings(club_id,club_name,club_description) values(c,btrim(p_name),coalesce(nullif(btrim(p_description),''),'Club information has not been posted yet.'));
 perform private.generate_code(c,'member'); perform private.generate_code(c,'officer');
 return c;
end $$;
create function public.delete_club(p_club uuid,p_confirmation text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.is_super_admin() then raise exception 'Permission denied' using errcode='42501'; end if;
 if not exists(select 1 from public.clubs where id=p_club and name=p_confirmation) then raise exception 'Enter the exact club name'; end if;
 delete from public.clubs where id=p_club;
end $$;
create function public.get_club_codes(p_club uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not private.can_manage_club(p_club) then raise exception 'Permission denied' using errcode='42501'; end if;
 return (select jsonb_object_agg(kind,code) from private.club_access_codes where club_id=p_club);
end $$;
create function public.regenerate_club_code(p_club uuid,p_kind text) returns text language plpgsql security definer set search_path='' as $$
begin
 if not private.can_manage_club(p_club) then raise exception 'Permission denied' using errcode='42501'; end if;
 return private.generate_code(p_club,p_kind);
end $$;

create function private.allow_code_attempt(p_bucket text,p_limit integer) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer; begin
 insert into private.code_attempts(bucket,starts_at,attempts) values(p_bucket,now(),1)
 on conflict(bucket) do update set
 attempts=case when private.code_attempts.starts_at<now()-interval '15 minutes' then 1 else private.code_attempts.attempts+1 end,
 starts_at=case when private.code_attempts.starts_at<now()-interval '15 minutes' then now() else private.code_attempts.starts_at end
 returning attempts into n;
 return n<=p_limit;
end $$;
-- ONLY the server can call this RPC. p_user is taken from Auth /user, never the request body.
-- Invalid attempts return JSON, not exceptions, so rate counters commit on failure.
create function public.redeem_club_code(p_code text,p_kind text,p_user uuid,p_ip_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.club_access_codes%rowtype; normalized text; old_role text; token text; limited boolean; begin
 delete from private.code_attempts where starts_at<now()-interval '1 day';
 delete from private.guest_sessions where expires_at<now();
 limited := not private.allow_code_attempt('ip:'||p_ip_hash,12);
 if p_user is not null then limited := (not private.allow_code_attempt('user:'||p_user,12)) or limited; end if;
 -- Global ceiling also bounds distributed guessing against this short-code namespace.
 limited := (not private.allow_code_attempt('global',300)) or limited;
 if limited then return jsonb_build_object('error','rate_limited'); end if;
 if p_kind not in ('member','officer') or (p_kind='officer' and p_user is null) then return jsonb_build_object('error','invalid_code'); end if;
 if p_user is not null and not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null) then
  return jsonb_build_object('error','sign_in_required');
 end if;
 normalized:=upper(regexp_replace(p_code,'[\s-]','','g'));
 if normalized ~ '^[0-9]{6}$' then normalized:=(case p_kind when 'member' then 'MEM' else 'OFI' end)||normalized; end if;
 if normalized !~ (case p_kind when 'member' then '^MEM[0-9]{6}$' else '^OFI[0-9]{6}$' end) then return jsonb_build_object('error','invalid_code'); end if;
 normalized:=substr(normalized,1,3)||'-'||substr(normalized,4,3)||'-'||substr(normalized,7,3);
 select * into c from private.club_access_codes where kind=p_kind and code=normalized for share;
 if not found then return jsonb_build_object('error','invalid_code'); end if;
 if p_user is null then
  token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
  insert into private.guest_sessions values(encode(sha256(convert_to(token,'UTF8')),'hex'),c.club_id,c.generation,now()+interval '8 hours');
  return jsonb_build_object('club_id',c.club_id,'guest_token',token);
 end if;
 select role into old_role from public.club_memberships where club_id=c.club_id and user_id=p_user;
 insert into public.club_memberships(club_id,user_id,role) values(c.club_id,p_user,p_kind)
 on conflict(club_id,user_id) do update set role=case when club_memberships.role='officer' then 'officer' else excluded.role end;
 return jsonb_build_object('club_id',c.club_id,'already_joined',old_role is not null,'already_officer',old_role='officer','upgraded',old_role='member' and p_kind='officer');
end $$;

-- Guest token grants only a fixed, member-facing projection for its associated club.
-- There is deliberately no caller-selected club ID and no private-data joins.
create function public.guest_club_data(p_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c uuid; begin
 select s.club_id into c from private.guest_sessions s join private.club_access_codes k
 on k.club_id=s.club_id and k.kind='member' and k.generation=s.generation
 where s.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') and s.expires_at>now();
 if c is null then raise exception 'Guest access expired. Enter a Member Code again.' using errcode='42501'; end if;
 return jsonb_build_object(
 'club',(select jsonb_build_object('id',id,'name',name,'description',description) from public.clubs where id=c),
 'settings',(select jsonb_build_object('club_id',club_id,'club_name',club_name,'color_scheme',color_scheme,'club_description',club_description,'membership_info',membership_info,'contact_email',contact_email) from public.club_settings where club_id=c),
 'events',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'club_id',club_id,'event_type',event_type,'name',name,'event_date',event_date,'location',location,'description',description) order by event_date),'[]') from public.events where club_id=c),
 'announcements',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'club_id',club_id,'title',title,'body',body,'posted_at',posted_at) order by posted_at desc),'[]') from public.announcements where club_id=c));
end $$;

-- Save a meeting's ordered agenda atomically with optimistic concurrency.
create function public.save_meeting_agenda(p_meeting uuid,p_items jsonb,p_expected timestamptz) returns timestamptz language plpgsql security definer set search_path='' as $$
declare current_version timestamptz; new_version timestamptz:=clock_timestamp(); item jsonb; pos integer:=0; item_id uuid; begin
 if not private.can_manage_meeting(p_meeting) then raise exception 'Permission denied' using errcode='42501'; end if;
 select updated_at into current_version from public.events where id=p_meeting for update;
 if current_version is distinct from p_expected then raise exception 'This meeting changed. Reopen it before saving; your draft has been kept.' using errcode='40001'; end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>100 then raise exception 'Use at most 100 talking points'; end if;
 if (select count(distinct value->>'id') from jsonb_array_elements(p_items)) <> jsonb_array_length(p_items) then raise exception 'Each talking point must have a unique ID'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
  item_id:=(item->>'id')::uuid;
  if item_id is null then raise exception 'Missing talking point ID'; end if;
  if exists(select 1 from public.meeting_agenda_items where id=item_id and meeting_id<>p_meeting) then raise exception 'Permission denied' using errcode='42501'; end if;
  insert into public.meeting_agenda_items(id,meeting_id,title,talking_point,secretary_notes,sort_order,updated_at)
  values(item_id,p_meeting,btrim(item->>'title'),coalesce(item->>'talking_point',''),coalesce(item->>'secretary_notes',''),pos,new_version)
  on conflict(id) do update set title=excluded.title,talking_point=excluded.talking_point,secretary_notes=excluded.secretary_notes,sort_order=excluded.sort_order,updated_at=excluded.updated_at;
  pos:=pos+1;
 end loop;
 delete from public.meeting_agenda_items where meeting_id=p_meeting and id not in(select (value->>'id')::uuid from jsonb_array_elements(p_items));
 update public.events set updated_at=new_version where id=p_meeting;
 -- The existing timestamp trigger owns the final event version.
 return (select updated_at from public.events where id=p_meeting);
end $$;

revoke all on all tables in schema private from public,anon,authenticated;
revoke all on all functions in schema private from public,anon,authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_super_admin(),private.can_manage_club(uuid),private.can_read_club(uuid),private.can_manage_meeting(uuid) to authenticated;
revoke all on function public.create_club(text,text),public.delete_club(uuid,text),public.get_club_codes(uuid),public.regenerate_club_code(uuid,text),public.save_meeting_agenda(uuid,jsonb,timestamptz),public.guest_club_data(text),public.redeem_club_code(text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.create_club(text,text),public.delete_club(uuid,text),public.get_club_codes(uuid),public.regenerate_club_code(uuid,text),public.save_meeting_agenda(uuid,jsonb,timestamptz) to authenticated;
grant execute on function public.guest_club_data(text) to anon,authenticated;
grant execute on function public.redeem_club_code(text,text,uuid,text) to service_role;
-- Agenda writes use the atomic, version-checked RPC; direct writes cannot bypass it.
revoke insert,update,delete on public.meeting_agenda_items from authenticated;
insert into private.club_link_migrations(version) values('001_multi_club');
commit;
