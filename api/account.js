// Account deletion is intentionally server-only because Supabase Auth user
// deletion requires the service-role key. The browser never receives that key.
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  const reply=(status,body)=>{res.statusCode=status;res.end(JSON.stringify(body));};
  if(req.method!=='POST'){res.setHeader('Allow','POST');return reply(405,{error:'Use POST.'});}
  const url=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)return reply(503,{error:'Account deletion is not configured on the server. Ask the site owner to finish setup.'});
  try {
    let body=req.body;
    if(body===undefined){let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>512)return reply(413,{error:'Request too large.'});}body=JSON.parse(raw);}
    else if(typeof body==='string')body=JSON.parse(body);
    if(!body||body.confirmation!=='DELETE')return reply(400,{error:'The deletion confirmation was not accepted.'});
    const bearer=req.headers.authorization;
    if(!/^Bearer [^\s]+$/.test(bearer||''))return reply(401,{error:'Sign in again before deleting your account.'});
    const auth=await fetch(`${url}/auth/v1/user`,{headers:{apikey:key,Authorization:bearer},signal:AbortSignal.timeout(10000)});
    if(!auth.ok)return reply(401,{error:'Your session expired. Sign in again before deleting your account.'});
    const user=await auth.json();
    if(!user.id)return reply(401,{error:'Your account could not be verified.'});
    const deleted=await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(user.id)}`,{method:'DELETE',headers:{apikey:key,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(10000)});
    if(!deleted.ok)return reply(503,{error:'Supabase could not delete the account. Nothing was changed.'});
    return reply(200,{deleted:true});
  } catch {
    return reply(503,{error:'Account deletion could not be completed. Check your connection and try again.'});
  }
}
