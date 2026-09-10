import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/account.js';

async function run(options={}) {
  const oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY,oldFetch=globalThis.fetch;
  process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='server-test-secret';
  const calls=[];
  globalThis.fetch=async(url,init)=>{
    calls.push({url,init});
    if(url.endsWith('/auth/v1/user'))return new Response(JSON.stringify({id:'verified-user'}),{status:options.authStatus||200});
    return new Response('',{status:options.deleteStatus||200});
  };
  const req={method:options.method||'POST',body:options.body||{confirmation:'DELETE'},headers:options.headers||{authorization:'Bearer user-token'}};
  let response;const headers={};const res={setHeader(name,value){headers[name]=value;},end(text){response={status:this.statusCode,body:JSON.parse(text),headers};}};
  try {await handler(req,res);return {response,calls};}
  finally {globalThis.fetch=oldFetch;for(const [key,value] of [['SUPABASE_URL',oldUrl],['SUPABASE_SERVICE_ROLE_KEY',oldKey]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
}

test('account deletion verifies the bearer user and uses the private admin endpoint',async()=>{
  const {response,calls}=await run();
  assert.equal(response.status,200);assert.deepEqual(response.body,{deleted:true});
  assert.ok(calls[0].url.endsWith('/auth/v1/user'));
  assert.ok(calls[1].url.endsWith('/auth/v1/admin/users/verified-user'));
  assert.equal(calls[1].init.method,'DELETE');
  assert.equal(calls[1].init.headers.Authorization,'Bearer server-test-secret');
});

test('account deletion requires the exact confirmation and a valid session',async()=>{
  assert.equal((await run({body:{confirmation:'delete'}})).response.status,400);
  const missing=await run({headers:{}});assert.equal(missing.response.status,401);assert.equal(missing.calls.length,0);
  assert.equal((await run({method:'GET'})).response.status,405);
  assert.equal((await run({deleteStatus:500})).response.status,503);
});
