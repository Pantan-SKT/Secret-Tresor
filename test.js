'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-tresor-test-'));
const port = 20000 + crypto.randomInt(20000);
const url = `http://127.0.0.1:${port}`;
const proc = spawn(process.execPath, ['server.js'], {cwd:__dirname, env:{...process.env, SECRET_TRESOR_PORT:String(port), SECRET_TRESOR_DATA_DIR:dataDir, SECRET_TRESOR_NO_BROWSER:'1'}, stdio:'pipe'});
let cookie='', csrf='';
async function req(api, method='GET', body, useCsrf=true) {
  const r=await fetch(url+'/api/'+api,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(csrf&&useCsrf?{'x-csrf-token':csrf}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const set=r.headers.get('set-cookie');if(set)cookie=set.split(';')[0];
  const text=await r.text();let payload;try{payload=JSON.parse(text);}catch{payload=text;}
  return {status:r.status,payload};
}
(async()=>{
  for(let i=0;i<100;i++){try{await fetch(url);break;}catch{await new Promise(r=>setTimeout(r,30));}}
  let r=await req('status');assert.equal(r.payload.exists,false);
  r=await req('setup','POST',{password:'example-super-long-password-2026'});assert.equal(r.status,200);csrf=r.payload.csrf;
  r=await req('entry','POST',{title:'Provider 1',category:'API / KI',provider:'AI Provider',url:'',username:'',notes:'',tags:'',fields:[{label:'API-Key',value:'sk-example-123',secret:true},{label:'Client-ID',value:'abc-456',secret:false}]});assert.equal(r.status,200);
  const id=r.payload.entry.id;
  const raw=fs.readFileSync(path.join(dataDir,'vault.enc.json'),'utf8');assert.equal(raw.includes('sk-example-123'),false,'plaintext in vault');assert.equal(raw.includes('Provider 1'),false,'metadata plaintext in vault');
  r=await req('entries');assert.equal(r.payload.entries[0].fields[0].value,'sk-example-123');
  r=await req('entries','GET',undefined,false);assert.equal(r.status,200);
  r=await req('delete','POST',{id},false);assert.equal(r.status,403,'mutation requires csrf');
  r=await req('lock','POST');assert.equal(r.status,200);
  r=await req('entries');assert.equal(r.status,401);
  r=await req('unlock','POST',{password:'wrong-but-long-password'});assert.equal(r.status,401);
  r=await req('unlock','POST',{password:'example-super-long-password-2026'});assert.equal(r.status,200);csrf=r.payload.csrf;
  r=await req('password','POST',{oldPassword:'example-super-long-password-2026',newPassword:'different-long-master-2026'});assert.equal(r.status,200);
  r=await req('lock','POST');assert.equal(r.status,200);
  r=await req('unlock','POST',{password:'example-super-long-password-2026'});assert.equal(r.status,401);
  r=await req('unlock','POST',{password:'different-long-master-2026'});assert.equal(r.status,200);csrf=r.payload.csrf;
  r=await req('delete','POST',{id});assert.equal(r.status,200);
  r=await req('entries');assert.equal(r.payload.entries.length,0);
  console.log('PASS: setup, AES-Vault-Verschluesselung, CRUD, Cookie/CSRF, Sperre, Unlock, Passwortwechsel');
})().catch(e=>{console.error('TEST FAILED',e);process.exitCode=1;}).finally(()=>{proc.kill();fs.rmSync(dataDir,{force:true,recursive:true});});
