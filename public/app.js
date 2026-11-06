'use strict';
const $ = id => document.getElementById(id);
let csrf = null, entries = [], currentCategory = 'Alle', editing = null, mode = 'new', toastTimer;
const categoryNames = ['API / KI', 'Passwort', 'Microsoft / Entra', 'Datenbank', 'Server / Infrastruktur', 'Lizenz', 'Sonstiges'];
// Only UI navigation is kept across a refresh. Never store field contents or passwords.
const UI_STATE_KEY = 'secret-tresor-ui-v1';
let openDialog = null;
function saveUI() {
  try { sessionStorage.setItem(UI_STATE_KEY, JSON.stringify({
    category: currentCategory, search: $('search').value, sort: $('sort').value,
    dialog: openDialog
  })); } catch { /* storage disabled */ }
}
function restoreUI() {
  try {
    const value = JSON.parse(sessionStorage.getItem(UI_STATE_KEY) || '{}');
    if (typeof value.category === 'string' && value.category.length < 120) currentCategory = value.category;
    if (typeof value.search === 'string' && value.search.length < 500) $('search').value = value.search;
    if (['updated','created','title'].includes(value.sort)) $('sort').value = value.sort;
    if (value.dialog && ['view','edit','new'].includes(value.dialog.type) &&
        (value.dialog.type === 'new' || typeof value.dialog.id === 'string')) openDialog = value.dialog;
  } catch { /* invalid/disabled session storage */ }
}
function rememberDialog(type, id = null) { openDialog = {type, id}; saveUI(); }
function clearDialog() { openDialog = null; saveUI(); }
function restoreDialog() {
  if (!openDialog) return;
  const remembered = openDialog;
  if (remembered.type === 'new') return entryForm();
  const entry = entries.find(x => x.id === remembered.id);
  if (!entry) { clearDialog(); return; }
  if (remembered.type === 'edit') entryForm(entry);
  else viewEntry(entry.id);
}
const icons = { 'API / KI':'⌘', 'Passwort':'✱', 'Microsoft / Entra':'▦', 'Datenbank':'▤', 'Server / Infrastruktur':'▣', 'Lizenz':'✧', 'Sonstiges':'◇' };
function el(tag, options = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k,v] of Object.entries(options)) {
    if (k === 'className') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'value') n.value = v;
    else if (k === 'type') n.type = v;
    else if (k === 'onClick') n.addEventListener('click', v);
    else if (k === 'placeholder') n.placeholder = v;
    else if (k === 'title') n.title = v;
    else if (k === 'checked') n.checked = v;
    else if (k === 'rows') n.rows = v;
    else if (k === 'required') n.required = v;
    else n.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}
function showToast(message, error = false) {
  clearTimeout(toastTimer); $('toast').textContent = message;
  $('toast').classList.toggle('error', error); $('toast').hidden = false;
  toastTimer = setTimeout(() => $('toast').hidden = true, 3700);
}
async function api(endpoint, method = 'GET', data) {
  const headers = {};
  if (data !== undefined) headers['Content-Type'] = 'application/json';
  if (csrf && method !== 'GET') headers['X-CSRF-Token'] = csrf;
  let resp;
  try { resp = await fetch('/api/' + endpoint, { method, headers, credentials:'same-origin', body:data !== undefined ? JSON.stringify(data) : undefined, cache:'no-store' }); }
  catch { throw new Error('Keine Verbindung zum lokalen Server.'); }
  let value = {};
  try { value = await resp.json(); } catch { /* download response */ }
  if (!resp.ok) {
    if (resp.status === 401 && endpoint !== 'unlock') await showAuth();
    throw new Error(value.error || 'Anfrage fehlgeschlagen.');
  }
  return value;
}
async function showAuth() {
  csrf = null; entries = []; editing = null; closeModal();
  $('app').hidden = true; $('auth').hidden = false; $('master').value = ''; $('master-confirm').value = '';
  const st = await api('status');
  const setup = !st.exists;
  $('auth-title').textContent = setup ? 'Deinen Tresor erstellen' : 'Tresor entsperren';
  $('auth-description').textContent = setup ? 'Erstelle ein starkes Masterpasswort. Alle Daten werden ausschliesslich lokal verschlüsselt.' : 'Gib dein Masterpasswort ein, um deine Zugangsdaten sicher zu öffnen.';
  $('setup-confirm-wrap').hidden = !setup; $('setup-warning').hidden = !setup;
  $('auth-button').textContent = setup ? 'Tresor erstellen →' : 'Tresor öffnen →';
  $('auth-form').dataset.setup = String(setup);
  $('master').focus();
}
async function openApp(newCsrf) {
  csrf = newCsrf;
  $('auth').hidden = true; $('app').hidden = false;
  restoreUI();
  await reload();
  restoreDialog();
}
async function reload() {
  const result = await api('entries');
  entries = result.entries;
  renderCategories(); renderEntries();
}
function renderCategories() {
  const categories = [...new Set([...categoryNames, ...entries.map(e => e.category).filter(Boolean)])];
  $('categories').replaceChildren();
  for (const cat of categories) {
    const amount = entries.filter(e => e.category === cat).length;
    const btn = el('button', { className:'nav' + (currentCategory === cat ? ' active' : ''), onClick:() => chooseCategory(cat) },
      el('span', {text:icons[cat] || '◇', style:'flex:0'}), el('span', {text:cat}), el('strong', {text:String(amount)}));
    $('categories').append(btn);
  }
  document.querySelector('.nav[data-category="Alle"]').classList.toggle('active', currentCategory === 'Alle');
}
function chooseCategory(cat) { currentCategory = cat; $('search').value=''; renderCategories(); renderEntries(); saveUI(); }
function renderEntries() {
  const query = $('search').value.toLocaleLowerCase('de-CH').trim();
  let filtered = entries.filter(e => (currentCategory === 'Alle' || currentCategory === e.category) &&
    [e.title,e.category,e.provider,e.url,e.username,e.tags,...e.fields.map(f => f.label)].join(' ').toLocaleLowerCase('de-CH').includes(query));
  const sort = $('sort').value;
  filtered.sort((a,b) => sort === 'title' ? a.title.localeCompare(b.title,'de') : (sort === 'created' ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt)));
  $('entries').replaceChildren();
  for (const entry of filtered) {
    const updated = new Date(entry.updatedAt).toLocaleDateString('de-CH');
    const row = el('div', {className:'entry', role:'button', tabindex:'0'},
      el('span', {className:'entry-icon',text:icons[entry.category] || '◇'}),
      el('div', {className:'entry-text'},el('div',{className:'entry-title',text:entry.title}),el('div',{className:'entry-sub',text:[entry.provider, entry.username, entry.tags].filter(Boolean).join(' · ') || 'Kein Anbieter hinterlegt'})),
      el('span', {className:'chip',text:entry.category || 'Sonstiges'}),el('span',{className:'entry-date',text:updated}),el('span',{className:'entry-arrow',text:'›'}));
    row.addEventListener('click',()=>viewEntry(entry.id));
    row.addEventListener('keydown',e => {if(e.key==='Enter' || e.key===' '){e.preventDefault();viewEntry(entry.id);}});
    $('entries').append(row);
  }
  $('empty').hidden = filtered.length !== 0;
  $('empty').querySelector('h3').textContent = entries.length && !filtered.length ? 'Keine Treffer' : 'Noch keine Einträge';
  $('empty').querySelector('p').textContent = entries.length && !filtered.length ? 'Passe deine Suche oder Kategorie an.' : 'Lege deinen ersten Zugangsschlüssel oder dein erstes Passwort an.';
  $('total-side').textContent = entries.length;
  $('entry-count').textContent = entries.length;
  $('category-count').textContent = new Set(entries.map(e => e.category)).size;
  const title = currentCategory === 'Alle' ? 'Alle Einträge' : currentCategory;
  $('page-heading').textContent = title; $('current-section').textContent = title;
}
function modal(title, body, actions) {
  $('modal-title').textContent = title;
  $('modal-body').replaceChildren(...body);
  $('modal-actions').replaceChildren(...actions);
  $('modal').hidden = false;
}
function closeModal() { $('modal').hidden = true; $('modal-body').replaceChildren(); $('modal-actions').replaceChildren(); clearDialog(); }
function button(text, cls, click) { return el('button',{type:'button',className:cls,text,onClick:click}); }
function labeled(labelText, input) { return el('div',{},el('label',{text:labelText}),input); }
function input(id, value='', placeholder='', type='text') { return el('input',{id,value,placeholder,type,autocomplete:'off'}); }
function makeField(label='', value='', secret=true) {
  const row = el('div',{className:'field-row'});
  const name = input('',label,'Feldname, z. B. API-Key'); name.className='field-label'; name.maxLength=100;
  const valueInput = input('',value,'Wert eingeben',secret?'password':'text'); valueInput.className='field-value';
  const toggle = el('input',{type:'checkbox',checked:secret});
  const toggleLabel = el('label',{className:'secret-toggle'},toggle, 'Geheim');
  toggle.addEventListener('change',()=>valueInput.type=toggle.checked?'password':'text');
  const remove = button('✕','icon-btn remove-field',()=>row.remove());
  row.append(name,valueInput,toggleLabel,remove);
  row.getData = () => ({label:name.value,value:valueInput.value,secret:toggle.checked});
  return row;
}
function entryForm(original=null) {
  const e = original || {title:'',category:'API / KI',provider:'',url:'',username:'',notes:'',tags:'',fields:[{label:'API-Key',value:'',secret:true}]};
  const title = input('field-title',e.title,'z. B. OpenAI API (Produktion)'); title.maxLength=200; title.required=true;
  const category = el('select',{id:'field-category'});
  const choices = [...new Set([...categoryNames, ...(e.category?[e.category]:[])])];
  for(const c of choices) category.append(el('option',{value:c,text:c})); category.value=e.category;
  const provider = input('field-provider',e.provider,'z. B. OpenAI, Microsoft, Gemini');
  const username = input('field-username',e.username,'Optional: Konto / Benutzer');
  const url = input('field-url',e.url,'https://...');
  const tags = input('field-tags',e.tags,'z. B. Entwicklung, Produktion');
  const notes = el('textarea',{id:'field-notes',placeholder:'Optionale Hinweise, Abläufe oder Beschreibungen ...',rows:'3'});notes.value=e.notes;
  const rows = el('div',{id:'field-rows'});
  for (const f of e.fields) rows.append(makeField(f.label,f.value,f.secret));
  const addField = button('＋ Feld hinzufügen','secondary',()=>rows.append(makeField('','',true)));
  const parts = [labeled('Bezeichnung *',title),el('div',{className:'grid2'},labeled('Kategorie',category),labeled('Anbieter / Dienst',provider)),el('div',{className:'grid2'},labeled('Benutzer / Konto',username),labeled('Website / URL',url)),labeled('Tags (kommagetrennt)',tags),el('hr',{className:'divider'}),el('div',{className:'section-header'},el('h3',{text:'Flexible Datenfelder'}),addField),el('p',{className:'help',text:'Jedes Feld kann ein API-Key, Secret, Passwort, Tenant-ID, Client-ID, Token oder ein beliebiger Wert sein. „Geheim“ blendet den Wert in der Ansicht aus.'}),rows,labeled('Notizen',notes)];
  modal(original ? 'Eintrag bearbeiten' : 'Neuer Eintrag',parts,[button('Abbrechen','secondary',closeModal),button('Speichern','primary',async()=>{
    const payload = {id:original?.id,title:title.value,category:category.value,provider:provider.value,username:username.value,url:url.value,tags:tags.value,notes:notes.value,fields:[...rows.children].map(r=>r.getData()).filter(f=>f.label || f.value)};
    if(!payload.title.trim()) return showToast('Bitte eine Bezeichnung eingeben.',true);
    if(payload.fields.some(f=>!f.label)) return showToast('Bitte alle Datenfelder benennen.',true);
    try { await api('entry','POST',payload);closeModal();await reload();showToast(original?'Eintrag aktualisiert.':'Eintrag sicher gespeichert.'); } catch(err) {showToast(err.message,true);}
  })]);
  rememberDialog(original ? 'edit' : 'new', original?.id || null);
  title.focus();
}
async function copyValue(value) {
  try { await navigator.clipboard.writeText(value);showToast('In die Zwischenablage kopiert. Bitte nach Verwendung leeren.'); }
  catch { showToast('Kopieren fehlgeschlagen. Bitte manuell markieren.',true); }
}
function viewEntry(id) {
  const e = entries.find(x=>x.id===id); if(!e)return;
  const parts=[el('div',{className:'info-panel',text:`${e.category}  ·  Erstellt ${new Date(e.createdAt).toLocaleString('de-CH')}  ·  Geändert ${new Date(e.updatedAt).toLocaleString('de-CH')}`})];
  for(const [label,value] of [['Anbieter',e.provider],['Benutzer / Konto',e.username],['URL',e.url],['Tags',e.tags]]) if(value) parts.push(el('div',{className:'read-row'},el('div',{className:'read-label',text:label}),el('div',{className:'read-value',text:value})));
  if(e.fields.length) parts.push(el('hr',{className:'divider'}));
  for(const field of e.fields) {
    let visible=!field.secret;
    const code=el('code',{text:visible?field.value:'••••••••••••••••'});
    const showBtn = button(visible?'Verbergen':'Anzeigen','secondary',()=>{visible=!visible;code.textContent=visible?field.value:'••••••••••••••••';showBtn.textContent=visible?'Verbergen':'Anzeigen';});
    parts.push(el('div',{className:'read-row'},el('div',{className:'read-label',text:field.label}),el('div',{className:'secret-value'},code,...(field.secret?[showBtn]:[]),button('Kopieren','secondary',()=>copyValue(field.value)))));
  }
  if(e.notes) parts.push(el('div',{className:'read-row'},el('div',{className:'read-label',text:'Notizen'}),el('div',{className:'read-value',style:'white-space:pre-wrap',text:e.notes})));
  modal(e.title,parts,[button('Löschen','danger',()=>deletePrompt(e)),button('Schliessen','secondary',closeModal),button('✎ Bearbeiten','primary',()=>entryForm(e))]);
  rememberDialog('view', e.id);
}
function deletePrompt(e) {
  modal('Eintrag löschen?', [el('p',{className:'help',text:`Der Eintrag „${e.title}“ wird dauerhaft aus dem Tresor entfernt. Diese Aktion kann nicht rückgängig gemacht werden. Ein vorhandenes Backup bleibt unverändert.`})],
    [button('Abbrechen','secondary',()=>viewEntry(e.id)),button('Endgültig löschen','danger',async()=>{try{await api('delete','POST',{id:e.id});closeModal();await reload();showToast('Eintrag gelöscht.');}catch(err){showToast(err.message,true);}})]);
}
function changePassword() {
  const old=input('old-pass','','Aktuelles Masterpasswort','password');
  const next=input('new-pass','','Neues Masterpasswort (mind. 12 Zeichen)','password');
  const confirm=input('confirm-pass','','Neues Passwort wiederholen','password');
  modal('Masterpasswort ändern',[el('div',{className:'info-panel',text:'Beim Ändern wird der gesamte Tresor mit einem neuen Schlüssel und neuem Salt verschlüsselt. Bewahre das neue Passwort sicher auf.'}),labeled('Aktuelles Masterpasswort',old),labeled('Neues Masterpasswort',next),labeled('Neues Passwort bestätigen',confirm)],
    [button('Abbrechen','secondary',closeModal),button('Passwort ändern','primary',async()=>{
      if(next.value.length<12)return showToast('Mindestens 12 Zeichen erforderlich.',true);
      if(next.value!==confirm.value)return showToast('Die neuen Passwörter stimmen nicht überein.',true);
      try {await api('password','POST',{oldPassword:old.value,newPassword:next.value});closeModal();showToast('Masterpasswort geändert und Tresor neu verschlüsselt.');}catch(err){showToast(err.message,true);}
    })]);
}
async function exportBackup() {
  try {
    const r=await fetch('/api/export',{credentials:'same-origin',cache:'no-store'});
    if(!r.ok)throw new Error('Backup konnte nicht erstellt werden.');
    const blob=await r.blob();const url=URL.createObjectURL(blob);const a=el('a',{href:url,download:`secret-tresor-backup-${new Date().toISOString().slice(0,10)}.enc.json`});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
    showToast('Verschlüsseltes Backup heruntergeladen.');
  }catch(err){showToast(err.message,true);}
}
function importBackup(text) {
  const password=input('restore-pass','','Masterpasswort des Backups','password');
  const confirm=input('restore-confirm','','ERSETZEN eingeben');
  modal('Backup wiederherstellen',[el('div',{className:'warning',text:'Achtung: Der aktuelle Tresor wird durch das gewählte verschlüsselte Backup ersetzt. Vorher wird automatisch eine verschlüsselte Sicherheitskopie der aktuellen Daten im data-Ordner erstellt.'}),labeled('Masterpasswort des Backups',password),labeled('Zur Bestätigung ERSETZEN eingeben',confirm)],
  [button('Abbrechen','secondary',closeModal),button('Tresor ersetzen','danger',async()=>{
    if(confirm.value!=='ERSETZEN')return showToast('Bitte ERSETZEN eingeben.',true);
    try{await api('import','POST',{backup:text,password:password.value,confirmation:confirm.value});showToast('Backup wiederhergestellt. Bitte erneut entsperren.');await showAuth();}catch(err){showToast(err.message,true);}
  })]);
}
$('auth-form').addEventListener('submit',async e=>{
  e.preventDefault(); const password=$('master').value;
  const setup=$('auth-form').dataset.setup==='true';
  if(setup && password!==$('master-confirm').value)return showToast('Die Masterpasswörter stimmen nicht überein.',true);
  $('auth-button').disabled=true;
  try{const r=await api(setup?'setup':'unlock','POST',{password});await openApp(r.csrf);}
  catch(err){showToast(err.message,true);}finally{$('auth-button').disabled=false;}
});
$('master-eye').addEventListener('click',()=>$('master').type=$('master').type==='password'?'text':'password');
$('new-btn').addEventListener('click',()=>entryForm());$('empty-new-btn').addEventListener('click',()=>entryForm());
$('search').addEventListener('input',()=>{renderEntries();saveUI();});$('sort').addEventListener('change',()=>{renderEntries();saveUI();});
document.querySelector('.nav[data-category="Alle"]').addEventListener('click',()=>chooseCategory('Alle'));
$('modal-close').addEventListener('click',closeModal);
// A drag selection can end outside the dialog. Backdrop clicks must never dismiss it.
$('modal').addEventListener('click',e=>{if(e.target===$('modal'))e.preventDefault();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('modal').hidden)closeModal();});
$('lock-btn').addEventListener('click',async()=>{try{await api('lock','POST');await showAuth();showToast('Tresor gesperrt.');}catch(err){showToast(err.message,true);}});
$('backup-btn').addEventListener('click',exportBackup);
$('change-password-btn').addEventListener('click',changePassword);
$('import-btn').addEventListener('click',()=>$('import-file').click());
$('import-file').addEventListener('change',async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;if(file.size>5*1024*1024)return showToast('Backup zu gross (maximal 5 MB).',true);try{importBackup(await file.text());}catch(err){showToast('Datei konnte nicht gelesen werden.',true);}});
// Sync frontend on server-side auto-lock; no background refresh of idle timer.
setInterval(async()=>{
  if(!csrf)return;
  try{const state=await api('status');if(!state.unlocked)await showAuth();}
  catch { /* server offline */ }
},30000);
(async()=>{try{const st=await api('status');if(st.unlocked)await openApp(st.csrf);else await showAuth();}catch(err){showToast(err.message,true);}})();
