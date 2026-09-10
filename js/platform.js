import {loadAccount,clubRpc,redeemCode,isSupabaseConfigured} from './database.js';
import {getAuthState,signInOfficer,signOutOfficer,signUpAccount,watchAuthState} from './auth.js';

export function createPlatform({selectClub,clearClub,toast,beforeLeave}) {
  const $=id=>document.getElementById(id);
  let user=null,account=null,selected=null,joinKind='member',guestJoin=false,revision=0,pending=null,authTransition=null,loginInProgress=false;
  function message(id,text='') {$(id).textContent=text;$(id).hidden=!text;}
  function show(id) {if(!$(id).open)$(id).showModal();}
  function resetPrivateDialogs() {
    for(const id of ['codes-dialog','platform-confirm','new-club-dialog','join-dialog'])$(id).close();
    $('code-rows').replaceChildren();$('join-form').reset();pending=null;
  }
  function setView(club) {
    selected=club;
    $('platform-home').hidden=Boolean(club);$('selected-club-bar').hidden=!club;$('club-navigation').hidden=!club;
    document.querySelectorAll('.page-section').forEach(node=>node.hidden=!club);
    $('manage-codes').hidden=!club?.officer;$('delete-club').hidden=!(club&&account?.isSuper);
    $('guest-recommendation').hidden=!club?.guestToken;
    $('selected-club-name').textContent=club?.name||'';
    $('selected-club-role').textContent=club?.guestToken?'Guest view':account?.isSuper?'Super Admin':club?.officer?'Officer':'Member';
    $('my-clubs-button').textContent=user?'My Clubs':'Back to Club Link';
    window.scrollTo({top:0,behavior:'instant'});
    document.querySelector('#sidebar-close').click();
  }
  function renderHome() {
    $('welcome-actions').hidden=Boolean(user);$('account-actions').hidden=!user;
    $('create-club').hidden=!account?.isSuper;
    const clubs=account?.clubs||[];
    const hasLoadedAccount=Boolean(user&&account);
    const hasClubs=clubs.length>0;
    $('home-title').textContent=!user?'Your clubs, in one place.':hasLoadedAccount&&!hasClubs?'Join your first club':'My Clubs';
    const name=account?.profile?`${account.profile.first_name} ${account.profile.last_initial}.`:null;
    $('home-copy').textContent=!user?'Find your club’s schedule, announcements, and meeting information.':!hasClubs&&hasLoadedAccount?'Enter a Member Code from a club officer to save that club to your account.':(name?`${name}, choose a club to view its schedule and updates.`:'Choose a club to view its schedule and updates.');
    $('my-club-cards').replaceChildren();
    for(const club of clubs) {
      const card=document.createElement('button');card.type='button';card.className='club-card';
      const title=document.createElement('h2');title.textContent=club.name;
      const role=document.createElement('span');role.className='club-role';role.textContent=account.isSuper?'Super Admin':account.memberships.find(item=>item.club_id===club.id)?.role==='officer'?'Officer':'Member';
      const description=document.createElement('p');description.textContent=club.description||'View schedule, announcements, and club information.';
      card.append(title,role,description);card.addEventListener('click',()=>openClub(club));$('my-club-cards').append(card);
    }
  }
  async function reloadAccount() {
    const ticket=++revision;
    account=null;renderHome();message('home-status',user?'Loading your clubs…':'');$('home-retry').hidden=true;
    if(!user)return;
    try {
      let data;
      let lastError;
      // A freshly established Auth session can take one request cycle to be
      // available to RLS policies. Retry once so the normal first-login path
      // does not require a manual refresh, while still surfacing persistent
      // configuration or migration errors.
      for(let attempt=0;attempt<2;attempt+=1) {
        try {data=await loadAccount(user.id);break;}
        catch(error) {lastError=error;if(attempt===0)await new Promise(resolve=>window.setTimeout(resolve,180));}
      }
      if(!data)throw lastError||new Error('Club account could not be loaded.');
      if(ticket!==revision)return;
      account=data;renderHome();message('home-status',data.clubs.length?'':'No clubs yet. Use Join a Club and enter the Member Code shared by an officer.');
    } catch {
      if(ticket!==revision)return;
      message('home-status','Your clubs could not be loaded. Check your connection. If this is the first multi-club launch, the site owner must apply the database migration.');$('home-retry').hidden=false;
    }
  }
  async function home(force=false) {
    if(!force&&!beforeLeave())return;
    resetPrivateDialogs();clearClub(user);setView(null);await reloadAccount();
  }
  async function openClub(club,guestToken=null) {
    if(!beforeLeave())return;
    resetPrivateDialogs();
    const officer=!guestToken&&Boolean(account?.isSuper||account?.memberships.some(item=>item.club_id===club.id&&item.role==='officer'));
    const context={...club,officer,guestToken,user,isSuper:Boolean(account?.isSuper)};
    clearClub(user);setView(context);await selectClub(context);
  }
  async function acceptUser(next) {
    if(user?.id===next?.id) {
      // The explicit login handler and Supabase's SIGNED_IN callback can both
      // observe the same user. Share the in-flight transition instead of
      // starting a second account load that could overwrite a successful one.
      if (authTransition) return authTransition;
      return;
    }
    user=next;
    const transition=home(true);
    authTransition=transition;
    try {await transition;return transition;}
    finally {if(authTransition===transition)authTransition=null;}
  }
  function openJoin(kind,guest=false) {
    joinKind=kind;guestJoin=guest;$('join-form').reset();message('join-error');
    $('join-title').textContent=guest?'View a club':kind==='officer'?'Join as Officer':'Join a Club';
    $('join-copy').textContent=guest?'Use a Member Code to view one club without an account. This access lasts up to 8 hours in this tab.':kind==='officer'?'Enter the Officer Code shared by your club leadership.':'Enter the Member Code to save this club to your account.';
    $('join-code-label').textContent=kind==='officer'?'Officer Code':'Member Code';$('join-code').placeholder=kind==='officer'?'OFI-000-000':'MEM-000-000';show('join-dialog');
  }
  async function submit(form,errorId,action) {
    const button=form.querySelector('[type="submit"]');if(button.disabled)return;
    button.disabled=true;message(errorId);
    try {await action(new FormData(form));}catch(error){message(errorId,error.message||'Club Link could not complete that request. Please try again.');}
    finally{button.disabled=false;}
  }
  async function login(event) {
    event.preventDefault();
    loginInProgress=true;
    try {
      await submit(event.currentTarget,'auth-error',async data=>{
        const result=await signInOfficer(data.get('email'),data.get('password'));
        $('auth-form').reset();$('auth-dialog').close();await acceptUser(result.user);
      });
    } finally {
      // The auth callback is intentionally deferred while the explicit login
      // flow is resolving. Its user object can be incomplete in some browser
      // versions, so the sign-in response remains the canonical account data.
      loginInProgress=false;
    }
  }
  async function logout() {
    if(!beforeLeave())return;
    try {await signOutOfficer();user=null;await home(true);toast('Signed out.');}catch{toast('Sign out did not finish. Try again.','error');}
  }
  function signup() {$('signup-form').reset();message('signup-error');message('signup-status');show('signup-dialog');}
  $('home-login').addEventListener('click',()=>document.querySelector('#open-auth-button').click());
  $('home-signup').addEventListener('click',signup);$('guest-signup').addEventListener('click',signup);
  $('home-guest').addEventListener('click',()=>openJoin('member',true));
  $('join-member').addEventListener('click',()=>openJoin('member'));$('join-officer').addEventListener('click',()=>openJoin('officer'));
  $('my-clubs-button').addEventListener('click',()=>home());$('home-retry').addEventListener('click',reloadAccount);
  $('signup-form').addEventListener('submit',event=>{event.preventDefault();submit(event.currentTarget,'signup-error',async data=>{
    const result=await signUpAccount(data.get('first_name'),data.get('last_initial'),data.get('email'),data.get('password'));
    $('signup-form').reset();
    if(result.confirmationRequired)message('signup-status','Check your email to confirm your account, then return and log in. If you already have an account, log in instead.');
    else {$('signup-dialog').close();await acceptUser(result.user);}
  });});
  $('join-form').addEventListener('submit',event=>{event.preventDefault();submit(event.currentTarget,'join-error',async data=>{
    const result=await redeemCode(data.get('code'),joinKind,guestJoin);
    $('join-dialog').close();$('join-form').reset();
    if(guestJoin)await openClub({id:result.club_id,name:'Club'},result.guest_token);
    else {
      await reloadAccount();const club=account?.clubs.find(item=>item.id===result.club_id);
      toast(result.already_officer?'You already have Officer access to this club.':result.upgraded?'Your membership is now Officer.':result.already_joined?'You already belong to this club.':'Club added to your account.');
      if(club)await openClub(club);
    }
  });});
  $('create-club').addEventListener('click',()=>{$('new-club-form').reset();message('new-club-error');show('new-club-dialog');});
  $('new-club-form').addEventListener('submit',event=>{event.preventDefault();submit(event.currentTarget,'new-club-error',async data=>{
    const id=await clubRpc('create_club',{p_name:data.get('name').trim(),p_description:data.get('description').trim()});
    $('new-club-dialog').close();await reloadAccount();const club=account?.clubs.find(item=>item.id===id);if(club)await openClub(club);toast('Club created. Open Club access to share its codes.');
  });});
  function confirmation(title,copy,action,deleteName=false) {
    pending=action;$('platform-confirm-title').textContent=title;$('platform-confirm-copy').textContent=copy;
    $('delete-name-field').hidden=!deleteName;$('delete-name').required=deleteName;$('delete-name').value='';message('platform-confirm-error');show('platform-confirm');
  }
  async function loadCodes() {
    const target=selected;message('codes-error');$('code-rows').textContent='Loading codes…';show('codes-dialog');
    try {
      const codes=await clubRpc('get_club_codes',{p_club:target.id});if(selected!==target)return;
      $('code-rows').replaceChildren();
      for(const kind of ['member','officer']) {
        const row=document.createElement('section');row.className='code-row';
        const title=document.createElement('h3');title.textContent=kind==='member'?'Member Code':'Officer Code';
        const code=document.createElement('code');code.textContent=codes[kind];
        const actions=document.createElement('div');actions.className='platform-actions';
        const copy=document.createElement('button');copy.type='button';copy.className='button button-secondary';copy.textContent='Copy code';copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(codes[kind]);toast('Code copied.');}catch{message('codes-error','Copy is unavailable. Select the displayed code and copy it manually.');}});
        const rotate=document.createElement('button');rotate.type='button';rotate.className='button button-secondary';rotate.textContent='Generate new code';
        rotate.addEventListener('click',()=>confirmation('Generate a new code?','The previous code will stop working immediately. Existing registered members and officers keep their access. Rotating a Member Code also ends guest access using the old code.',async()=>{await clubRpc('regenerate_club_code',{p_club:target.id,p_kind:kind});await loadCodes();toast('Code regenerated.');}));
        actions.append(copy,rotate);row.append(title,code,actions);$('code-rows').append(row);
      }
    } catch {if(selected===target){$('code-rows').replaceChildren();message('codes-error','Codes could not be loaded. Check your connection and officer access.');}}
  }
  $('manage-codes').addEventListener('click',loadCodes);
  $('delete-club').addEventListener('click',()=>{
    const target=selected;
    confirmation('Delete this club?',`Permanently delete ${target.name}, its events, announcements, agendas, settings, codes, and memberships? User accounts will not be deleted. This cannot be undone.`,async()=>{
      if($('delete-name').value!==target.name)throw new Error('Type the exact club name to confirm.');
      await clubRpc('delete_club',{p_club:target.id,p_confirmation:$('delete-name').value});await home(true);toast('Club and its content deleted. User accounts were kept.');
    },true);
  });
  $('platform-confirm-form').addEventListener('submit',event=>{event.preventDefault();submit(event.currentTarget,'platform-confirm-error',async()=>{if(!pending)return;await pending();$('platform-confirm').close();pending=null;});});
  function handleAuthState(next) {
    if(loginInProgress) return;
    return acceptUser(next);
  }
  return {login,logout,home,
    updateName(name){if(selected){selected.name=name;$('selected-club-name').textContent=name;}},
    updateAccess(officer,isSuper){if(selected){selected.officer=officer;$('manage-codes').hidden=!officer;$('delete-club').hidden=!isSuper;$('selected-club-role').textContent=selected.guestToken?'Guest view':isSuper?'Super Admin':officer?'Officer':'Member';}},
    async start(){setView(null);clearClub(null);if(!isSupabaseConfigured)return;try{user=(await getAuthState()).user;clearClub(user);await reloadAccount();}catch{message('home-status','Your session could not be loaded. Try signing in again.');}watchAuthState(handleAuthState);},
  };
}
