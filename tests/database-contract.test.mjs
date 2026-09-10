import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPublicData,loadOfficerMeetingDetails,removeAnnouncement,removeEvent,saveAnnouncement,saveClubInformation,saveEvent,saveMeetingAgenda} from '../js/database.js';
function mock() {
  const calls=[];
  class Query {
    constructor(table){this.table=table;}
    record(method,...args){calls.push({table:this.table,method,args});return this;}
    insert(value){return this.record('insert',value);}update(value){return this.record('update',value);}delete(){return this.record('delete');}
    eq(...args){return this.record('eq',...args);}select(value){return this.record('select',value);}order(...args){return this.record('order',...args);}
    single(){return this.record('single');}maybeSingle(){return this.record('maybeSingle');}
    then(resolve){resolve({data:this.table==='club_settings'?{club_id:'club-a'}:[],error:null});}
  }
  return {calls,client:{from:table=>new Query(table),rpc:async(name,args)=>{calls.push({name,args});return {data:'version'};}}};
}
test('all normal club reads are filtered on the database query',async()=>{
 const {client,calls}=mock();await loadPublicData('club-a',null,client);
 for(const table of ['events','announcements','club_settings'])assert.ok(calls.some(x=>x.table===table&&x.method==='eq'&&x.args[0]==='club_id'&&x.args[1]==='club-a'));
 const privateDb=mock();await loadOfficerMeetingDetails('club-a',privateDb.client);assert.ok(privateDb.calls.some(x=>x.method==='eq'&&x.args[0]==='events.club_id'));
});
test('guest read uses a token-bound RPC with no caller-selected club argument',async()=>{
 const {client,calls}=mock();await loadPublicData('club-a','guest-token',client);assert.deepEqual(calls,[{name:'guest_club_data',args:{p_token:'guest-token'}}]);
});
test('event payloads retain type, normalization and tenant scope',async()=>{
 const {client,calls}=mock();await saveEvent({club_id:'club-a',id:'event-1',event_type:'meeting',name:'Ignored',event_date:'2099-01-01',location:' Room ',description:' '},client);
 assert.equal(calls[0].args[0].name,'Meeting');assert.equal(calls[0].args[0].location,'Room');assert.equal(calls[0].args[0].description,null);assert.equal(calls[0].args[0].club_id,'club-a');
 assert.ok(calls.some(x=>x.method==='eq'&&x.args[0]==='club_id'&&x.args[1]==='club-a'));
});
test('delete operations require both item and club identifiers',async()=>{
 for(const fn of [removeEvent,removeAnnouncement]){const {client,calls}=mock();await fn('item','club-a',client);assert.ok(calls.some(x=>x.method==='eq'&&x.args[0]==='id'&&x.args[1]==='item'));assert.ok(calls.some(x=>x.method==='eq'&&x.args[0]==='club_id'&&x.args[1]==='club-a'));}
});
test('announcement creation trims text and attaches club',async()=>{
 const {client,calls}=mock();await saveAnnouncement({club_id:'club-a',title:' Title ',body:' Body '},client);assert.deepEqual(calls[0].args[0],{club_id:'club-a',title:'Title',body:'Body'});
});
test('club settings update only the selected club, including name and palette',async()=>{
 const {client,calls}=mock();await saveClubInformation({club_id:'club-a',club_name:' Robotics ',color_scheme:'forest',club_description:' Description ',membership_info:' Join ',contact_email:' club@example.com '},client);
 assert.equal(calls[0].method,'update');assert.equal(calls[0].args[0].club_name,'Robotics');assert.equal(calls[0].args[0].color_scheme,'forest');assert.equal(calls[0].args[0].contact_email,'club@example.com');assert.ok(calls.some(x=>x.method==='eq'&&x.args[0]==='club_id'));
});
test('agenda save is one atomic version-checked RPC with per-point notes',async()=>{
 const {client,calls}=mock();const items=[{id:'point',title:'Topic',talking_point:'Discuss',secretary_notes:'Recorded'}];
 await saveMeetingAgenda('meeting',items,'version-1',client);assert.deepEqual(calls,[{name:'save_meeting_agenda',args:{p_meeting:'meeting',p_items:items,p_expected:'version-1'}}]);
});
test('missing club IDs fail closed before querying',async()=>{
 const {client}=mock();await assert.rejects(()=>loadPublicData(null,null,client),/Choose a club/);await assert.rejects(()=>removeEvent('id',null,client),/Choose a club/);
});
