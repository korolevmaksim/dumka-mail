// Responsiveness measurements for the unmodified app (criterion 3).
// Every number is "physical input event -> first frame after the UI reached the target state",
// measured inside the renderer with performance.now(). Usage: node measure.mjs <label> [reps]
import fs from 'node:fs';
import { connect, sleep } from './cdp.mjs';

const label = process.argv[2] || 'run';
const REPS = Number(process.argv[3] || 15);
const ONLY = (process.argv[4] || '').split(',').filter(Boolean);
const want = name => ONLY.length === 0 || ONLY.includes(name);
const page = await connect();

await page.eval(`(() => {
  window.__drArm = (predSrc, timeoutMs = 10000) => new Promise(resolve => {
    const pred = new Function('return (' + predSrc + ')');
    let t0 = null; let ts = null; let done = false;
    const onInput = e => { if (t0 === null) { t0 = performance.now(); ts = e.timeStamp; } };
    const events = ['keydown', 'input', 'mousedown'];
    events.forEach(name => window.addEventListener(name, onInput, true));
    const longTasks = [];
    let po = null;
    try { po = new PerformanceObserver(list => list.getEntries().forEach(e => longTasks.push(Math.round(e.duration)))); po.observe({ entryTypes: ['longtask'] }); } catch (e) {}
    const started = performance.now();
    let pending = false;
    const finish = payload => {
      if (done) return; done = true;
      events.forEach(name => window.removeEventListener(name, onInput, true));
      mo.disconnect();
      setTimeout(() => { if (po) po.disconnect(); resolve({ ...payload, longTasks }); }, 60);
    };
    const check = () => {
      if (done || pending || t0 === null) return;
      let ok = false; try { ok = !!pred(); } catch (e) {}
      if (!ok) return;
      pending = true;
      const tDom = performance.now();
      requestAnimationFrame(() => {
        const tFrame = performance.now();
        finish({ domMs: +(tDom - t0).toFixed(1), frameMs: +(tFrame - t0).toFixed(1), fromEventMs: +(tFrame - ts).toFixed(1) });
      });
    };
    const mo = new MutationObserver(() => check());
    mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    const tick = () => {
      if (done) return;
      check();
      if (performance.now() - started > timeoutMs) { finish({ timeout: true }); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  window.__drRows = () => Array.from(document.querySelectorAll('[data-thread-row]'));
  window.__drSel = () => { const r = window.__drRows().find(x => x.querySelector('.dm-selection-rail')); return r ? r.getAttribute('aria-label') : null; };
  window.__drFirst = () => { const r = window.__drRows()[0]; return r ? r.getAttribute('aria-label') : ''; };
  window.__drTitle = () => (document.querySelector('.dm-reader-header h1')?.innerText || '');
  window.__drBodyReady = () => { const f = document.querySelector('iframe[title="Email message content"]'); try { return !!(f && f.contentDocument && f.contentDocument.body && f.contentDocument.body.innerText.trim().length > 10); } catch (e) { return false; } };
  window.__drSearchDone = () => Array.from(document.querySelectorAll('[aria-live="polite"]')).some(e => /^Done/.test(e.innerText.trim()));
})()`);

async function measure(predSrc, act, timeoutMs) {
  await page.eval(`window.__drP = window.__drArm(${JSON.stringify(predSrc)}, ${timeoutMs || 10000}); 0`);
  await act();
  return page.eval('window.__drP');
}

const stats = samples => {
  const ok = samples.filter(s => s && !s.timeout);
  const pick = key => ok.map(s => s[key]).sort((a, b) => a - b);
  const q = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(p * arr.length))] : null);
  const frame = pick('frameMs');
  const long = ok.flatMap(s => s.longTasks || []);
  return {
    n: ok.length, timeouts: samples.length - ok.length,
    medianMs: q(frame, 0.5), p95Ms: q(frame, 0.95), minMs: frame[0] ?? null, maxMs: frame[frame.length - 1] ?? null,
    medianDomMs: q(pick('domMs'), 0.5),
    longTasks: long.length, maxLongTaskMs: long.length ? Math.max(...long) : 0,
  };
};

const results = { label, at: new Date().toISOString(), reps: REPS, env: await page.eval(`({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, ua: navigator.userAgent, cores: navigator.hardwareConcurrency })`) };
const settle = () => sleep(350);

// make sure a row has focus and nothing is open
async function resetToWorkImportant() {
  await page.key('Escape'); await sleep(150); await page.key('Escape'); await sleep(150);
  await page.key('1', { meta: true }); await sleep(600);
  await page.key('1'); await sleep(400);
  await page.click({ selector: '[data-thread-row]', nth: 0 }); await sleep(500);
  await page.key('Escape'); await sleep(300);
}

// --- 1. keyboard navigation in the list -----------------------------------------
await resetToWorkImportant();
if (want('nav')) {
  const samples = [];
  for (let i = 0; i < REPS; i++) {
    const before = await page.eval('window.__drSel()');
    const key = i % 6 < 3 ? 'j' : 'k';
    samples.push(await measure(`window.__drSel() !== ${JSON.stringify(before)}`, () => page.key(key), 3000));
    await sleep(120);
  }
  results.listNavigateJK = stats(samples);
  console.error('[done] listNavigateJK', JSON.stringify(results.listNavigateJK));
}

// --- 2. open thread (header and body) + close ------------------------------------
async function openClose(name, prepare) {
  const open = []; const body = []; const close = [];
  for (let i = 0; i < REPS; i++) {
    await prepare(i);
    await settle();
    const sel = await page.eval('window.__drSel()');
    const subject = (/subject (.*?), (label|preview|has|last)/.exec(sel || '') || [])[1] || '';
    const head = subject.slice(0, 24);
    open.push(await measure(`window.__drTitle().includes(${JSON.stringify(head)}) && ${JSON.stringify(head)}.length > 0`, () => page.key('Enter'), 8000));
    // body: armed separately so it includes iframe paint; re-open to measure end-to-end
    await sleep(700);
    close.push(await measure(`!document.querySelector('.dm-reader-header h1')`, () => page.key('Escape'), 5000));
    await sleep(250);
    body.push(await measure(`window.__drTitle().includes(${JSON.stringify(head)}) && window.__drBodyReady()`, () => page.key('Enter'), 8000));
    await sleep(500);
    await page.key('Escape'); await sleep(250);
  }
  results[`threadOpenHeader_${name}`] = stats(open);
  results[`threadOpenBody_${name}`] = stats(body);
  results[`threadClose_${name}`] = stats(close);
  console.error('[done] thread', name, JSON.stringify([results[`threadOpenHeader_${name}`], results[`threadOpenBody_${name}`], results[`threadClose_${name}`]]));
}
if (want('thread')) await openClose('plainPerson', async i => { await page.key('1'); await sleep(250); await page.click({ selector: '[data-thread-row]', nth: i % 5 }); await sleep(450); await page.key('Escape'); });
if (want('thread')) await openClose('newsletterHtml', async () => {
  await page.key('5'); await sleep(300);
  const idx = await page.eval(`window.__drRows().findIndex(r => r.getAttribute('aria-label').includes('Pragmatic Dispatch'))`);
  await page.click({ selector: '[data-thread-row]', nth: Math.max(idx, 0) }); await sleep(450); await page.key('Escape');
});
if (want('thread')) await openClose('longThread14', async () => {
  await page.key('5'); await sleep(300);
  const idx = await page.eval(`window.__drRows().findIndex(r => r.getAttribute('aria-label').includes('Onboarding flow v4'))`);
  await page.click({ selector: '[data-thread-row]', nth: Math.max(idx, 0) }); await sleep(450); await page.key('Escape');
});

// --- 3. split switch --------------------------------------------------------------
await resetToWorkImportant();
if (want('split')) {
  const samples = [];
  for (let i = 0; i < REPS; i++) {
    const before = await page.eval('window.__drFirst()');
    const key = i % 2 === 0 ? '5' : '1';
    samples.push(await measure(`window.__drFirst() !== ${JSON.stringify(before)} && window.__drFirst() !== ''`, () => page.key(key), 5000));
    await sleep(250);
  }
  results.splitSwitch = stats(samples);
  console.error('[done] splitSwitch', JSON.stringify(results.splitSwitch));
}

// --- 4. account switch ------------------------------------------------------------
if (want('account')) {
  const samples = []; const unified = [];
  await page.key('1', { meta: true }); await sleep(700);
  for (let i = 0; i < REPS; i++) {
    const before = await page.eval('window.__drFirst()');
    const key = i % 2 === 0 ? '2' : '1';
    samples.push(await measure(`window.__drFirst() !== ${JSON.stringify(before)} && window.__drFirst() !== ''`, () => page.key(key, { meta: true }), 8000));
    await sleep(500);
  }
  results.accountSwitch = stats(samples);
  console.error('[done] accountSwitch', JSON.stringify(results.accountSwitch));
  for (let i = 0; i < Math.min(REPS, 8); i++) {
    await page.key('2', { meta: true }); await sleep(600);
    const before = await page.eval('window.__drFirst()');
    unified.push(await measure(`window.__drFirst() !== ${JSON.stringify(before)} && window.__drFirst() !== ''`, () => page.key('0', { meta: true }), 8000));
    await sleep(500);
    await page.key('0', { meta: true }); await sleep(500); // toggle unified off again
  }
  results.unifiedInboxToggle = stats(unified);
  console.error('[done] unifiedInboxToggle', JSON.stringify(results.unifiedInboxToggle));
}

// --- 5. search (includes the app's 250 ms commit debounce) -----------------------
await resetToWorkImportant();
if (want('search')) {
  const queries = ['rollout', 'invoice', 'priya', 'webhook retries', 'budget review', 'from:trackline', 'contract', 'pilot feedback'];
  const samples = []; const counts = {};
  for (let i = 0; i < Math.min(REPS, 16); i++) {
    const q = queries[i % queries.length];
    await page.key('/'); await sleep(250);
    samples.push(await measure(`window.__drSearchDone()`, () => page.type(q), 15000));
    await sleep(300);
    counts[q] = await page.eval('window.__drRows().length + " rendered rows; setsize=" + (window.__drRows()[0]?.getAttribute("aria-setsize") || 0)');
    const hasClear = await page.eval(`!!document.querySelector('button[aria-label="Clear search"]')`);
    if (hasClear) await page.click({ selector: 'button[aria-label="Clear search"]' });
    await sleep(350); await page.key('Escape'); await sleep(250);
  }
  results.search = { ...stats(samples), note: 'includes 250 ms input debounce', resultCounts: counts };
  console.error('[done] search', JSON.stringify(results.search));
}

// --- 6. scroll a long list ----------------------------------------------------------
async function scrollTest(name) {
  const box = await page.eval(`(() => { const el = document.querySelector('[role="list"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, sh: el.scrollHeight, ch: el.clientHeight, total: Number(document.querySelector('[data-thread-row]')?.getAttribute('aria-setsize') || 0) }; })()`);
  if (!box || box.sh <= box.ch + 200) { results[name] = { skipped: true, reason: 'list does not overflow', box }; return; }
  await page.eval(`(() => {
    const el = document.querySelector('[role="list"]');
    const frames = []; let last = performance.now(); let blank = 0; let running = true;
    const loop = now => { frames.push(now - last); last = now;
      const rows = document.querySelectorAll('[data-thread-row]'); const lr = el.getBoundingClientRect();
      let covered = false; for (const r of rows) { const b = r.getBoundingClientRect(); if (b.bottom > lr.top + 4 && b.top < lr.bottom - 4) { covered = true; break; } }
      if (!covered) blank++;
      if (running) requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    const long = []; const po = new PerformanceObserver(l => l.getEntries().forEach(e => long.push(Math.round(e.duration)))); try { po.observe({ entryTypes: ['longtask'] }); } catch (e) {}
    window.__drScrollStop = () => { running = false; po.disconnect(); const f = frames.slice(2).sort((a, b) => a - b); const sum = f.reduce((a, b) => a + b, 0);
      return { frames: f.length, avgFps: +(1000 * f.length / sum).toFixed(1), medianFrameMs: +f[Math.floor(f.length / 2)].toFixed(1), p95FrameMs: +f[Math.floor(f.length * 0.95)].toFixed(1), maxFrameMs: +f[f.length - 1].toFixed(1), framesOver33ms: f.filter(x => x > 33.4).length, framesOver50ms: f.filter(x => x > 50).length, blankFrames: blank, longTasks: long.length, maxLongTaskMs: long.length ? Math.max(...long) : 0, scrolledTo: el.scrollTop }; };
  })()`);
  const start = Date.now();
  while (Date.now() - start < 4000) {
    await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: 240 });
    await sleep(8);
  }
  await sleep(300);
  results[name] = { ...(await page.eval('window.__drScrollStop()')), listRows: box.total, scrollHeight: box.sh };
}
if (want('scroll')) {
await resetToWorkImportant();
await scrollTest('scrollInboxSplit');
await page.key('/'); await sleep(250); await page.type('review'); await sleep(2500);
await scrollTest('scrollSearchResults');
if (await page.eval(`!!document.querySelector('button[aria-label="Clear search"]')`)) await page.click({ selector: 'button[aria-label="Clear search"]' });
await sleep(300); await page.key('Escape'); await sleep(300);
}

// --- 7. archive + undo ---------------------------------------------------------------
await resetToWorkImportant();
if (want('archive')) {
  const arch = []; const undo = [];
  for (let i = 0; i < Math.min(REPS, 10); i++) {
    await page.key('1'); await sleep(250);
    await page.click({ selector: '[data-thread-row]', nth: 1 }); await sleep(500); await page.key('Escape'); await sleep(250);
    const n = await page.eval('window.__drRows().length');
    arch.push(await measure(`window.__drRows().length < ${n}`, () => page.key('e'), 5000));
    await sleep(500);
    undo.push(await measure(`window.__drRows().length >= ${n}`, () => page.key('z'), 5000));
    await sleep(700);
  }
  results.archive = stats(arch);
  console.error('[done] archive', JSON.stringify(results.archive));
  results.undoArchive = stats(undo);
  console.error('[done] undoArchive', JSON.stringify(results.undoArchive));
}


// --- 8. panels and overlays ---------------------------------------------------------
if (want('panels')) {
  await resetToWorkImportant();
  const run = async (name, openAct, openPred, closeAct, closePred) => {
    const open = []; const close = [];
    for (let i = 0; i < Math.min(REPS, 8); i++) {
      open.push(await measure(openPred, openAct, 8000)); await sleep(500);
      close.push(await measure(closePred, closeAct, 8000)); await sleep(400);
    }
    results[`open_${name}`] = stats(open); results[`close_${name}`] = stats(close);
    console.error('[done] panel', name, JSON.stringify([results[`open_${name}`], results[`close_${name}`]]));
  };
  const hasText = t => `document.body.innerText.includes(${JSON.stringify(t)})`;
  await run('commandPalette', () => page.key('k', { meta: true }), hasText('Search actions and jump anywhere'), () => page.key('Escape'), `!${hasText('Search actions and jump anywhere')}`);
  await run('compose', () => page.key('c'), `!!document.querySelector('button[aria-label="Close composer"],button[title="Close composer"]') || ${hasText('Discard draft')}`, () => page.key('Escape'), `!document.querySelector('[contenteditable="true"]')`);
  await run('today', () => page.click({ selector: 'button[title="Today"]' }), hasText('Needs your attention'), () => page.click({ selector: 'button[title="alex.morgan@northwind.example"]' }), `!${hasText('Needs your attention')} && window.__drRows().length > 0`);
  await run('settings', () => page.click({ selector: 'button[title="Settings"]' }), hasText('Close Settings'), () => page.click({ selector: 'button', text: 'Close Settings', exact: true }), `!${hasText('Close Settings')}`);
  await run('aiPanel', () => page.click({ selector: 'button[title="Toggle AI Copilot"]' }), hasText('AI Assistant'), () => page.click({ selector: 'button[title="Toggle AI Copilot"]' }), `!${hasText('AI Assistant')}`);
  await run('calendar', () => page.click({ selector: 'button[title="Calendar"]' }), `!document.querySelector('[data-thread-row]')`, () => page.click({ selector: 'button[title="alex.morgan@northwind.example"]' }), `window.__drRows().length > 0`);
}

results.dbCounts = await page.eval(`(async () => { const a = await window.electronAPI.getSyncState('alex.morgan@northwind.example'); const b = await window.electronAPI.getSyncState('alex@morgan-family.example'); return { workBackfilledThreads: a?.historyBackfillThreadsSynced, homeBackfilledThreads: b?.historyBackfillThreadsSynced, workDone: !!a?.historyBackfillCompletedAt, homeDone: !!b?.historyBackfillCompletedAt }; })()`);

fs.mkdirSync(new URL('../metrics/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL(`../metrics/${label}.json`, import.meta.url), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 1));
page.close();
