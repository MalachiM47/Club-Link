import { getOfficerRecord, getSupabaseClient, isSupabaseConfigured } from './database.js';

export async function getAuthState() {
  if (!isSupabaseConfigured) return { user: null, officer: null };
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) throw error;
  const user = data.session?.user ?? null;
  const officer = user ? await getOfficerRecord(user.id) : null;
  return { user, officer };
}

export async function signInOfficer(email, password) {
  const { data, error } = await getSupabaseClient().auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) {
    console.error('[Club Link] Supabase authentication failed.', {
      code: error.code ?? null,
      message: error.message,
    });
    throw error;
  }
  const user = data.user;
  const officer = user ? await getOfficerRecord(user.id) : null;
  return { user, officer };
}

export async function signOutOfficer() {
  const { error } = await getSupabaseClient().auth.signOut({ scope: 'local' });
  if (error) throw error;
}

export function watchAuthState(callback) {
  if (!isSupabaseConfigured) return () => {};
  const { data } = getSupabaseClient().auth.onAuthStateChange((_event, session) => {
    window.setTimeout(async () => {
      const user = session?.user ?? null;
      try {
        const officer = user ? await getOfficerRecord(user.id) : null;
        callback({ user, officer });
      } catch (error) {
        console.error('Officer authorization check failed:', error);
        callback({ user, officer: null });
      }
    }, 0);
  });
  return () => data.subscription.unsubscribe();
}
