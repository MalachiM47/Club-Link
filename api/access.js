import { createHmac } from 'node:crypto';

// The service key stays inside this server function. Never import this module in the browser.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const reply = (status, body) => { res.statusCode = status; res.end(JSON.stringify(body)); };
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return reply(405, {error:'Use POST.'}); }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return reply(503, {error:'Club access is not configured on the server. Ask the site owner to finish setup.'});
  try {
    let body = req.body;
    if (body === undefined) {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (Buffer.byteLength(raw) > 1024) return reply(413, {error:'Request too large.'});
      }
      body = JSON.parse(raw);
    } else if (typeof body === 'string') body = JSON.parse(body);
    if (Buffer.byteLength(JSON.stringify(body) || '') > 1024) return reply(413,{error:'Request too large.'});
    if (!body || typeof body.code !== 'string' || body.code.length > 40 || !['member','officer'].includes(body.kind)) {
      return reply(400, {error:'Enter a valid member or officer code.'});
    }
    let userId = null;
    const bearer = req.headers.authorization;
    if (bearer) {
      if (!/^Bearer [^\s]+$/.test(bearer)) return reply(401, {error:'Sign in again before joining.'});
      const auth = await fetch(`${url}/auth/v1/user`, {headers:{apikey:key, Authorization:bearer}, signal:AbortSignal.timeout(10000)});
      if (!auth.ok) return reply(401, {error:'Your session expired. Sign in again.'});
      const user = await auth.json();
      if (!user.id || !user.email_confirmed_at) return reply(403, {error:'Confirm your email before joining.'});
      userId = user.id;
    }
    if (!userId && body.kind === 'officer') return reply(401, {error:'Sign in to use an officer code.'});
    // Vercel overwrites x-forwarded-for. Never trust that header on a local server.
    const ip = process.env.VERCEL ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : req.socket?.remoteAddress;
    if (!ip) return reply(503, {error:'Access could not be verified. Try again later.'});
    const ipHash = createHmac('sha256',key).update(ip).digest('hex');
    const result = await fetch(`${url}/rest/v1/rpc/redeem_club_code`, {
      method:'POST', headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
      body:JSON.stringify({p_code:body.code,p_kind:body.kind,p_user:userId,p_ip_hash:ipHash}), signal:AbortSignal.timeout(10000),
    });
    if (!result.ok) return reply(503, {error:'Club access is unavailable. Ask the site owner to check the database migration.'});
    const data = await result.json();
    if (data.error === 'rate_limited') {res.setHeader('Retry-After','900');return reply(429,{error:'Too many attempts. Wait 15 minutes before trying again.'});}
    if (data.error) return reply(400,{error:'That code was not accepted. Check the code and access type.'});
    return reply(200,data);
  } catch {
    // Do not log request bodies, codes, access tokens, passwords, or server credentials.
    return reply(503,{error:'Club access could not be completed. Check your connection and try again.'});
  }
}
