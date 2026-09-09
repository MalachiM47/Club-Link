import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';
import { applyBranding } from './branding.js';
try {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/club_settings?select=club_name,color_scheme&id=eq.1`, {headers: {apikey: SUPABASE_PUBLISHABLE_KEY}});
  if (response.ok) applyBranding({ ...(await response.json())[0], club_name: 'Club Link' });
} catch { /* Keep the original readable page if the connection is unavailable. */ }
