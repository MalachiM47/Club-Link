import {clubRpc} from './database.js';
import {formatDateTime,toDatetimeLocalValue} from './utils.js';

const node=(tag,text,className='')=>{const el=document.createElement(tag);el.textContent=text;el.className=className;return el;};
const name=p=>`${p.first_name}${p.last_initial?` ${p.last_initial}.`:''}`;
export function createActivity(getContext,onSessions) {
  const host=node('div','','officer-activity-tools');host.hidden=true;host.setAttribute('aria-label','Officer reports');
  document.querySelector('.dashboard-intro').after(host);
  const dialog=document.createElement('dialog');dialog.className='dialog';dialog.setAttribute('aria-label','Club activity details');document.body.append(dialog);
  let revision=0,request=0,sessions=new Map(),checked=new Set(),ready=false,loadError=false;
  function clear(){revision++;request++;sessions.clear();checked.clear();ready=false;loadError=false;host.replaceChildren();host.hidden=true;dialog.close();dialog.replaceChildren();}
  function button(label,action,parent){const b=node('button',label,'button button-secondary');b.type='button';b.addEventListener('click',async()=>{if(b.disabled)return;b.disabled=true;try{await action();}catch(error){const p=node('p',error.message||'Please try again.','form-error');p.setAttribute('role','alert');b.parentElement?.append(p);}finally{b.disabled=false;}});parent.append(b);return b;}
  function details(title){dialog.replaceChildren();const box=node('div','','dialog-card');const header=node('div','','dialog-header');header.append(node('h2',title));button('Close',()=>dialog.close(),header);box.append(header);dialog.append(box);if(!dialog.open)dialog.showModal();return box;}
  async function report(kind,event) {
    const ctx=getContext(),ticket=revision;const box=details(kind==='members'?'Members':kind==='stats'?'Club Stats':`Attendance: ${event.name}`);
    const loading=node('p','Loading…');box.append(loading);
    try {
      const r=await clubRpc('club_officer_report',{p_club:ctx.clubId,p_event:event?.id||null});
      if(ticket!==revision||!box.isConnected)return;
      loading.remove();
      if(kind==='stats') {
        const grid=node('dl','','activity-stats');
        for(const [label,key] of [['Total Members','total_members'],['Total Events Held','events_held'],['Total Event Minutes','event_minutes'],['Average Attendance per Completed Event','average_attendance'],['Total Attendance Check-Ins','check_ins']]){const item=node('div','');item.append(node('dt',label),node('dd',Number(r[key]).toLocaleString(undefined,{maximumFractionDigits:1})));grid.append(item);}box.append(grid);
      } else {
        const rows=kind==='members'?r.members:r.attendees;
        box.append(node('p',`${rows.length} ${kind==='members'?'total members':'attendees'}`));
        const list=node('ul','','activity-names');for(const person of rows)list.append(node('li',name(person)));box.append(list);
        if(!rows.length)box.append(node('p',kind==='members'?'No members yet.':'No check-ins yet.'));
      }
    } catch(error){loading.textContent=error.message||'Could not load this report.';loading.setAttribute('role','alert');}
  }
  function editTimes(event,session) {
    const ticket=revision,box=details(`Recorded times: ${event.name}`),form=document.createElement('form');
    const fields={};
    for(const [key,label,value] of [['start','Actual start',session.actual_start_time],['end','Actual end',session.actual_end_time]]) {
      const field=node('div','','field'),input=document.createElement('input'),lab=node('label',label);input.type='datetime-local';input.id=`recorded-${key}`;lab.htmlFor=input.id;input.value=value?toDatetimeLocalValue(value):'';input.required=key==='start'||Boolean(session.actual_end_time);input.disabled=key==='end'&&!session.actual_end_time;field.append(lab,input);form.append(field);fields[key]=input;
    }
    const duration=node('p',''),error=node('p','','form-error');error.setAttribute('role','alert');
    function preview(){const a=new Date(fields.start.value),b=new Date(fields.end.value);duration.textContent=Number.isFinite(b-a)?`Duration: ${((b-a)/60000).toFixed(1)} minutes`:'Event in progress';}
    form.addEventListener('input',preview);preview();form.append(duration,error);
    const save=node('button','Save recorded times','button button-primary');save.type='submit';form.append(save);box.append(form);
    form.addEventListener('submit',async ev=>{ev.preventDefault();if(save.disabled)return;error.textContent='';const a=new Date(fields.start.value),b=fields.end.value?new Date(fields.end.value):null;
      if(!Number.isFinite(a.getTime())||(b&&(!Number.isFinite(b.getTime())||b<a))){error.textContent='End must be at or after start.';return;}
      if(!window.confirm('Save these corrected event times and recalculate duration?'))return;
      save.disabled=true;try{await clubRpc('event_action',{p_event:event.id,p_action:'edit',p_start:a.toISOString(),p_end:b?.toISOString()||null});if(ticket===revision){dialog.close();await refresh();}}catch(e){error.textContent=e.message;}finally{save.disabled=false;}
    });
  }
  async function refresh() {
    const ctx=getContext();if(!ctx.clubId||!ctx.user||ctx.guestToken||ctx.dataError){clear();return;}
    const ticket=revision,attempt=++request;
    host.hidden=!ctx.officer;
    host.replaceChildren();
    if(ctx.officer){button('Members',()=>report('members'),host);button('Club Stats',()=>report('stats'),host);}
    try {
      const data=await clubRpc('club_activity',{p_club:ctx.clubId});
      if(ticket!==revision||attempt!==request)return;
      sessions=new Map(data.sessions.map(s=>[s.event_id,s]));checked=new Set(data.checked_in);
      ready=true;loadError=false;onSessions(data.sessions);
    } catch(error){
      if(ticket!==revision||attempt!==request)return;
      loadError=true;onSessions([...sessions.values()]);
    }
  }
  function renderEvent(event,featured=false) {
    const ctx=getContext();if(!ctx.user||ctx.guestToken||ctx.dataError)return null;
    const row=node('div','','event-activity');row.dataset.eventId=event.id;
    if(loadError){row.append(node('p','Attendance could not be refreshed.','form-error'));button('Retry attendance',refresh,row);return row;}
    if(!ready){row.append(node('p','Loading event status…'));return row;}
    const s=sessions.get(event.id),active=s?.status==='active';
    if(s){
      row.append(node('strong',active?'Event in Progress':'Completed'));
      row.append(node('p',`Started: ${formatDateTime(s.actual_start_time)}`));
      if(s.actual_end_time)row.append(node('p',`Ended: ${formatDateTime(s.actual_end_time)} · Duration: ${Number(s.duration_minutes).toFixed(1)} minutes`));
    }
    if(active){
      const checkin=node('div','','event-checkin'),copy=node('div','');
      copy.append(node('strong',checked.has(event.id)?'Your attendance is recorded':'Here for this event?'),node('p',checked.has(event.id)?'You have checked in successfully.':'Check in now to record your attendance.'));
      checkin.append(copy);
      const check=button(checked.has(event.id)?'Checked In':'Check In',()=>action('check_in'),checkin);
      check.className='button button-primary';check.disabled=checked.has(event.id);row.append(checkin);
    }
    if(ctx.officer){
      const actions=node('div','','platform-actions');row.append(actions);
      if(!s){
        const start=button('Start Event',()=>action('start'),actions);
        start.disabled=Date.now()<new Date(event.event_date).getTime()-3600000;
        if(start.disabled)row.append(node('small','Start becomes available one hour before the scheduled time.'));
      } else {
        if(active)button('End Event',()=>action('end'),actions);
        button('Edit Recorded Times',()=>editTimes(event,s),actions);
      }
      button('View Attendance',()=>report('attendance',event),actions);
    }
    async function action(kind){
      if(kind==='end'&&!window.confirm('End this event? Members will no longer be able to check in.'))return;
      const ticket=revision;
      await clubRpc('event_action',{p_event:event.id,p_action:kind});
      if(ticket!==revision)return;
      // Apply a successful transition immediately, even if the follow-up read fails.
      const now=new Date().toISOString();
      if(kind==='check_in')checked.add(event.id);
      else if(kind==='start')sessions.set(event.id,{event_id:event.id,status:'active',actual_start_time:now,actual_end_time:null});
      else if(kind==='end')sessions.set(event.id,{...s,status:'completed',actual_end_time:now,duration_minutes:(Date.now()-new Date(s.actual_start_time))/60000});
      onSessions([...sessions.values()]);
      await refresh();
      if(ticket===revision&&kind==='start')document.querySelector('.meeting-card')?.scrollIntoView({block:'start'});
    }
    if(featured)row.classList.add('event-activity-featured');
    return row.childElementCount?row:null;
  }
  // Refresh status after another officer acts without navigating or resetting
  // drafts. Reports are fetched again each time they are opened.
  window.setInterval(()=>{if(document.visibilityState==='visible'&&!dialog.open)void refresh();},30000);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&!dialog.open)void refresh();});
  return {clear,refresh,renderEvent};
}
