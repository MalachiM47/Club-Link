import { getSupabaseClient, isSupabaseConfigured } from './database.js';
export async function getAuthState() {
  if (!isSupabaseConfigured) return {user:null};
  const client=getSupabaseClient();
  let {data,error}=await client.auth.getSession();
  if(error) throw error;
  if(data.session?.expires_at && data.session.expires_at*1000 < Date.now()+60000) {
    const refreshed=await client.auth.refreshSession();
    if(refreshed.error) throw refreshed.error;
    data=refreshed.data;
  }
  return {user:data.session?.user??null};
}
export async function refreshAuthState() {
  if (!isSupabaseConfigured) return {user:null};
  const {data,error}=await getSupabaseClient().auth.refreshSession();
  if(error) throw error;
  return {user:data.session?.user??null};
}
export async function signInOfficer(email,password) {
  const {data,error}=await getSupabaseClient().auth.signInWithPassword({email:email.trim(),password});
  if(error) {console.error('[Club Link] Supabase authentication failed.',{code:error.code??null,message:error.message});throw error;}
  // signInWithPassword resolves as soon as Auth has accepted the credentials,
  // but the browser client can still be propagating the new session to its
  // PostgREST request layer. Wait for the session to be visible before the
  // platform starts its membership/RLS queries. This avoids a transient
  // "clubs could not be loaded" screen on a user's first login.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const sessionState = await getAuthState();
    if (sessionState.user?.id === data.user?.id) break;
    await new Promise((resolve) => globalThis.setTimeout(resolve, 40 * (attempt + 1)));
  }
  // Email/password sessions normally include the email on `data.user`. Keep
  // the entered address as a display fallback for older Auth responses so the
  // account panel never falls back to its generic placeholder initial.
  const signedInUser=data.user?.email?data.user:{...data.user,email:email.trim()};
  return {user:signedInUser};
}
export async function signUpAccount(firstName,lastInitial,email,password) {
  const {data,error}=await getSupabaseClient().auth.signUp({email:email.trim(),password,
    options:{data:{first_name:firstName.trim(),last_initial:lastInitial.trim().toUpperCase()}}});
  if(error?.code==='user_already_exists'||error?.code==='email_exists'||/already registered/i.test(error?.message||'')) return {alreadyExists:true};
  if(error) throw error;
  if(!data.session && Array.isArray(data.user?.identities) && data.user.identities.length===0) return {alreadyExists:true};
  return {user:data.session?.user??null,confirmationRequired:!data.session};
}
export async function signOutOfficer() {const {error}=await getSupabaseClient().auth.signOut({scope:'local'});if(error) throw error;}
export function watchAuthState(callback) {
  if(!isSupabaseConfigured) return ()=>{};
  const {data}=getSupabaseClient().auth.onAuthStateChange((event,session)=>{
    // Keep network queries outside Supabase's auth callback lock. Platform
    // expects a User, not {user: User}; wrapping it loses the id/email fields.
    if(event!=='INITIAL_SESSION') window.setTimeout(()=>callback(session?.user??null),0);
  });
  return ()=>data.subscription.unsubscribe();
}
