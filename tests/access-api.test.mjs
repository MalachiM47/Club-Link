import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/access.js';

async function run(options={}) {
  const oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY,oldVercel=process.env.VERCEL,oldFetch=globalThis.fetch;
  process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='server-test-secret';delete process.env.VERCEL;
  const calls=[];
  globalThis.fetch=async(url,init)=>{
    calls.push({url,init});
    return url.endsWith('/auth/v1/user')?new Response(JSON.stringify({id:'verified-user',email_confirmed_at:'2026-01-01'}),{status:options.authStatus||200}):new Response(JSON.stringify(options.result||{club_id:'club-a'}));
  };
  const req={method:options.method||'POST',body:options.body||{code:'MEM-003-729',kind:'member'},headers:options.headers||{},socket:{remoteAddress:'127.0.0.1'}};
  let response;const headers={};const res={setHeader(name,value){headers[name]=value;},end(text){response={status:this.statusCode,body:JSON.parse(text),headers};}};
  try {await handler(req,res);return {response,calls};}
  finally {globalThis.fetch=oldFetch;for(const [key,value] of [['SUPABASE_URL',oldUrl],['SUPABASE_SERVICE_ROLE_KEY',oldKey],['VERCEL',oldVercel]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
}
test('guest redemption uses a server-only key and hashed network bucket, not caller identity',async()=>{
 const {response,calls}=await run({body:{code:'MEM-003-729',kind:'member',user_id:'forged',p_user:'forged'},headers:{'x-forwarded-for':'forged-ip'}});
 assert.equal(response.status,200);const params=JSON.parse(calls[0].init.body);assert.equal(params.p_user,null);assert.match(params.p_ip_hash,/^[0-9a-f]{64}$/);assert.ok(!JSON.stringify(response).includes('server-test-secret'));
});
test('registered redemption verifies the token with Auth and ignores a forged user ID',async()=>{
 const {calls}=await run({headers:{authorization:'Bearer token'},body:{code:'OFI-104-738',kind:'officer',user_id:'forged'}});
 assert.ok(calls[0].url.endsWith('/auth/v1/user'));assert.equal(JSON.parse(calls[1].init.body).p_user,'verified-user');
});
test('invalid authentication and unauthenticated officer code redemption fail before RPC',async()=>{
 const invalid=await run({headers:{authorization:'Bearer invalid'},authStatus:401});assert.equal(invalid.response.status,401);assert.equal(invalid.calls.length,1);
 const guest=await run({body:{code:'OFI-104-738',kind:'officer'}});assert.equal(guest.response.status,401);assert.equal(guest.calls.length,0);
});
test('rate limiting, invalid codes, oversized input and methods return explicit errors',async()=>{
 assert.equal((await run({result:{error:'rate_limited'}})).response.status,429);
 assert.equal((await run({result:{error:'invalid_code'}})).response.status,400);
 assert.equal((await run({body:{code:'x'.repeat(1500),kind:'member'}})).response.status,413);
 assert.equal((await run({method:'GET'})).response.status,405);
});
