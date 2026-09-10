import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname.replace(/^\/(?:([A-Za-z]):)/, '$1:');
const appUrl = 'http://127.0.0.1:4173/';
const chromeCandidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
const browserPath = chromeCandidates.find(existsSync);
if (!browserPath) throw new Error('Chrome or Edge is required for browser-check.');

let server;
let browser;
const profile = mkdtempSync(join(tmpdir(), 'club-link-browser-'));
const artifacts = join(root, 'test-artifacts');
mkdirSync(artifacts, { recursive: true });

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check, message, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await check();
    if (result) return result;
    await delay(100);
  }
  throw new Error(message);
}

async function ensureServer() {
  try {
    const response = await fetch(appUrl);
    if (response.ok) return;
  } catch {
    // Start the project's dependency-free local server below.
  }
  server = spawn(process.execPath, ['scripts/serve.mjs'], {
    cwd: root,
    stdio: 'ignore',
    windowsHide: true,
  });
  await waitFor(async () => {
    try {
      return (await fetch(appUrl)).ok;
    } catch {
      return false;
    }
  }, 'The local Club Link server did not start.');
}

class CdpConnection {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
    this.socket = new WebSocket(url);
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      const listeners = this.events.get(message.method) || [];
      listeners.forEach((listener) => listener(message.params));
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    this.events.set(method, [...(this.events.get(method) || []), listener]);
  }

  close() {
    this.socket.close();
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed.');
  return result.result.value;
}


const fixture=readFileSync(join(root,'tests/browser-fixture.js'),'utf8');
const ev=(cdp,code)=>evaluate(cdp,code);
async function click(cdp,id){await ev(cdp,`document.getElementById(${JSON.stringify(id)}).click()`);}
async function until(cdp,code,message=code){try{await waitFor(()=>ev(cdp,code),message);}catch(error){console.error(await ev(cdp,"({url:location.href,body:document.body?.innerText?.slice(0,500),fixture:!!window.__fixture,busy:document.querySelector('#events-list')?.getAttribute('aria-busy')})"));throw error;}}
async function fill(cdp,id,value){await ev(cdp,`(()=>{const input=document.getElementById(${JSON.stringify(id)});input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);}
async function submit(cdp,id){await ev(cdp,`document.getElementById(${JSON.stringify(id)}).requestSubmit()`);}
async function navigate(cdp,role=''){await cdp.send('Page.navigate',{url:appUrl+(role?'?test-role='+role:'')});await until(cdp,"document.readyState==='complete' && !!window.__fixture && document.querySelector('#events-list')?.getAttribute('aria-busy')==='false'");if(role)await until(cdp,"document.querySelectorAll('.club-card').length===2");}
async function openA(cdp){await ev(cdp,"document.querySelector('.club-card').click()");await until(cdp,"document.querySelector('#selected-club-name').textContent==='Test Club A' && document.querySelector('#events-list').getAttribute('aria-busy')==='false'");}
async function noOverflow(cdp,width){const measured=await ev(cdp,"({width:innerWidth,scroll:document.documentElement.scrollWidth,dialogs:[...document.querySelectorAll('dialog[open]')].map(x=>({width:x.clientWidth,scroll:x.scrollWidth}))})");assert(measured.width===width&&measured.scroll<=width&&measured.dialogs.every(x=>x.scroll<=x.width),`Overflow at ${width}px: ${JSON.stringify(measured)}`);}
async function shot(cdp,name){await delay(250);const {data}=await cdp.send('Page.captureScreenshot',{format:'png'});writeFileSync(join(artifacts,name+'.png'),Buffer.from(data,'base64'));}
try{
  await ensureServer();
  browser=spawn(browserPath,['--headless','--no-sandbox','--disable-gpu','--no-first-run','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});
  const portFile=join(profile,'DevToolsActivePort');await waitFor(()=>existsSync(portFile),'Browser did not start');
  const [port]=readFileSync(portFile,'utf8').split(/\r?\n/);
  const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const cdp=new CdpConnection(targets.find(x=>x.type==='page').webSocketDebuggerUrl);await cdp.open();
  const errors=[];cdp.on('Runtime.exceptionThrown',p=>{const error=p.exceptionDetails?.exception?.description||p.exceptionDetails?.text;errors.push(error);console.error(error);});
  cdp.on('Page.javascriptDialogOpening',()=>cdp.send('Page.handleJavaScriptDialog',{accept:true}));
  await cdp.send('Runtime.enable');await cdp.send('Page.enable');await cdp.send('Network.enable');
  cdp.on('Network.loadingFailed',p=>{if(p.blockedReason!=='inspector'&&p.errorText!=='net::ERR_BLOCKED_BY_CLIENT')console.error('Network failed',p.errorText,p.blockedReason);});
  cdp.on('Runtime.consoleAPICalled',p=>{if(p.type==='error')console.error('Browser console',p.args.map(x=>x.value||x.description));});
  await cdp.send('Network.setBlockedURLs',{urls:['https://cdn.jsdelivr.net/*','https://fonts.googleapis.com/*','https://fonts.gstatic.com/*']});
  await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:fixture});
  for(const width of [1440,375,390,430]){
    await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<500});
    await navigate(cdp);await noOverflow(cdp,width);
    assert(await ev(cdp,"document.querySelector('#dashboard').hidden"),'Landing exposed club content');
    await click(cdp,'home-signup');await noOverflow(cdp,width);await ev(cdp,"document.querySelector('#signup-dialog .dialog-cancel').click()");
    await click(cdp,'home-guest');await fill(cdp,'join-code','invalid');await submit(cdp,'join-form');
    await until(cdp,"!document.querySelector('#join-error').hidden");await fill(cdp,'join-code','MEM-003-729');await submit(cdp,'join-form');
    await until(cdp,"document.querySelector('#selected-club-name').textContent==='Test Club A'");
    assert(await ev(cdp,"document.querySelector('#manage-codes').hidden && document.querySelector('#add-event-button').hidden && !document.querySelector('#guest-recommendation').hidden"),'Guest controls leaked');
    assert(await ev(cdp,"!document.body.innerText.includes('Private original notes')"),'Guest private notes leaked');
    await noOverflow(cdp,width);
    if(width<500){await click(cdp,'menu-button');assert(await ev(cdp,"document.querySelector('#menu-button').getAttribute('aria-expanded')==='true'"),'Mobile menu failed');await click(cdp,'sidebar-close');}
    await navigate(cdp,'officer');await openA(cdp);await noOverflow(cdp,width);
    assert(await ev(cdp,"document.querySelector('#previous-events-list').innerText.includes('Previous workshop')"),'Archive missing');
    await ev(cdp,"window.scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'})");await delay(160);
    assert(await ev(cdp,"document.querySelector('.nav-link.is-active').dataset.section==='about'"),'Bottom navigation incorrect');
    await ev(cdp,"window.scrollTo({top:0,behavior:'instant'})");await delay(160);
    assert(await ev(cdp,"document.querySelector('.nav-link.is-active').dataset.section==='dashboard'"),'Dashboard navigation incorrect');
    await ev(cdp,"document.querySelector('#next-event-officer-notes button').click()");
    await noOverflow(cdp,width);await shot(cdp,'agenda-'+width);
    await fill(cdp,'meeting-started-time','11:45');await fill(cdp,'meeting-ended-time','12:30');
    await click(cdp,'agenda-add');await until(cdp,"document.querySelectorAll('.agenda-item').length===2");
    await ev(cdp,"(()=>{const fields=[...document.querySelectorAll('.agenda-item')].at(-1).querySelectorAll('input,textarea');['Second topic','Plan supplies','Decision made'].forEach((v,i)=>{fields[i].value=v;fields[i].dispatchEvent(new Event('input',{bubbles:true}));});})()");
    await ev(cdp,"document.querySelectorAll('.agenda-item')[1].querySelector('button').click()");
    await submit(cdp,'agenda-form');await until(cdp,"document.querySelector('#agenda-status').textContent==='All notes saved.'");
    assert(await ev(cdp,"Boolean(window.__fixture.db.meeting_agenda_items[0] && window.__fixture.db.meeting_agenda_items[0].title==='Second topic' && window.__fixture.db.meeting_agenda_items[0].secretary_notes==='Decision made' && window.__fixture.db.meeting_minutes.find(x=>x.meeting_id==='meeting-a')?.meeting_started_time==='11:45' && window.__fixture.db.meeting_minutes.find(x=>x.meeting_id==='meeting-a')?.meeting_ended_time==='12:30')"),'Agenda timing or reorder/save failed');
    await ev(cdp,"(()=>{window.__fixture.fail=true;const field=document.querySelector('.agenda-item textarea');field.value='Unsaved but retained';field.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await submit(cdp,'agenda-form');await until(cdp,"!document.querySelector('#agenda-error').hidden");
    assert(await ev(cdp,"document.querySelector('.agenda-item textarea').value==='Unsaved but retained'"),'Failed save lost draft');
    await ev(cdp,"window.__fixture.fail=false");await submit(cdp,'agenda-form');await until(cdp,"document.querySelector('#agenda-status').textContent==='All notes saved.'");
    await ev(cdp,"document.querySelectorAll('.agenda-item')[1].querySelector('button:last-child').click()");await submit(cdp,'agenda-form');await until(cdp,"window.__fixture.db.meeting_agenda_items.length===1");
    await click(cdp,'agenda-close');
    await click(cdp,'add-event-button');await fill(cdp,'event-type','other');await fill(cdp,'event-name','<img src=x onerror=alert(1)> '+ 'Long title '.repeat(7));
    await fill(cdp,'event-date','2099-10-02T15:00');await fill(cdp,'event-location','Library');await submit(cdp,'event-form');
    await until(cdp,"!document.querySelector('#event-dialog').open");await noOverflow(cdp,width);
    assert(await ev(cdp,"!document.querySelector('#events-list img') && document.querySelector('#events-list').textContent.includes('<img')"),'HTML injection unsafe');
    await ev(cdp,"[...document.querySelectorAll('#events-list .event-card')].find(x=>x.textContent.includes('<img')).querySelector('.card-action').click()");
    await fill(cdp,'event-name','Edited activity');await submit(cdp,'event-form');await until(cdp,"!document.querySelector('#event-dialog').open && document.querySelector('#events-list').textContent.includes('Edited activity')");
    await ev(cdp,"[...document.querySelectorAll('#events-list .event-card')].find(x=>x.textContent.includes('Edited activity')).querySelector('.danger').click()");await click(cdp,'confirm-delete-button');
    await until(cdp,"!document.querySelector('#confirm-dialog').open && !document.querySelector('#events-list').textContent.includes('Edited activity')");
    await click(cdp,'add-announcement-button');await fill(cdp,'announcement-title','New update');await fill(cdp,'announcement-body','Long announcement '.repeat(180));await submit(cdp,'announcement-form');
    await until(cdp,"!document.querySelector('#announcement-dialog').open");await noOverflow(cdp,width);
    await ev(cdp,"document.querySelector('#announcements-list .card-action').click()");await fill(cdp,'announcement-title','Edited update');await submit(cdp,'announcement-form');await until(cdp,"!document.querySelector('#announcement-dialog').open && document.querySelector('#announcements-list').textContent.includes('Edited update')");
    await ev(cdp,"document.querySelector('#announcements-list .danger').click()");await click(cdp,'confirm-delete-button');await until(cdp,"!document.querySelector('#confirm-dialog').open && !document.querySelector('#announcements-list').textContent.includes('Edited update')");
    await click(cdp,'edit-club-button');await fill(cdp,'club-description-input','Updated club information');await fill(cdp,'color-scheme-input','forest');await submit(cdp,'club-form');await until(cdp,"!document.querySelector('#club-dialog').open && document.querySelector('#club-description').textContent==='Updated club information'");
    await click(cdp,'manage-codes');await until(cdp,"document.querySelectorAll('.code-row').length===2");await noOverflow(cdp,width);
    await ev(cdp,"document.querySelector('.code-row .platform-actions button:last-child').click()");await submit(cdp,'platform-confirm-form');
    await until(cdp,"document.querySelector('#code-rows').textContent.includes('MEM-111-222')");await ev(cdp,"document.querySelector('#codes-dialog .dialog-cancel').click()");
    await click(cdp,'my-clubs-button');await until(cdp,"document.querySelectorAll('.club-card').length===2");
    await ev(cdp,"document.querySelectorAll('.club-card')[1].click()");
    await until(cdp,"document.querySelector('#events-list').textContent.includes('Club B only event')");
    assert(await ev(cdp,"document.querySelector('#add-event-button').hidden && !document.querySelector('#events-list').textContent.includes('<img') && !document.querySelector('#manage-codes').checkVisibility()"),'Club switching permissions/data incorrect');
    await shot(cdp,'member-'+width);
    await click(cdp,'sign-out-button');await until(cdp,"!document.querySelector('#welcome-actions').hidden");
    assert(await ev(cdp,"!document.body.textContent.includes('Private original notes')"),'Private data retained after logout');
  }
  await navigate(cdp);
  await click(cdp,'home-signup');for(const [id,value] of [['signup-first','Test'],['signup-initial','T'],['signup-email','test@example.com'],['signup-password',' unchanged password ']])await fill(cdp,id,value);
  await submit(cdp,'signup-form');await until(cdp,"document.querySelector('#signup-status').textContent.includes('Check your email')");
  assert(await ev(cdp,"window.__fixture.signup.password===' unchanged password ' && Object.keys(window.__fixture.signup.options.data).length===2"),'Signup fields incorrect');
  await ev(cdp,"document.querySelector('#signup-dialog .dialog-cancel').click()");
  await click(cdp,'home-login');await fill(cdp,'auth-email','test@example.com');await fill(cdp,'auth-password',' unchanged password ');await submit(cdp,'auth-form');
  await until(cdp,"document.querySelectorAll('.club-card').length===2");
  assert(await ev(cdp,"window.__fixture.login.password===' unchanged password '"),'Login password changed');
  await navigate(cdp,'member');await click(cdp,'join-officer');await fill(cdp,'join-code','OFI-104-738');await submit(cdp,'join-form');
  await until(cdp,"!document.querySelector('#add-event-button').hidden");
  await navigate(cdp,'super');await click(cdp,'create-club');await fill(cdp,'new-club-name','Disposable test club');await fill(cdp,'new-club-description','Test description');await submit(cdp,'new-club-form');
  await until(cdp,"document.querySelector('#selected-club-name').textContent==='Disposable test club'");await click(cdp,'delete-club');await fill(cdp,'delete-name','Disposable test club');await submit(cdp,'platform-confirm-form');
  await until(cdp,"document.querySelectorAll('.club-card').length===2 && !document.querySelector('#platform-home').hidden");
  // Empty and failed reads retain a usable landing/error state.
  await ev(cdp,"window.__fixture.db.club_memberships=[];window.__fixture.db.clubs=[]");await click(cdp,'my-clubs-button');
  await until(cdp,"document.querySelector('#home-status').textContent.includes('No clubs')");
  await ev(cdp,"window.__fixture.fail=true");await click(cdp,'my-clubs-button');await until(cdp,"!document.querySelector('#home-retry').hidden");
  for(const path of ['privacy','terms']){await cdp.send('Page.navigate',{url:appUrl+path});await until(cdp,"document.readyState==='complete'&&!!document.querySelector('h1')");await noOverflow(cdp,430);}
  assert(errors.length===0,'Browser exceptions: '+errors.join('; '));
  for(const path of ['.env.local','api/access.js','migrations/001_multi_club.sql','node_modules/@electric-sql/pglite/package.json','.git/config','js/%2e%2e%2fpackage.json'])assert((await fetch(appUrl+path)).status===404,'Private path served: '+path);
  assert((await fetch(appUrl+'%malformed')).status===400,'Malformed URLs must not crash the local server');
  assert((await fetch(appUrl+'api/access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:'MEM-000-000',kind:'member'})})).status===503,'Missing server setup must fail clearly');
  cdp.close();console.log('PASS: browser login/signup, guest, roles, club switching, event/announcement creation, private agenda add/reorder/save, code rotation, super create/delete, empty/error states, navigation, escaping, 1440/375/390/430px and legal pages. Test fixtures only; live auth not exercised.');
}finally{
  if(browser&&!browser.killed)browser.kill();if(server&&!server.killed)server.kill();
  // Temporary browser profiles are left to the OS if locked; never touch a real profile.
}
