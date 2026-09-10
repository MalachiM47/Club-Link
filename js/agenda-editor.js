import { saveMeetingAgenda } from './database.js';

// Drafts live only in this tab's memory, never localStorage or a shared browser cache.
export function createAgendaEditor(onSaved) {
  const dialog=document.querySelector('#agenda-dialog');
  const form=document.querySelector('#agenda-form');
  const container=document.querySelector('#agenda-items');
  const status=document.querySelector('#agenda-status');
  const error=document.querySelector('#agenda-error');
  const save=document.querySelector('#agenda-save');
  let meeting=null, items=[], dirty=false, busy=false;
  const markDirty=()=>{dirty=true;status.textContent='Unsaved changes';};
  function render(focusId) {
    container.replaceChildren();
    if (!items.length) {const empty=document.createElement('p');empty.textContent='No talking points yet. Add the first one below.';container.append(empty);}
    items.forEach((item,index)=>{
      const card=document.createElement('section');card.className='agenda-item';
      const top=document.createElement('div');top.className='agenda-item-top';
      const label=document.createElement('strong');label.textContent=`Talking point ${index+1}`;top.append(label);
      const actions=document.createElement('div');actions.className='platform-actions';
      for(const [text,offset] of [['Move up',-1],['Move down',1],['Remove',0]]) {
        const button=document.createElement('button');button.type='button';button.className='button button-quiet';button.textContent=text;
        button.setAttribute('aria-label',`${text} talking point ${index+1}`);
        button.disabled=(offset===-1&&index===0)||(offset===1&&index===items.length-1);
        button.addEventListener('click',()=>{
          if(busy)return;
          if(!offset) {if((item.title||item.talking_point||item.secretary_notes)&&!window.confirm('Remove this talking point and its notes? The change takes effect when you save.'))return;items.splice(index,1);}
          else [items[index],items[index+offset]]=[items[index+offset],items[index]];
          markDirty();render(offset?item.id:null);
        });actions.append(button);
      }
      top.append(actions);card.append(top);
      for(const [key,text,max] of [['title','Title',200],['talking_point','Talking point',4000],['secretary_notes','Secretary notes',4000]]) {
        const field=document.createElement('div');field.className='field';
        const input=document.createElement(key==='title'?'input':'textarea');input.id=`agenda-${item.id}-${key}`;input.value=item[key]||'';input.maxLength=max;
        if(key==='title')input.required=true;else input.rows=key==='secretary_notes'?4:2;
        const label=document.createElement('label');label.htmlFor=input.id;label.textContent=text;
        input.addEventListener('input',()=>{item[key]=input.value;markDirty();});field.append(label,input);card.append(field);
      }
      container.append(card);
    });
    if(focusId)document.getElementById(`agenda-${focusId}-title`)?.focus();
  }
  function discard(force=false) {
    if(busy&&!force)return false;
    if(dirty&&!force&&!window.confirm('Discard unsaved agenda changes?'))return false;
    dialog.close();meeting=null;items=[];dirty=false;container.replaceChildren();return true;
  }
  document.querySelector('#agenda-close').addEventListener('click',()=>discard());
  dialog.addEventListener('cancel',event=>{event.preventDefault();discard();});
  document.querySelector('#agenda-add').addEventListener('click',()=>{
    if(busy)return;
    if(items.length>=100){error.hidden=false;error.textContent='Use at most 100 talking points.';return;}
    const item={id:crypto.randomUUID(),title:'',talking_point:'',secretary_notes:''};items.push(item);markDirty();render(item.id);
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!meeting)return;
    error.hidden=true;busy=true;save.disabled=true;status.textContent='Saving…';
    const target=meeting;
    // Freeze fields while saving so keystrokes cannot be mistaken for saved content.
    form.querySelectorAll('input,textarea,button').forEach(node=>node.disabled=true);
    try {
      const version=await saveMeetingAgenda(target.id,items.map(({id,title,talking_point,secretary_notes})=>({id,title,talking_point,secretary_notes})),target.updated_at);
      if(meeting!==target)return;
      meeting.updated_at=version;dirty=false;status.textContent='All notes saved.';await onSaved();
    } catch(problem) {
      if(meeting!==target)return;
      error.hidden=false;error.textContent=problem.code==='40001'?'Another officer changed this meeting. Your draft is still here. Copy any unsaved text, then close and reopen the agenda to load the latest version.':'Notes could not be saved. Your draft is still here. Check your connection and permission, then try again.';
      status.textContent='Not saved';
    } finally {busy=false;save.disabled=false;form.querySelectorAll('input,textarea,button').forEach(node=>node.disabled=false);render();}
  });
  window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
  return {
    open(event,points) {if(dialog.open&&!discard())return;meeting={...event};items=points.map(item=>({...item}));dirty=false;error.hidden=true;status.textContent='Changes are saved only when you choose Save notes.';document.querySelector('#agenda-title').textContent=`${event.name} · ${new Date(event.event_date).toLocaleDateString()}`;render();dialog.showModal();},
    discard,
    get dirty(){return dirty;},
  };
}
