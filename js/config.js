// Replace only these two browser-safe values from Supabase Project Settings > API.
// Never place a service_role key or database password in this file.
export const SUPABASE_URL = 'https://vahaxbvumaetngevxeeg.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_k8Td_qB7pwyXr5MTPEO9kw_H6X2G59I';

export const isSupabaseConfigured = Boolean(
  SUPABASE_URL.startsWith('https://')
  && SUPABASE_URL.includes('.supabase.co')
  && !SUPABASE_PUBLISHABLE_KEY.startsWith('YOUR_')
  && SUPABASE_PUBLISHABLE_KEY.length > 20
);
