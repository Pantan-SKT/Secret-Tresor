'use strict';
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);

const HOST = '127.0.0.1';
const PORT = Number(process.env.SECRET_TRESOR_PORT || 6217);
const VAULT_DIR = process.env.SECRET_TRESOR_DATA_DIR || path.join(__dirname, 'data');
const VAULT_PATH = path.join(VAULT_DIR, 'vault.enc.json');
const IDLE_MS = 15 * 60 * 1000;
const MAX_BODY = 6 * 1024 * 1024;
const MAX_ENTRIES = 5000;
const KDF = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
let active = null;
let failed = 0;
let blockedUntil = 0;
const assets = {
  '/': ['public/index.html', 'text/html; charset=utf-8'],
  '/app.js': ['public/app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['public/style.css', 'text/css; charset=utf-8']
};

function error(code, message) { const e = new Error(message); e.status = code; throw e; }
function headers(res, status, type = 'application/json; charset=utf-8', extras = {}) {
  res.writeHead(status, {
    'Content-Type': type, 'Cache-Control': 'no-store, max-age=0', 'Pragma': 'no-cache',
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
    ...extras
  });
}
function json(res, status, value, extra) { headers(res, status, undefined, extra); res.end(JSON.stringify(value)); }
function cookie(req) {
  const text = req.headers.cookie || '';
  const match = text.match(/(?:^|;\s*)st_session=([a-f0-9]{64})(?:;|$)/);
  return match?.[1] || '';
}
function forget() {
  if (active?.key) active.key.fill(0);
  active = null;
}
function getSession(req, csrf = false) {
  if (active && Date.now() - active.last > IDLE_MS) forget();
  if (!active || cookie(req) !== active.token) error(401, 'Tresor gesperrt.');
  if (csrf && req.headers['x-csrf-token'] !== active.csrf) error(403, 'Sicherheitspruefung fehlgeschlagen.');
  active.last = Date.now();
  return active;
}
function checkOrigin(req) {
  const origin = req.headers.origin;
  if (origin && origin !== `http://${HOST}:${PORT}`) error(403, 'Ungueltige Herkunft.');
  if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) error(403, 'Fremder Aufruf blockiert.');
}
async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) error(413, 'Datei oder Anfrage zu gross.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { error(400, 'Ungueltiges JSON.'); }
}
function validPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 512) error(400, 'Masterpasswort: mindestens 12, maximal 512 Zeichen.');
}
function vaultExists() { return fs.existsSync(VAULT_PATH); }
async function derive(password, salt) { return await scrypt(password, salt, 32, KDF); }
function validateEnvelope(v) {
  if (!v || v.format !== 'secret-tresor' || v.version !== 1 || !v.kdf || v.kdf.name !== 'scrypt' || v.kdf.N !== 32768 || v.kdf.r !== 8 || v.kdf.p !== 1) error(400, 'Nicht unterstuetztes Tresorformat.');
  for (const [name, length] of [['salt', 16], ['iv', 12], ['tag', 16]]) {
    if (typeof v[name] !== 'string' || !/^[a-f0-9]+$/i.test(v[name]) || v[name].length !== length * 2) error(400, 'Tresordatei beschaedigt.');
  }
  if (typeof v.ciphertext !== 'string' || v.ciphertext.length > 8 * 1024 * 1024 || !/^[a-zA-Z0-9+/=]+$/.test(v.ciphertext)) error(400, 'Ungueltige verschluesselte Daten.');
}
async function decrypt(v, password) {
  validateEnvelope(v);
  const key = await derive(password, Buffer.from(v.salt, 'hex'));
  try {
    const cipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(v.iv, 'hex'));
    cipher.setAuthTag(Buffer.from(v.tag, 'hex'));
    const plain = Buffer.concat([cipher.update(Buffer.from(v.ciphertext, 'base64')), cipher.final()]).toString('utf8');
    const data = JSON.parse(plain);
    if (!data || !Array.isArray(data.entries)) error(400, 'Ungueltiges Tresorformat.');
    return { key, data, salt: v.salt };
  } catch (err) { key.fill(0); if (err.status) throw err; error(401, 'Masterpasswort falsch oder Tresor beschaedigt.'); }
}
function encrypt(data, key, salt) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return { format: 'secret-tresor', version: 1, kdf: { name: 'scrypt', N: 32768, r: 8, p: 1 }, salt, iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), ciphertext: ciphertext.toString('base64') };
}
async function saveEnvelope(env) {
  await fsp.mkdir(VAULT_DIR, { recursive: true, mode: 0o700 });
  const tmp = path.join(VAULT_DIR, `.vault-${crypto.randomUUID()}.tmp`);
  try {
    await fsp.writeFile(tmp, JSON.stringify(env, null, 2), { flag: 'wx', mode: 0o600 });
    await fsp.rename(tmp, VAULT_PATH);
  } finally { await fsp.rm(tmp, { force: true }).catch(() => {}); }
}
async function persist(s) { await saveEnvelope(encrypt(s.data, s.key, s.salt)); }
function validateEntry(e) {
  if (!e || typeof e !== 'object' || typeof e.title !== 'string' || !e.title.trim() || e.title.length > 200) error(400, 'Bezeichnung fehlt oder ist zu lang.');
  if (!Array.isArray(e.fields) || e.fields.length > 30) error(400, 'Maximal 30 Felder erlaubt.');
  for (const f of e.fields) {
    if (!f || typeof f.label !== 'string' || f.label.length > 100 || typeof f.value !== 'string' || f.value.length > 20000 || typeof f.secret !== 'boolean') error(400, 'Ungueltiges Feld.');
  }
  for (const name of ['category','provider','url','username','notes','tags']) {
    if (typeof e[name] !== 'string' || e[name].length > (name === 'notes' ? 10000 : 1000)) error(400, `Ungueltiges Feld: ${name}`);
  }
}
function cleanEntry(e, existing) {
  return { id: existing?.id || crypto.randomUUID(), title: e.title.trim(), category: e.category, provider: e.provider, url: e.url,
    username: e.username, notes: e.notes, tags: e.tags, fields: e.fields.map(f => ({ label: f.label.trim(), value: f.value, secret: f.secret })),
    createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
}
function checkThrottle() { if (Date.now() < blockedUntil) error(429, `Zu viele Versuche. Bitte spaeter erneut versuchen.`); }
function failure() { failed++; if (failed >= 5) blockedUntil = Date.now() + Math.min(300000, 30000 * (failed - 4)); }
function success() { failed = 0; blockedUntil = 0; }
function sessionCookie(token) { return `st_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`; }
function newSession(v) { forget(); active = { ...v, token: crypto.randomBytes(32).toString('hex'), csrf: crypto.randomBytes(32).toString('hex'), last: Date.now() }; return active; }

async function route(req, res) {
  if (req.headers.host !== `${HOST}:${PORT}`) error(403, 'Unbekannter Host.');
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const p = url.pathname;
  if (req.method === 'GET' && assets[p]) {
    const [file, type] = assets[p];
    headers(res, 200, type);
    return fs.createReadStream(path.join(__dirname, file)).pipe(res);
  }
  if (!p.startsWith('/api/')) error(404, 'Nicht gefunden.');
  checkOrigin(req);
  if (req.method === 'GET' && p === '/api/status') {
    const s = active && cookie(req) === active.token && Date.now() - active.last <= IDLE_MS ? active : null;
    if (active && !s && Date.now() - active.last > IDLE_MS) forget();
    return json(res, 200, { exists: vaultExists(), unlocked: !!s, csrf: s?.csrf || null, idleMinutes: 15 });
  }
  if (req.method === 'POST' && p === '/api/setup') {
    if (vaultExists()) error(409, 'Tresor existiert bereits.');
    const { password } = await body(req); validPassword(password);
    const salt = crypto.randomBytes(16).toString('hex');
    const key = await derive(password, Buffer.from(salt, 'hex'));
    const data = { entries: [], createdAt: new Date().toISOString() };
    await saveEnvelope(encrypt(data, key, salt));
    const s = newSession({ key, salt, data });
    return json(res, 200, { ok: true, csrf: s.csrf }, { 'Set-Cookie': sessionCookie(s.token) });
  }
  if (req.method === 'POST' && p === '/api/unlock') {
    if (!vaultExists()) error(404, 'Bitte zuerst einen Tresor erstellen.');
    checkThrottle();
    const { password } = await body(req);
    if (typeof password !== 'string' || password.length > 512) error(400, 'Masterpasswort ungueltig.');
    let opened;
    try { opened = await decrypt(JSON.parse(await fsp.readFile(VAULT_PATH, 'utf8')), password); }
    catch (err) { failure(); throw err; }
    success(); const s = newSession(opened);
    return json(res, 200, { ok: true, csrf: s.csrf }, { 'Set-Cookie': sessionCookie(s.token) });
  }
  if (req.method === 'POST' && p === '/api/lock') {
    getSession(req, true); forget();
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'st_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }
  if (req.method === 'GET' && p === '/api/entries') {
    const s = getSession(req); return json(res, 200, { entries: s.data.entries });
  }
  if (req.method === 'POST' && p === '/api/entry') {
    const s = getSession(req, true); const e = await body(req); validateEntry(e);
    const existing = e.id ? s.data.entries.find(x => x.id === e.id) : null;
    if (e.id && !existing) error(404, 'Eintrag nicht vorhanden.');
    if (!existing && s.data.entries.length >= MAX_ENTRIES) error(413, 'Maximale Anzahl Eintraege erreicht.');
    const item = cleanEntry(e, existing);
    const next = s.data.entries.filter(x => x.id !== item.id).concat(item);
    const old = s.data.entries; s.data.entries = next;
    try { await persist(s); } catch (err) { s.data.entries = old; throw err; }
    return json(res, 200, { entry: item });
  }
  if (req.method === 'POST' && p === '/api/delete') {
    const s = getSession(req, true); const { id } = await body(req);
    if (!s.data.entries.some(x => x.id === id)) error(404, 'Eintrag nicht gefunden.');
    const old = s.data.entries; s.data.entries = old.filter(x => x.id !== id);
    try { await persist(s); } catch (err) { s.data.entries = old; throw err; }
    return json(res, 200, { ok: true });
  }
  if (req.method === 'POST' && p === '/api/password') {
    const s = getSession(req, true); const { oldPassword, newPassword } = await body(req);
    validPassword(newPassword);
    checkThrottle();
    let verify;
    try { verify = await decrypt(JSON.parse(await fsp.readFile(VAULT_PATH, 'utf8')), oldPassword); }
    catch (err) { failure(); throw err; }
    verify.key.fill(0); success();
    const salt = crypto.randomBytes(16).toString('hex');
    const key = await derive(newPassword, Buffer.from(salt, 'hex'));
    try { await saveEnvelope(encrypt(s.data, key, salt)); }
    catch (err) { key.fill(0); throw err; }
    s.key.fill(0); s.key = key; s.salt = salt;
    return json(res, 200, { ok: true });
  }
  if (req.method === 'GET' && p === '/api/export') {
    getSession(req);
    const content = await fsp.readFile(VAULT_PATH);
    headers(res, 200, 'application/octet-stream', { 'Content-Disposition': `attachment; filename="secret-tresor-backup-${new Date().toISOString().slice(0,10)}.enc.json"` });
    return res.end(content);
  }
  if (req.method === 'POST' && p === '/api/import') {
    getSession(req, true); const { backup, password, confirmation } = await body(req);
    if (confirmation !== 'ERSETZEN') error(400, 'Zur Bestaetigung ERSETZEN eingeben.');
    checkThrottle();
    let env; try { env = JSON.parse(backup); } catch { error(400, 'Ungueltige Backup-Datei.'); }
    let opened;
    try { opened = await decrypt(env, password); } catch (err) { failure(); throw err; }
    success();
    const archive = path.join(VAULT_DIR, `vault-before-import-${new Date().toISOString().replace(/[:.]/g, '-')}.enc.json`);
    try { await fsp.copyFile(VAULT_PATH, archive, fs.constants.COPYFILE_EXCL); await saveEnvelope(env); }
    catch (err) { opened.key.fill(0); throw err; }
    forget();
    return json(res, 200, { ok: true, archivedAs: path.basename(archive) }, { 'Set-Cookie': 'st_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }
  error(404, 'Endpunkt nicht gefunden.');
}

setInterval(() => { if (active && Date.now() - active.last > IDLE_MS) forget(); }, 30000).unref();
const server = http.createServer((req, res) => {
  route(req, res).catch(e => {
    if (res.headersSent) { res.destroy(); return; }
    if (!e.status) console.error('Interner Fehler:', e);
    json(res, e.status || 500, { error: e.status ? e.message : 'Interner Serverfehler.' });
  });
});
server.listen(PORT, HOST, () => {
  console.log(`\nSecret-Tresor: http://${HOST}:${PORT}`);
  console.log(`Daten: ${VAULT_PATH}`);
  console.log('Nur lokal erreichbar. Zum Beenden STRG+C.\n');
  if (process.platform === 'win32' && !process.env.SECRET_TRESOR_NO_BROWSER) {
    const child = spawn('cmd', ['/c', 'start', '', `http://${HOST}:${PORT}`], { stdio: 'ignore', windowsHide: true });
    child.on('error', () => {}); child.unref();
  }
});
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => { forget(); server.close(() => process.exit(0)); });
