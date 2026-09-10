import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, isSupabaseConfigured } from './config.js';
let client;
export function getSupabaseClient() {
  if (!isSupabaseConfigured) throw new Error('Configure the two public project values in js/config.js.');
  if (!window.supabase?.createClient) throw new Error('Supabase could not load. Check your internet connection.');
  client ??= window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {autoRefreshToken:true,persistSession:true,detectSessionInUrl:true},
  });
  return client;
}
function unwrap(result) { if (result.error) throw result.error; return result.data; }
function requireClub(id) { if (!id) throw new Error('Choose a club first.'); return id; }
export async function loadAccount(userId, supabase=getSupabaseClient()) {
  const [clubs,memberships,admins,profile] = await Promise.all([
    supabase.from('clubs').select('id,name,description').order('name'),
    supabase.from('club_memberships').select('club_id,role').eq('user_id',userId),
    supabase.from('app_admins').select('user_id').eq('user_id',userId).maybeSingle(),
    supabase.from('profiles').select('first_name,last_initial').eq('user_id',userId).maybeSingle(),
  ]);
  return {clubs:unwrap(clubs)||[],memberships:unwrap(memberships)||[],isSuper:Boolean(unwrap(admins)),profile:unwrap(profile)};
}
export async function loadPublicData(clubId, guestToken=null, supabase=getSupabaseClient()) {
  requireClub(clubId);
  if (guestToken) return unwrap(await supabase.rpc('guest_club_data',{p_token:guestToken}));
  const [events,announcements,settings] = await Promise.all([
    supabase.from('events').select('id,club_id,event_type,name,event_date,location,description,created_at,updated_at').eq('club_id',clubId).order('event_date'),
    supabase.from('announcements').select('id,club_id,title,body,posted_at,updated_at').eq('club_id',clubId).order('posted_at',{ascending:false}),
    supabase.from('club_settings').select('club_id,club_name,color_scheme,club_description,membership_info,contact_email,updated_at').eq('club_id',clubId).maybeSingle(),
  ]);
  const result={events:unwrap(events)||[],announcements:unwrap(announcements)||[],settings:unwrap(settings)};
  if (!result.settings) throw new Error('Club access is no longer available. Return to My Clubs.');
  return result;
}
export async function loadOfficerMeetingDetails(clubId, supabase=getSupabaseClient()) {
  return unwrap(await supabase.from('meeting_agenda_items').select('id,meeting_id,title,talking_point,secretary_notes,sort_order,events!inner(club_id)').eq('events.club_id',requireClub(clubId)).order('sort_order'))||[];
}
export async function loadOfficerMeetingTimes(clubId, supabase=getSupabaseClient()) {
  return unwrap(await supabase.from('meeting_minutes').select('meeting_id,meeting_started_time,meeting_ended_time,events!inner(club_id)').eq('events.club_id',requireClub(clubId)))||[];
}
export async function saveEvent(event, supabase=getSupabaseClient()) {
  const payload={club_id:requireClub(event.club_id),event_type:event.event_type,name:event.event_type==='meeting'?'Meeting':event.name.trim(),event_date:event.event_date,location:event.location.trim(),description:event.description.trim()||null};
  const query=event.id?supabase.from('events').update(payload).eq('id',event.id).eq('club_id',event.club_id):supabase.from('events').insert(payload);
  return unwrap(await query.select('id,updated_at').single());
}
export async function saveMeetingAgenda(meetingId,items,expected,startedTime=null,endedTime=null,supabase=null) {
  // Keep the original four-argument test/integration contract usable while
  // supporting the timing-aware RPC. A Supabase client passed in the fourth
  // position means the caller is using the legacy contract.
  const legacyClientCall=startedTime&&typeof startedTime==='object'&&typeof startedTime.rpc==='function';
  if(legacyClientCall){supabase=startedTime;startedTime=null;endedTime=null;}
  supabase ??= getSupabaseClient();
  const args={p_meeting:meetingId,p_items:items,p_expected:expected};
  if(!legacyClientCall){args.p_started_time=startedTime||null;args.p_ended_time=endedTime||null;}
  return unwrap(await supabase.rpc('save_meeting_agenda',args));
}
export async function removeEvent(id,clubId,supabase=getSupabaseClient()) {
  return unwrap(await supabase.from('events').delete().eq('id',id).eq('club_id',requireClub(clubId)).select('id').single());
}
export async function saveAnnouncement(item,supabase=getSupabaseClient()) {
  const payload={club_id:requireClub(item.club_id),title:item.title.trim(),body:item.body.trim()};
  const query=item.id?supabase.from('announcements').update(payload).eq('id',item.id).eq('club_id',item.club_id):supabase.from('announcements').insert(payload);
  return unwrap(await query.select('id').single());
}
export async function removeAnnouncement(id,clubId,supabase=getSupabaseClient()) {
  return unwrap(await supabase.from('announcements').delete().eq('id',id).eq('club_id',requireClub(clubId)).select('id').single());
}
export async function saveClubInformation(settings,supabase=getSupabaseClient()) {
  const payload={club_name:settings.club_name.trim(),color_scheme:settings.color_scheme,club_description:settings.club_description.trim(),membership_info:settings.membership_info.trim(),contact_email:settings.contact_email.trim()||null};
  return unwrap(await supabase.from('club_settings').update(payload).eq('club_id',requireClub(settings.club_id)).select('club_id').single());
}
export async function clubRpc(name,args,supabase=getSupabaseClient()) {return unwrap(await supabase.rpc(name,args));}
export async function redeemCode(code,kind,guest=false) {
  const headers={'Content-Type':'application/json'};
  if (!guest) {
    const {data,error}=await getSupabaseClient().auth.getSession();
    if(error) throw error;
    if(!data.session) throw new Error('Sign in before joining a club.');
    headers.Authorization=`Bearer ${data.session.access_token}`;
  }
  const response=await fetch('/api/access',{method:'POST',headers,body:JSON.stringify({code,kind})});
  const result=await response.json();
  if (!response.ok) throw new Error(result.error||'The code could not be checked.');
  return result;
}
export { isSupabaseConfigured };
