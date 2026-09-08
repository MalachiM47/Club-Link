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
