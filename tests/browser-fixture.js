// Browser-only test double. Never imported by the application or deployed static output.
(() => {
  const day=86400000, date=new Date(Date.now()+day).toISOString();
  const mode=new URLSearchParams(location.search).get('test-role');
  let user=mode?{id:'user-1',email:'test@example.com'}:null;
  const db={
    clubs:[{id:'club-a',name:'Test Club A',description:'Club A description'},{id:'club-b',name:'Test Club B',description:'Club B description'}],
    club_memberships:[{user_id:'user-1',club_id:'club-a',role:mode==='member'?'member':'officer'},{user_id:'user-1',club_id:'club-b',role:'member'}],
    app_admins:mode==='super'?[{user_id:'user-1'}]:[],profiles:[{user_id:'user-1',first_name:'Test',last_initial:'T'}],
    club_settings:['a','b'].map(id=>({club_id:`club-${id}`,club_name:`Test Club ${id.toUpperCase()}`,color_scheme:id==='a'?'sunset':'forest',club_description:`Information ${id}`,membership_info:'Ask an officer',contact_email:''})),
    events:[{id:'meeting-a',club_id:'club-a',event_type:'meeting',name:'Meeting',event_date:date,updated_at:date,location:'Library',description:'Discuss plans'},
      {id:'past-a',club_id:'club-a',event_type:'other',name:'Previous workshop',event_date:new Date(Date.now()-day).toISOString(),updated_at:date,location:'Room 1',description:'Completed'},
      {id:'event-b',club_id:'club-b',event_type:'other',name:'Club B only event',event_date:date,updated_at:date,location:'Room B',description:''}],
    announcements:[{id:'announcement-a',club_id:'club-a',title:'Welcome A',body:'A member announcement',posted_at:date}],
    meeting_agenda_items:[{id:'point-a',meeting_id:'meeting-a',title:'First point',talking_point:'Original agenda',secretary_notes:'Private original notes',sort_order:0}],
    meeting_minutes:[],event_sessions:[],attendance:[],
  };
  let callback=()=>{};
  window.__fixture={db,calls:[],fail:false,guest:false};
  class Query {
    constructor(table){this.table=table;this.filters=[];this.action='read';}
    select(){return this;}eq(column,value){this.filters.push([column,value]);return this;}
    order(column,options={}){this.sort=[column,options.ascending!==false];return this;}
    maybeSingle(){this.singleResult=true;return this;}single(){this.singleResult=true;return this;}
    insert(payload){this.action='insert';this.payload=payload;return this;}update(payload){this.action='update';this.payload=payload;return this;}delete(){this.action='delete';return this;}
    then(resolve,reject){return this.run().then(resolve,reject);}
    async run(){
      window.__fixture.calls.push({table:this.table,action:this.action,filters:this.filters,payload:this.payload});
      if(window.__fixture.fail)return {error:{message:'Network failure'},data:null};
      const match=row=>this.filters.every(([col,val])=>col==='events.club_id'?db.events.find(e=>e.id===row.meeting_id)?.club_id===val:row[col]===val);
      let rows=db[this.table].filter(match);
      if(this.action==='insert'){const row={id:crypto.randomUUID(),...this.payload,updated_at:new Date().toISOString(),posted_at:new Date().toISOString()};db[this.table].push(row);rows=[row];}
      if(this.action==='update')rows.forEach(row=>Object.assign(row,this.payload,{updated_at:new Date().toISOString()}));
      if(this.action==='delete')db[this.table]=db[this.table].filter(row=>!rows.includes(row));
      if(this.sort){const [column,asc]=this.sort;rows.sort((a,b)=>String(a[column]).localeCompare(String(b[column]))*(asc?1:-1));}
      return {data:structuredClone(this.singleResult?rows[0]||null:rows),error:null};
    }
  }
  const codes={member:'MEM-003-729',officer:'OFI-104-738'};
  window.supabase={createClient(url,key){window.__fixture.config={url,key};return {
    from:table=>new Query(table),
    auth:{getSession:async()=>({data:{session:user?{user,access_token:'test-token'}:null}}),onAuthStateChange:fn=>{callback=fn;return {data:{subscription:{unsubscribe(){}}}};},
      signInWithPassword:async payload=>{window.__fixture.login=payload;user={id:'user-1',email:payload.email};callback('SIGNED_IN',{user});return {data:{user}};},
      signUp:async payload=>{window.__fixture.signup=payload;return {data:{session:null}};},
      signOut:async()=>{user=null;callback('SIGNED_OUT',null);return {};},
    },
    rpc:async(name,args)=>{
      window.__fixture.calls.push({rpc:name,args});
      if(window.__fixture.fail)return {error:{message:'Network failure'}};
      if(name==='club_activity')return {data:{sessions:db.event_sessions,checked_in:db.attendance.filter(a=>a.user_id===user?.id).map(a=>a.event_id),attended:db.attendance.filter(a=>a.user_id===user?.id&&db.event_sessions.some(s=>s.event_id===a.event_id&&s.status==='completed')).length}};
      if(name==='event_action'){
        let s=db.event_sessions.find(s=>s.event_id===args.p_event);
        if(args.p_action==='start'){s={event_id:args.p_event,actual_start_time:new Date().toISOString(),actual_end_time:null,status:'active',duration_minutes:null};db.event_sessions.push(s);}
        if(args.p_action==='end'){s.actual_end_time=new Date().toISOString();s.status='completed';s.duration_minutes=0;}
        if(args.p_action==='check_in'&&!db.attendance.some(a=>a.event_id===args.p_event&&a.user_id===user.id))db.attendance.push({event_id:args.p_event,user_id:user.id});
        if(args.p_action==='edit'){s.actual_start_time=args.p_start;s.actual_end_time=args.p_end;s.duration_minutes=(new Date(args.p_end)-new Date(args.p_start))/60000;}
        return {data:null};
      }
      if(name==='club_officer_report')return {data:{members:db.club_memberships.filter(m=>m.club_id===args.p_club).map(m=>({...m,first_name:'Test',last_initial:'T',can_remove:m.user_id!==user.id})),attendees:db.attendance.filter(a=>a.event_id===args.p_event).map(()=>({first_name:'Test',last_initial:'T'})),total_members:1,events_held:db.event_sessions.filter(s=>s.status==='completed').length,event_minutes:0,average_attendance:0,check_ins:db.attendance.length}};
      if(name==='is_last_club_member')return {data:!db.club_memberships.some(m=>m.club_id===args.p_club&&m.user_id!==user.id)};
      if(name==='leave_club'||name==='remove_club_member'){db.club_memberships=db.club_memberships.filter(m=>!(m.club_id===args.p_club&&m.user_id===(args.p_user||user.id)));return {data:null};}
      if(name==='get_club_codes')return {data:{...codes}};
      if(name==='regenerate_club_code'){codes[args.p_kind]=args.p_kind==='member'?'MEM-111-222':'OFI-333-444';return {data:codes[args.p_kind]};}
      if(name==='save_meeting_agenda'){
        db.meeting_agenda_items=db.meeting_agenda_items.filter(x=>x.meeting_id!==args.p_meeting);
        db.meeting_agenda_items.push(...args.p_items.map((x,index)=>({...x,meeting_id:args.p_meeting,sort_order:index})));
        const event=db.events.find(x=>x.id===args.p_meeting);const existing=db.meeting_minutes.find(x=>x.meeting_id===args.p_meeting);if(existing)Object.assign(existing,{meeting_started_time:args.p_started_time||null,meeting_ended_time:args.p_ended_time||null});else db.meeting_minutes.push({meeting_id:args.p_meeting,meeting_started_time:args.p_started_time||null,meeting_ended_time:args.p_ended_time||null});event.updated_at=new Date().toISOString();return {data:event.updated_at};
      }
      if(name==='create_club'){const id=crypto.randomUUID();db.clubs.push({id,name:args.p_name,description:args.p_description});db.club_settings.push({club_id:id,club_name:args.p_name,color_scheme:'default',club_description:args.p_description,membership_info:'Ask an officer',contact_email:''});return {data:id};}
      if(name==='delete_club'){db.clubs=db.clubs.filter(x=>x.id!==args.p_club);return {data:null};}
      if(name==='guest_club_data')return {data:{club:db.clubs[0],settings:db.club_settings[0],events:db.events.filter(x=>x.club_id==='club-a'),announcements:db.announcements.filter(x=>x.club_id==='club-a')}};
      return {error:{message:'Unknown RPC'}};
    },
  };}};
  const originalFetch=window.fetch;
  window.fetch=async(input,options)=>{
    if(input==='/api/account'){window.__fixture.deleted=true;return new Response(JSON.stringify({deleted:true}));}
    if(input!=='/api/access')return originalFetch(input,options);
    const body=JSON.parse(options.body);window.__fixture.access=body;
    if(!Object.values(codes).includes(body.code))return new Response(JSON.stringify({error:'That code was not accepted.'}),{status:400});
    if(!options.headers.Authorization)return new Response(JSON.stringify({club_id:'club-a',guest_token:'test-guest-token'}));
    const membership=db.club_memberships[0];const already=membership.role==='officer';if(body.kind==='officer')membership.role='officer';
    return new Response(JSON.stringify({club_id:'club-a',already_joined:true,already_officer:already,upgraded:!already&&body.kind==='officer'}));
  };
})();
