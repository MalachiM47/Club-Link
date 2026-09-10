import {loadAccount,clubRpc,redeemCode,deleteAccount as deleteAccountRequest,isSupabaseConfigured} from './database.js';
import {getAuthState,refreshAuthState,signInOfficer,signOutOfficer,signUpAccount,watchAuthState} from './auth.js';

export function createPlatform({selectClub,clearClub,toast,beforeLeave}) {
  const $=id=>document.getElementById(id);
  const selectedClubKey='club-link-selected-club';
  const selectedClubDetailsKey='club-link-selected-club-details';
  const lastSectionKey='club-link-last-section:';
  let user=null,account=null,selected=null,joinKind='member',guestJoin=false,revision=0,pending=null,authTransition=null,loginInProgress=false,restoringClub=false,accountReloadInProgress=false,resumeInProgress=false;
  function savedClubId() {try{return window.sessionStorage.getItem(selectedClubKey);}catch{return null;}}
  function savedClubDetails() {try{const raw=window.sessionStorage.getItem(selectedClubDetailsKey);return raw?JSON.parse(raw):null;}catch{return null;}}
  function savedSectionId(clubId) {try{const value=window.sessionStorage.getItem(`${lastSectionKey}${clubId}`);return /^(dashboard|events|announcements|about)$/.test(value||'')?value:null;}catch{return null;}}
  function forgetSavedClub() {try{window.sessionStorage.removeItem(selectedClubKey);window.sessionStorage.removeItem(selectedClubDetailsKey);}catch{}}
  function message(id,text='') {$(id).textContent=text;$(id).hidden=!text;}
  function show(id) {if(!$(id).open)$(id).showModal();}
  function resetPrivateDialogs() {
    for(const id of ['codes-dialog','platform-confirm','new-club-dialog','join-dialog','account-delete-dialog'])$(id).close();
    $('code-rows').replaceChildren();$('join-form').reset();pending=null;
  }
  function setView(club) {
    selected=club;
    $('platform-home').hidden=Boolean(club);$('selected-club-bar').hidden=!club;$('club-navigation').hidden=!club;
    document.querySelectorAll('.page-section').forEach(node=>node.hidden=!club);
    $('manage-codes').hidden=!club?.officer;$('delete-club').hidden=!(club&&account?.isSuper);$('my-clubs-button').disabled=!club;
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
  async function reloadAccountInternal() {
    const ticket=++revision;
    message('home-status',user?'Loading your clubs…':'');$('home-retry').hidden=true;
    if(!user)return;
    try {
      let data;
      let lastError;
      // A suspended tab can resume while Supabase is refreshing its session.
      // Retry the account/RLS read with backoff and explicitly refresh the
      // session between attempts before showing a persistent error state.
      for(let attempt=0;attempt<5;attempt+=1) {
        try {
          const authState=await getAuthState();
          if(!authState.user)throw new Error('Your session has ended.');
          user=authState.user;
          data=await loadAccount(user.id);
          break;
        } catch(error) {
          lastError=error;
          if(attempt<4) {
            try {await refreshAuthState();}catch{}
            await new Promise(resolve=>window.setTimeout(resolve,350*2**attempt));
          }
        }
      }
      if(!data)throw lastError||new Error('Club account could not be loaded.');
      if(ticket!==revision)return;
      account=data;renderHome();message('home-status',data.clubs.length?'':'No clubs yet. Use Join a Club and enter the Member Code shared by an officer.');
      const saved=savedClubId();const club=saved&&data.clubs.find(item=>item.id===saved);
      // Do not tear down an open dialog or reset scroll position when a
      // visibility refresh confirms the same club that is already selected.
      if(club&&(!selected||selected.id!==club.id)){restoringClub=true;try{await openClub(club);}finally{restoringClub=false;}}
    } catch (error) {
      if(ticket!==revision)return;
      console.warn('[Club Link] Account refresh failed.',{code:error?.code??null,message:error?.message??'Unknown account refresh error'});
      // Keep an already open club visible while a suspended tab reconnects.
      // The next visibility/focus event will retry the account request.
      if(!selected){
        const cachedClub=savedClubDetails();
        if(cachedClub?.id&&user){
          // A discarded tab can lose its in-memory view before the persisted
          // session is ready. Restore the last safe, member-level view while
          // the next resume event retries the authenticated account read.
          restoringClub=true;
          try {await openClub({id:String(cachedClub.id),name:String(cachedClub.name||'Club'),description:String(cachedClub.description||'')});}
          finally {restoringClub=false;}
        } else {
          message('home-status','Your clubs could not be loaded. Check your connection. If this is the first multi-club launch, the site owner must apply the database migration.');$('home-retry').hidden=false;
        }
      }
    }
  }
  async function reloadAccount() {
    if(accountReloadInProgress)return;
    accountReloadInProgress=true;
    try {await reloadAccountInternal();}finally{accountReloadInProgress=false;}
  }
  async function home(force=false,preserveSavedClub=false) {
    if(!force&&!beforeLeave())return;
    resetPrivateDialogs();if(!preserveSavedClub)forgetSavedClub();account=null;clearClub(user);setView(null);renderHome();await reloadAccount();
  }
  async function openClub(club,guestToken=null) {
    if(!beforeLeave())return;
    resetPrivateDialogs();
    const officer=!guestToken&&Boolean(account?.isSuper||account?.memberships.some(item=>item.club_id===club.id&&item.role==='officer'));
    const context={...club,officer,guestToken,user,isSuper:Boolean(account?.isSuper)};
    if(!guestToken){try{window.sessionStorage.setItem(selectedClubKey,club.id);window.sessionStorage.setItem(selectedClubDetailsKey,JSON.stringify({id:club.id,name:club.name,description:club.description||''}));}catch{}}
    clearClub(user);setView(context);await selectClub(context);
    const hashSection=/^#(?:dashboard|events|announcements|about)$/.test(window.location.hash)?window.location.hash.slice(1):null;
    const sectionId=hashSection||savedSectionId(club.id);
    if(sectionId) {
      const section=document.getElementById(sectionId);
      if(section)window.setTimeout(()=>section.scrollIntoView({behavior:'instant',block:'start'}),0);
    } else if(!guestToken) {
      window.history.replaceState(null,'','#dashboard');
    }
  }
  async function acceptUser(next) {
    if(user?.id===next?.id) {
      // The explicit login handler and Supabase's SIGNED_IN callback can both
      // observe the same user. Share the in-flight transition instead of
      // starting a second account load that could overwrite a successful one.
      if (authTransition) return authTransition;
      return;
    }
    const hadUser=Boolean(user);
    user=next;
    const transition=home(true,!hadUser&&Boolean(next));
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
    confirmation('Sign out of Club Link?','You can sign back in later, but any unsaved changes will be discarded.',async()=>{
      if(!beforeLeave())throw new Error('Save or discard your unsaved changes before signing out.');
      try {await signOutOfficer();user=null;await home(true);toast('Signed out.');}catch{throw new Error('Sign out did not finish. Try again.');}
    });
  }
  function signup() {$('signup-form').reset();$('signup-form').hidden=false;$('signup-success').hidden=true;$('signup-close').textContent='Cancel';message('signup-error');message('signup-status');show('signup-dialog');}
  $('home-login').addEventListener('click',()=>document.querySelector('#open-auth-button').click());
  $('home-signup').addEventListener('click',signup);$('guest-signup').addEventListener('click',signup);
  $('home-guest').addEventListener('click',()=>openJoin('member',true));
  $('join-member').addEventListener('click',()=>openJoin('member'));$('join-officer').addEventListener('click',()=>openJoin('officer'));
  $('my-clubs-button').addEventListener('click',()=>home());$('home-retry').addEventListener('click',reloadAccount);
  $('signup-success-login').addEventListener('click',()=>{$('signup-dialog').close();$('open-auth-button').click();});
  $('signup-form').addEventListener('submit',event=>{event.preventDefault();submit(event.currentTarget,'signup-error',async data=>{
    const result=await signUpAccount(data.get('first_name'),data.get('last_initial'),data.get('email'),data.get('password'));
    const email=data.get('email').trim();
    $('signup-form').reset();
    if(result.confirmationRequired) {
      $('signup-status').textContent='Check your email to confirm your account, then return and log in.';
      $('signup-status').hidden=true;
      $('signup-success-email').textContent=email;
      $('signup-form').hidden=true;
      $('signup-success').hidden=false;
      $('signup-close').textContent='Close';
    }
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
  function openAccountDelete() {
    $('account-delete-step-one').hidden=false;$('account-delete-step-two').hidden=true;$('account-delete-word').value='';$('account-delete-ack').checked=false;$('account-delete-submit').disabled=true;message('account-delete-error');show('account-delete-dialog');
  }
  $('delete-account-button').addEventListener('click',openAccountDelete);
  $('account-delete-continue').addEventListener('click',()=>{$('account-delete-step-one').hidden=true;$('account-delete-step-two').hidden=false;$('account-delete-word').focus();});
  function syncAccountDeleteButton() {$('account-delete-submit').disabled=$('account-delete-word').value.trim()!=='DELETE'||!$('account-delete-ack').checked;}
  $('account-delete-word').addEventListener('input',syncAccountDeleteButton);$('account-delete-ack').addEventListener('change',syncAccountDeleteButton);
  $('account-delete-step-two').addEventListener('submit',event=>{event.preventDefault();submit(event.currentTarget,'account-delete-error',async()=>{
    if($('account-delete-word').value.trim()!=='DELETE')throw new Error('Type DELETE exactly to continue.');
    if(!$('account-delete-ack').checked)throw new Error('Check the acknowledgement before continuing.');
    if(!window.confirm('Final check 3 of 3: permanently delete this Club Link account? This cannot be undone.'))return;
    await deleteAccountRequest();
    await signOutOfficer().catch(()=>{});
    user=null;account=null;selected=null;forgetSavedClub();await home(true);toast('Your Club Link account was deleted.');
  });});
  $('platform-confirm-form').addEventListener('submit',event=>{event.preventDefault();submit(event.currentTarget,'platform-confirm-error',async()=>{if(!pending)return;await pending();$('platform-confirm').close();pending=null;});});
  function handleAuthState(next) {
    if(loginInProgress) return;
    // A resumed tab can deliver a partial user object (or an empty session)
    // before the persisted session has finished loading. Verify those events
    // through getSession so a missing email never becomes a fake profile and
    // a transient callback never changes the active account.
    if(!next||!next.email||user?.id!==next.id) {void reconcileAuthState();return;}
    return acceptUser(next);
  }
  async function sessionExpired() {
    if(!user)return;
    user=null;account=null;resetPrivateDialogs();clearClub(null);setView(null);renderHome();
    message('home-status','Your session expired while this tab was inactive. Sign in again to return to your last club and section.');
    $('home-retry').hidden=true;
  }
  async function reconcileAuthState() {
    if(resumeInProgress)return;
    resumeInProgress=true;
    let confirmedNoSession=0;
    let lastError=null;
    try {
      for(let attempt=0;attempt<4;attempt+=1) {
        try {
          const authState=await getAuthState();
          if(authState.user) {
            const verifiedUser=authState.user.email||!user?.email?authState.user:{...authState.user,email:user.email};
            if(user?.id===verifiedUser.id){user=verifiedUser;await reloadAccount();}
            else await acceptUser(verifiedUser);
            return;
          }
          confirmedNoSession+=1;
        } catch(error) {lastError=error;}
        if(attempt<3) {
          try {await refreshAuthState();}catch{}
          await new Promise(resolve=>window.setTimeout(resolve,300*2**attempt));
        }
      }
      if(confirmedNoSession>=2) await sessionExpired();
      else if(lastError) console.warn('[Club Link] Could not verify the saved session.',{code:lastError?.code??null,message:lastError?.message??'Unknown session error'});
    } finally {resumeInProgress=false;}
  }
  function resumeAfterVisibilityChange() {
    if(document.visibilityState!=='visible'||accountReloadInProgress||resumeInProgress)return;
    // Supabase refreshes persisted sessions lazily after a background tab is
    // resumed. Re-run the account/RLS read so the selected club is restored
    // instead of leaving the member on the My Clubs error state.
    void reconcileAuthState();
  }
  document.addEventListener('visibilitychange',resumeAfterVisibilityChange);
  window.addEventListener('pageshow',resumeAfterVisibilityChange);
  return {login,logout,home,
    updateName(name){if(selected){selected.name=name;$('selected-club-name').textContent=name;}},
    updateAccess(officer,isSuper){if(selected){selected.officer=officer;$('manage-codes').hidden=!officer;$('delete-club').hidden=!isSuper;$('selected-club-role').textContent=selected.guestToken?'Guest view':isSuper?'Super Admin':officer?'Officer':'Member';}},
    async start(){setView(null);clearClub(null);if(!isSupabaseConfigured)return;try{let authState=null,lastError=null;for(let attempt=0;attempt<4;attempt+=1){try{authState=await getAuthState();break;}catch(error){lastError=error;if(attempt<3){try{await refreshAuthState();}catch{}await new Promise(resolve=>window.setTimeout(resolve,300*2**attempt));}}}if(!authState)throw lastError||new Error('Your session could not be loaded.');user=authState.user;clearClub(user);await reloadAccount();}catch{message('home-status','Your session could not be loaded. Try signing in again.');}watchAuthState(handleAuthState);},
  };
}
