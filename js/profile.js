import {getSupabaseClient} from './database.js';
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,isSupabaseConfigured} from './config.js';

const el=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;};
export function createProfile({onNameChanged}) {
  const dialog=document.createElement('dialog');dialog.className='dialog';dialog.setAttribute('aria-label','Profile and password settings');document.body.append(dialog);
  let counter=0,recoveryAllowed=false;
  function open(title){dialog.replaceChildren();const box=el('div','','dialog-card'),header=el('div','','dialog-header'),close=el('button','Close','button button-secondary');close.type='button';close.onclick=()=>{dialog.close();dialog.replaceChildren();};header.append(el('h2',title),close);box.append(header);dialog.append(box);if(!dialog.open)dialog.showModal();return box;}
  function form(box,title,fields,label,action) {
    const f=el('form','','profile-section');f.append(el('h3',title));
    for(const spec of fields){const field=el('div','','field'),input=el('input'),lab=el('label',spec.label);input.id=`profile-input-${++counter}`;input.name=spec.name;input.type=spec.type||'text';input.required=true;input.value=spec.value||'';if(spec.max)input.maxLength=spec.max;if(spec.type==='password'&&spec.name!=='current')input.minLength=8;input.autocomplete=spec.autocomplete||'off';lab.htmlFor=input.id;field.append(lab,input);f.append(field);}
    const msg=el('p');msg.setAttribute('role','status');const b=el('button',label,'button button-primary');b.type='submit';f.append(msg,b);box.append(f);
    f.addEventListener('submit',async e=>{e.preventDefault();if(b.disabled)return;b.disabled=true;msg.textContent='Saving…';try{const text=await action(new FormData(f));msg.textContent=text||'Saved.';f.querySelectorAll('input[type=password]').forEach(input=>input.value='');}catch(error){msg.textContent=error.message||'This request could not be completed.';}finally{b.disabled=false;}});
  }
  const passwordFields=[{name:'password',label:'New password',type:'password',autocomplete:'new-password'},{name:'confirm',label:'Confirm new password',type:'password',autocomplete:'new-password'}];
  function matching(data){const password=data.get('password');if(password!==data.get('confirm'))throw new Error('New passwords must match.');if(password.length<8)throw new Error('Use at least 8 characters.');return password;}
  async function update(values){const {error}=await getSupabaseClient().auth.updateUser(values);if(error)throw error;}
  function forgot(email='') {
    const box=open('Reset your password');box.append(el('p','Enter your account email. Use the link in the email to choose a new password.'));
    form(box,'Send reset email',[{name:'email',label:'Account email',type:'email',value:email,autocomplete:'email'}],'Send reset email',async data=>{
      const redirectTo=new URL('/?recovery=1',window.location.origin).href;
      const {error}=await getSupabaseClient().auth.resetPasswordForEmail(data.get('email').trim(),{redirectTo});if(error)throw error;
      return 'If an account exists for this email, check your inbox for a reset link.';
    });
  }
  function recovery() {
    const box=open('Choose a new password');
    form(box,'New password',passwordFields,'Save new password',async data=>{if(!recoveryAllowed)throw new Error('Open a valid password reset link from your email.');await update({password:matching(data)});recoveryAllowed=false;history.replaceState(null,'',location.pathname);return 'Password updated. Close this window to continue.';});
  }
  async function profile() {
    const box=open('Your profile'),loading=el('p','Loading your profile…');box.append(loading);
    try {
      const client=getSupabaseClient(),{data,error}=await client.auth.getUser();if(error)throw error;if(!data.user)throw new Error('Sign in to view your profile.');
      const user=data.user,result=await client.from('profiles').select('first_name,last_initial').eq('user_id',user.id).single();if(result.error)throw result.error;if(!box.isConnected)return;loading.remove();
      box.append(el('p',`Account email: ${user.email}`));
      form(box,'Name',[{name:'first',label:'First name',value:result.data.first_name,max:60,autocomplete:'given-name'},{name:'initial',label:'Last initial',value:result.data.last_initial,max:1}],'Save name',async values=>{
        const {error}=await client.from('profiles').update({first_name:values.get('first').trim(),last_initial:values.get('initial').trim().toUpperCase()}).eq('user_id',user.id).select('user_id').single();if(error)throw error;await onNameChanged();return 'Name updated.';
      });
      form(box,'Change email',[{name:'email',label:'New email',type:'email',autocomplete:'email'}],'Request email change',async values=>{await update({email:values.get('email').trim()});return 'Check your current and new inboxes for confirmation instructions. Your email may remain unchanged until confirmed.';});
      form(box,'Change password',[{name:'current',label:'Current password',type:'password',autocomplete:'current-password'},...passwordFields],'Update password',async values=>{
        const password=matching(values);
        // An isolated non-persistent client verifies the password without
        // replacing the session used by the open club dashboard.
        const verifier=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
        try {const {data,error}=await verifier.auth.signInWithPassword({email:user.email,password:values.get('current')});if(error)throw error;if(data.user?.id!==user.id)throw new Error('Account verification failed.');await update({password});}finally{await verifier.auth.signOut({scope:'local'}).catch(()=>{});}
        return 'Password updated.';
      });
      const reset=el('button','Forgot password?','button button-secondary');reset.type='button';reset.onclick=()=>forgot(user.email);box.append(reset);
    } catch(error){loading.textContent=error.message||'Profile unavailable.';}
  }
  document.getElementById('open-profile').addEventListener('click',profile);
  document.getElementById('forgot-password').addEventListener('click',()=>{document.getElementById('auth-dialog').close();forgot(document.getElementById('auth-email').value);});
  if(isSupabaseConfigured){
    const client=getSupabaseClient();
    client.auth.onAuthStateChange((event)=>{if(event==='PASSWORD_RECOVERY'){recoveryAllowed=true;window.setTimeout(recovery,0);}if(event==='SIGNED_OUT'){recoveryAllowed=false;window.setTimeout(()=>{dialog.close();dialog.replaceChildren();},0);}});
    if(new URLSearchParams(location.search).has('recovery')) {
      const box=open('Password reset');box.append(el('p','Checking your reset link. If this message remains, the link may be expired or already used. Request another reset email from Sign in.'));
    }
  }
}
