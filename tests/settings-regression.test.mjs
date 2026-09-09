import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source = readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
test('settings submission preserves newly entered name and palette', async()=>{
  const fields={'#club-name-input':{value:'Robotics Society'},'#color-scheme-input':{value:'forest'},'#club-submit':{},'#club-dialog':{}};
  let saved;
  const context=vm.createContext({
    state:{settings:{club_name:'Club Link',color_scheme:'default'}},
    document:{querySelector:s=>fields[s]}, requireOfficer:()=>true,resetFormError:()=>{},setSubmitBusy:()=>{},closeDialog:()=>{},refreshPublicData:async()=>{},showToast:()=>{},setFormError:()=>{},console,
    saveClubInformation:async data=>{saved=data;},
    FormData:class {get(key){return key==='club_name'?fields['#club-name-input'].value:key==='color_scheme'?fields['#color-scheme-input'].value:'Existing description';}}
  });
  vm.runInContext(source.slice(source.indexOf('async function handleClubSubmit('),source.indexOf('async function handleAuthSubmit(')),context);
  await context.handleClubSubmit({preventDefault(){},currentTarget:{}});
  assert.equal(saved.club_name,'Robotics Society');assert.equal(saved.color_scheme,'forest');
});
test('dialog keeps drafts on backdrop clicks and Escape, closes through Cancel',()=>{
  const events={},buttons={};let closed=0;
  const dialog={id:'club-dialog',querySelectorAll:selector=>selector==='.dialog-cancel'?[{addEventListener:(type,handler)=>buttons[type]=handler}]:[],addEventListener:(type,handler)=>events[type]=handler};
  const context=vm.createContext({document:{querySelectorAll:()=>[dialog]},closeDialog:()=>closed++,state:{}});
  vm.runInContext(source.slice(source.indexOf('function initializeDialogs()'),source.indexOf('let navigationFrame')),context);
  context.initializeDialogs();
  events.click?.({target:dialog});assert.equal(closed,0);
  let prevented=false;events.cancel({preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(closed,0);
  buttons.click();assert.equal(closed,1);
});

test('custom club names leave website branding and page title as Club Link', () => {
  const nodes=['Club Link','About the club','From club officers'].map(textContent=>({textContent,isConnected:true,parentElement:{closest:()=>false}}));
  let index=-1;
  const mark={textContent:'CL'};
  const document={body:{},title:'Club Link | Club Dashboard',documentElement:{dataset:{}},createTreeWalker:()=>({nextNode(){index++;this.currentNode=nodes[index];return index<nodes.length;}}),querySelectorAll:selector=>selector==='.brand-mark'?[mark]:[],querySelector:()=>null};
  const ctx=vm.createContext({document,NodeFilter:{SHOW_TEXT:4}});
  const branding=readFileSync(new URL('../js/branding.js',import.meta.url),'utf8').replace('export function','function');
  vm.runInContext(branding,ctx);ctx.applyBranding({club_name:'Robotics Society',color_scheme:'forest'});
  assert.equal(nodes[0].textContent,'Club Link');assert.equal(nodes[1].textContent,'About Robotics Society');assert.equal(mark.textContent,'CL');assert.equal(document.title,'Club Link | Club Dashboard');
});
test('private sections render existing agenda and secretary notes only for officers', () => {
  const node=()=>({children:[],classList:{add(){}},append(...children){this.children.push(...children);},addEventListener(){}});
  const ctx=vm.createContext({state:{officer:true,meetingDetails:new Map([['past-meeting',{notes:'Existing agenda',secretary_notes:'Recorded decisions'}]])},document:{createElement:node},openEventDialog(){}});
  vm.runInContext(source.slice(source.indexOf('function createOfficerNotes('),source.indexOf('function scheduleNextEventTransition(')),ctx);
  const result=ctx.createOfficerNotes({id:'past-meeting',event_type:'meeting'});
  assert.deepEqual(Array.from(result.children[1].children.slice(0,4),n=>n.textContent),['Agenda','Existing agenda','Secretary notes','Recorded decisions']);
  ctx.state.officer=null;assert.equal(ctx.createOfficerNotes({id:'past-meeting',event_type:'meeting'}),null);
});
