import {clubRpc} from './database.js';
import {formatDateTime,toDatetimeLocalValue} from './utils.js';

const node=(tag,text,className='')=>{const el=document.createElement(tag);el.textContent=text;el.className=className;return el;};
const name=p=>`${p.first_name}${p.last_initial?` ${p.last_initial}.`:''}`;
export function createActivity(getContext,onSessions) {
  const host=node('section','','activity-panel');host.setAttribute('aria-label','Event check-in and attendance');
  document.getElementById('events').append(host);
  const dialog=document.createElement('dialog');dialog.className='dialog';dialog.setAttribute('aria-label','Club activity details');document.body.append(dialog);
  let revision=0,busy=false;
  function clear(){revision++;host.replaceChildren();host.hidden=true;dialog.close();dialog.replaceChildren();}
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
    if(busy)return;busy=true;const ticket=revision;host.hidden=false;
    if(!host.childElementCount)host.append(node('p','Loading event attendance…'));
    try {
      const data=await clubRpc('club_activity',{p_club:ctx.clubId});
      if(ticket!==revision)return;
      onSessions(data.sessions);
      host.replaceChildren();host.append(node('h3','Event check-in'));
      host.append(node('p',`Your completed events attended: ${data.attended}`));
      const tools=node('div','','platform-actions');button('Refresh attendance',refresh,tools);
      if(ctx.officer){button('Members',()=>report('members'),tools);button('Club Stats',()=>report('stats'),tools);}host.append(tools);
      const sessions=new Map(data.sessions.map(s=>[s.event_id,s])),checked=new Set(data.checked_in);
      const events=[...ctx.events].sort((a,b)=>{
        const active=e=>sessions.get(e.id)?.status==='active'?0:1;
        return active(a)-active(b)||new Date(a.event_date)-new Date(b.event_date);
      });
      // Keep the full schedule in the existing cards; this compact workspace
      // exposes timing and attendance, including completed events.
      const list=node('div','','activity-list');host.append(list);
      for(const event of events) {
        const s=sessions.get(event.id),row=node('article','','activity-row');row.append(node('h4',event.name),node('p',formatDateTime(event.event_date)));
        row.append(node('strong',s?.status==='active'?'Event in Progress':s?'Completed':'Upcoming'));
        if(s){row.append(node('p',`Started: ${formatDateTime(s.actual_start_time)}`));if(s.actual_end_time)row.append(node('p',`Ended: ${formatDateTime(s.actual_end_time)} · Duration: ${Number(s.duration_minutes).toFixed(1)} minutes`));}
        if(ctx.officer&&s?.attendee_count!=null)row.append(node('p',`Attendees: ${s.attendee_count}`));
        const actions=node('div','','platform-actions');row.append(actions);
        async function action(kind){if(kind==='end'&&!window.confirm('End this event? Members will no longer be able to check in.'))return;await clubRpc('event_action',{p_event:event.id,p_action:kind});await refresh();}
        if(s?.status==='active'){const check=button(checked.has(event.id)?'Checked In':'Check In',()=>action('check_in'),actions);check.disabled=checked.has(event.id);}
        if(ctx.officer){
          if(!s){const start=button('Start Event',()=>action('start'),actions);start.disabled=Date.now()<new Date(event.event_date).getTime()-3600000;if(start.disabled)row.append(node('small','Start becomes available one hour before the scheduled time.'));}
          else {if(!s.actual_end_time)button('End Event',()=>action('end'),actions);button('Edit Recorded Times',()=>editTimes(event,s),actions);}
          button('View Attendance',()=>report('attendance',event),actions);
        }
        list.append(row);
      }
      if(!events.length)list.append(node('p','No events have been scheduled.'));
    } catch(error){if(ticket===revision){host.replaceChildren(node('p','Attendance is unavailable. Try refreshing. If this feature was just installed, the site owner must apply the attendance migration.','form-error'));button('Try again',refresh,host);}}
    finally{busy=false;}
  }
  // Refresh status after another officer acts without navigating or resetting
  // drafts. Reports are fetched again each time they are opened.
  window.setInterval(()=>{if(document.visibilityState==='visible'&&!dialog.open)void refresh();},30000);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&!dialog.open)void refresh();});
  return {clear,refresh};
}
