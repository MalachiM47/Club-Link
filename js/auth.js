import { getSupabaseClient, isSupabaseConfigured } from './database.js';
export async function getAuthState() {
  if (!isSupabaseConfigured) return {user:null};
  const {data,error}=await getSupabaseClient().auth.getSession();
  if(error) throw error;
  return {user:data.session?.user??null};
}
export async function signInOfficer(email,password) {
  const {data,error}=await getSupabaseClient().auth.signInWithPassword({email:email.trim(),password});
  if(error) {console.error('[Club Link] Supabase authentication failed.',{code:error.code??null,message:error.message});throw error;}
  return {user:data.user};
}
export async function signUpAccount(firstName,lastInitial,email,password) {
  const {data,error}=await getSupabaseClient().auth.signUp({email:email.trim(),password,
    options:{data:{first_name:firstName.trim(),last_initial:lastInitial.trim().toUpperCase()}}});
  if(error) throw error;
  return {user:data.session?.user??null,confirmationRequired:!data.session};
}
export async function signOutOfficer() {const {error}=await getSupabaseClient().auth.signOut({scope:'local'});if(error) throw error;}
export function watchAuthState(callback) {
  if(!isSupabaseConfigured) return ()=>{};
  const {data}=getSupabaseClient().auth.onAuthStateChange((event,session)=>{
    // Keep network queries outside Supabase's auth callback lock.
    if(event!=='INITIAL_SESSION') window.setTimeout(()=>callback({user:session?.user??null}),0);
  });
  return ()=>data.subscription.unsubscribe();
}
