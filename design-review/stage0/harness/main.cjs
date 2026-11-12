// Electron entry used ONLY for the design review.
// It boots the already-built, unmodified app (dist-electron/main/index.js) inside a
// sandbox: a throwaway HOME, a fake Keychain, a fake Google/AI backend and no real
// network. Nothing here touches the user's mailbox, Keychain or main-branch code.
//
//   DR_PROFILE=<dir>   throwaway home directory (required)
//   DR_OAUTH=0         do not provide a Google OAuth client file (first-run error state)
//   DR_AI=1            pre-configure the fake OpenAI-compatible provider
//   DR_CONTROL_PORT    port of the local control server (default 9334)
'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const util = require('util');
const childProcess = require('child_process');

const profile = process.env.DR_PROFILE;
if (!profile) throw new Error('DR_PROFILE is required');
fs.mkdirSync(profile, { recursive: true });
process.env.HOME = profile;

const { app, shell, Notification, dialog } = require('electron');
app.setPath('userData', path.join(profile, 'userData'));
app.setPath('downloads', path.join(profile, 'Downloads'));
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('force-device-scale-factor', '1');

const logDir = path.join(profile, 'logs');
fs.mkdirSync(logDir, { recursive: true });

// --- config files inside the throwaway HOME ---------------------------------
const configDir = path.join(profile, '.config', 'dumka-mail');
fs.mkdirSync(configDir, { recursive: true });
if (process.env.DR_OAUTH !== '0') {
  fs.writeFileSync(path.join(configDir, 'google-oauth-client.json'), JSON.stringify({
    installed: {
      client_id: 'synthetic-client.apps.example', project_id: 'design-review',
      auth_uri: 'https://accounts.synthetic.example/o/oauth2/auth',
      token_uri: 'https://oauth2.googleapis.com/token', redirect_uris: ['http://127.0.0.1'],
    },
  }));
}
if (process.env.DR_AI === '1') {
  fs.writeFileSync(path.join(configDir, 'ai.env'), [
    'OPENAI_COMPATIBLE_NAME=Synthetic Model',
    'OPENAI_COMPATIBLE_BASE_URL=https://ai.synthetic.example/v1',
    'OPENAI_COMPATIBLE_MODEL=synthetic-mail-model',
    'OPENAI_COMPATIBLE_API_KEY=synthetic-key', '',
  ].join('\n'));
}

// --- fake Keychain (`security` CLI) -----------------------------------------
const keychainFile = path.join(profile, 'fake-keychain.json');
const readKeychain = () => { try { return JSON.parse(fs.readFileSync(keychainFile, 'utf8')); } catch { return {}; } };
const realExecFile = childProcess.execFile;
function fakeSecurity(args) {
  const get = flag => args[args.indexOf(flag) + 1];
  const key = `${get('-s')}::${get('-a')}`;
  const store = readKeychain();
  if (args[0] === 'add-generic-password') { store[key] = get('-w'); fs.writeFileSync(keychainFile, JSON.stringify(store)); return ''; }
  if (args[0] === 'find-generic-password') {
    if (!(key in store)) throw Object.assign(new Error('The specified item could not be found in the keychain.'), { code: 44 });
    return `${store[key]}\n`;
  }
  if (args[0] === 'delete-generic-password') {
    if (!(key in store)) throw Object.assign(new Error('not found'), { code: 44 });
    delete store[key]; fs.writeFileSync(keychainFile, JSON.stringify(store)); return '';
  }
  return '';
}
function patchedExecFile(file, args, ...rest) {
  if (file !== 'security') return realExecFile.call(childProcess, file, args, ...rest);
  const callback = rest.find(item => typeof item === 'function');
  try { const stdout = fakeSecurity(args || []); if (callback) setImmediate(() => callback(null, stdout, '')); }
  catch (error) { if (callback) setImmediate(() => callback(error, '', '')); }
  return undefined;
}
patchedExecFile[util.promisify.custom] = (file, args, options) => {
  if (file !== 'security') return util.promisify(realExecFile)(file, args, options);
  return new Promise((resolve, reject) => {
    try { resolve({ stdout: fakeSecurity(args || []), stderr: '' }); } catch (error) { reject(error); }
  });
};
childProcess.execFile = patchedExecFile;

// --- fake network -------------------------------------------------------------
const { createBackend } = require('./fake-backend.cjs');
const { WORK, HOME } = require('./dataset.cjs');
const backend = createBackend({
  logDir,
  workBulk: Number(process.env.DR_WORK_BULK || 6000),
  homeBulk: Number(process.env.DR_HOME_BULK || 1500),
  bigInbox: Number(process.env.DR_BIG_INBOX || 0),
});
if (process.env.DR_CALENDAR === '0') backend.state.grantCalendar = false;
globalThis.fetch = backend.fakeFetch;

// --- OAuth: complete the loopback flow without a browser ---------------------
const signInQueue = (process.env.DR_SIGNIN_ORDER || `${WORK.email},${HOME.email}`).split(',');
let signInDelayMs = Number(process.env.DR_SIGNIN_DELAY_MS || 1200);
shell.openExternal = async target => {
  const url = new URL(target);
  if (url.hostname !== 'accounts.synthetic.example') {
    fs.appendFileSync(path.join(logDir, 'open-external.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), url: target })}\n`);
    return;
  }
  const redirect = url.searchParams.get('redirect_uri');
  const stateParam = url.searchParams.get('state');
  const hint = url.searchParams.get('login_hint');
  const email = hint || signInQueue.shift() || WORK.email;
  setTimeout(() => {
    http.get(`${redirect}?code=${encodeURIComponent(email)}&state=${encodeURIComponent(stateParam)}`, res => res.resume())
      .on('error', error => console.error('[design-review] loopback redirect failed', error));
  }, signInDelayMs);
};

// --- keep the desktop quiet ---------------------------------------------------
try { Notification.prototype.show = function show() {}; } catch { /* ignore */ }
dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
dialog.showErrorBox = (title, content) => console.error('[design-review] error box', title, content);

app.on('browser-window-created', (_event, win) => {
  const width = Number(process.env.DR_WIDTH || 1440);
  const height = Number(process.env.DR_HEIGHT || 900);
  win.once('ready-to-show', () => { try { win.setBounds({ x: 40, y: 40, width, height }); } catch { /* ignore */ } });
  setTimeout(() => { try { win.setBounds({ x: 40, y: 40, width, height }); } catch { /* ignore */ } }, 800);
});

// --- control server (toggle offline, inject mail, break things) ---------------
const controlPort = Number(process.env.DR_CONTROL_PORT || 9334);
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  let raw = '';
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { /* ignore */ }
    const reply = payload => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload)); };
    if (url.pathname === '/state') {
      Object.entries(body).forEach(([key, value]) => {
        if (key === 'revoke') backend.state.revokeAccounts = new Set(value);
        else if (key === 'signInDelayMs') signInDelayMs = Number(value);
        else if (key in backend.state) backend.state[key] = value;
      });
      return reply({ ...backend.state, revokeAccounts: Array.from(backend.state.revokeAccounts), blocked: backend.state.blocked.slice(-20) });
    }
    if (url.pathname === '/inject') return reply({ threadIds: backend.injectMail(body.email, body.spec) });
    if (url.pathname === '/quit') { reply({ ok: true }); setTimeout(() => app.quit(), 100); return undefined; }
    return reply({ ok: false, error: 'unknown control path' });
  });
}).listen(controlPort, '127.0.0.1');

// --- boot the real, unmodified application ------------------------------------
require(path.join(process.env.DR_APP_DIR || path.join(__dirname, '..', '..', '..'), 'dist-electron', 'main', 'index.js'));
