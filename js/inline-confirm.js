// Confirmation stays in the page, including on touch devices.
export function inlineConfirm(host,{title,copy,label='Confirm',word=null,onConfirm,onClose=()=>{}}) {
  host.replaceChildren();host.hidden=false;
  const form=document.createElement('form');form.className='inline-confirm';
  const heading=document.createElement('h3');heading.textContent=title;heading.tabIndex=-1;
  const description=document.createElement('p');description.textContent=copy;
  form.append(heading,description);
  let input;
  if(word!==null){
    const field=document.createElement('label');field.className='field';field.textContent=`Type ${word} to confirm`;
    input=document.createElement('input');input.autocomplete='off';input.autocapitalize='off';input.spellcheck=false;input.required=true;input.setAttribute('aria-label',`Type ${word} to confirm`);field.append(input);form.append(field);
  }
  const error=document.createElement('p');error.className='form-error';error.hidden=true;error.setAttribute('role','alert');
  const actions=document.createElement('div');actions.className='platform-actions';
  const cancel=document.createElement('button');cancel.type='button';cancel.className='button button-secondary';cancel.textContent='Cancel';
  const submit=document.createElement('button');submit.type='submit';submit.className='button button-danger';submit.textContent=label;submit.disabled=Boolean(input);
  input?.addEventListener('input',()=>{submit.disabled=input.value!==word;});
  cancel.addEventListener('click',()=>{host.replaceChildren();host.hidden=true;onClose();});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(submit.disabled||(input&&input.value!==word))return;
    submit.disabled=true;cancel.disabled=true;error.textContent='';error.hidden=true;
    try{await onConfirm(input?.value);host.replaceChildren();host.hidden=true;onClose();}
    catch(e){error.hidden=false;error.textContent=e.message||'Could not complete this request. Please try again.';}
    finally{cancel.disabled=false;submit.disabled=Boolean(input&&input.value!==word);}
  });
  actions.append(cancel,submit);form.append(error,actions);host.append(form);(input||heading).focus();
  host.scrollIntoView({block:'nearest'});
}

export function setupPasswordReveal(input,button) {
  const hide=()=>{input.type='password';button.setAttribute('aria-pressed','false');};
  const show=()=>{input.type='text';button.setAttribute('aria-pressed','true');};
  button.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();button.setPointerCapture(event.pointerId);show();});
  for(const event of ['pointerup','pointercancel','lostpointercapture','pointerleave','blur'])button.addEventListener(event,hide);
  button.addEventListener('keydown',event=>{if([' ','Enter'].includes(event.key)){event.preventDefault();show();}});
  button.addEventListener('keyup',hide);
  button.addEventListener('contextmenu',event=>event.preventDefault());
  window.addEventListener('blur',hide);document.addEventListener('visibilitychange',hide);
  input.form?.addEventListener('reset',hide);input.closest('dialog')?.addEventListener('close',hide);
}
