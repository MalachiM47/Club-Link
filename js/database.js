import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, isSupabaseConfigured } from './config.js';

let client;

function requireConfiguredClient() {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured yet. Add the project URL and publishable key in js/config.js.');
  }
  if (!window.supabase?.createClient) {
    throw new Error('The Supabase library could not be loaded. Check your internet connection and try again.');
  }
  if (!client) {
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}

function unwrap(result) {
  if (result.error) throw result.error;
  return result.data;
}

export function getSupabaseClient() {
  return requireConfiguredClient();
}

export async function loadPublicData(supabase = requireConfiguredClient()) {
  const [eventsResult, announcementsResult, settingsResult] = await Promise.all([
    supabase
      .from('events')
      .select('id,event_type,name,event_date,location,description,created_at,updated_at')
      .order('event_date', { ascending: true }),
    supabase
      .from('announcements')
      .select('id,title,body,posted_at,updated_at')
      .order('posted_at', { ascending: false }),
    supabase
      .from('club_settings')
      .select('id,club_name,color_scheme,club_description,membership_info,contact_email,updated_at')
      .eq('id', 1)
      .maybeSingle(),
  ]);

  if (eventsResult.error) throw eventsResult.error;
  if (announcementsResult.error) throw announcementsResult.error;
  if (settingsResult.error) throw settingsResult.error;

  return {
    events: eventsResult.data ?? [],
    announcements: announcementsResult.data ?? [],
    settings: settingsResult.data ?? null,
  };
}

export async function getOfficerRecord(userId, supabase = requireConfiguredClient()) {
  if (!userId) return null;
  const result = await supabase
    .from('admins')
    .select('user_id,role')
    .eq('user_id', userId)
    .maybeSingle();
  return unwrap(result);
}

export async function loadOfficerMeetingDetails(supabase = requireConfiguredClient()) {
  const result = await supabase
    .from('event_officer_details')
    .select('event_id,notes,updated_at')
    .order('updated_at', { ascending: false });
  return unwrap(result) ?? [];
}

export async function saveEvent(event, supabase = requireConfiguredClient()) {
  const eventType = event.event_type === 'meeting' ? 'meeting' : 'other';
  const payload = {
    event_type: eventType,
    name: eventType === 'meeting' ? 'Meeting' : event.name.trim(),
    event_date: event.event_date,
    location: event.location.trim(),
    description: event.description.trim() || null,
  };
  const query = event.id
    ? supabase.from('events').update(payload).eq('id', event.id)
    : supabase.from('events').insert(payload);
  return unwrap(await query.select('id').single());
}

export async function saveMeetingOfficerNotes(eventId, notes, supabase = requireConfiguredClient()) {
  const normalizedNotes = String(notes ?? '').trim();
  if (!normalizedNotes) {
    return unwrap(await supabase.from('event_officer_details').delete().eq('event_id', eventId));
  }
  return unwrap(await supabase
    .from('event_officer_details')
    .upsert({ event_id: eventId, notes: normalizedNotes }, { onConflict: 'event_id' })
    .select('event_id')
    .single());
}

export async function removeMeetingOfficerNotes(eventId, supabase = requireConfiguredClient()) {
  return unwrap(await supabase.from('event_officer_details').delete().eq('event_id', eventId));
}

export async function removeEvent(id, supabase = requireConfiguredClient()) {
  return unwrap(await supabase.from('events').delete().eq('id', id).select('id').single());
}

export async function saveAnnouncement(announcement, supabase = requireConfiguredClient()) {
  const payload = {
    title: announcement.title.trim(),
    body: announcement.body.trim(),
  };
  const query = announcement.id
    ? supabase.from('announcements').update(payload).eq('id', announcement.id)
    : supabase.from('announcements').insert(payload);
  return unwrap(await query.select('id').single());
}

export async function removeAnnouncement(id, supabase = requireConfiguredClient()) {
  return unwrap(await supabase.from('announcements').delete().eq('id', id).select('id').single());
}

export async function saveClubInformation(settings, supabase = requireConfiguredClient()) {
  const payload = {
    id: 1,
    club_name: String(settings.club_name ?? 'Club Link').trim() || 'Club Link',
    color_scheme: ['default', 'forest', 'plum', 'sunset'].includes(settings.color_scheme) ? settings.color_scheme : 'default',
    club_description: settings.club_description.trim(),
    membership_info: settings.membership_info.trim(),
    contact_email: settings.contact_email.trim() || null,
  };
  return unwrap(await supabase
    .from('club_settings')
    .upsert(payload, { onConflict: 'id' })
    .select('id')
    .single());
}

export { isSupabaseConfigured };
