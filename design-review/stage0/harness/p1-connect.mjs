import { connect, sleep } from './cdp.mjs';
const page = await connect();
await page.waitFor(`!!Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'Connect Gmail')`);
await sleep(800);
const t0 = Date.now();
await page.click({ text: 'Connect Gmail', selector: 'button', exact: true });
// sample states while onboarding runs
const samples = [];
let firstRows = null; let shotLoading = false;
for (let i = 0; i < 400; i++) {
  const s = await page.eval(`({rows: document.querySelectorAll('[data-thread-row]').length, text: document.body.innerText.slice(0, 400).replace(/\\n/g, ' | ')})`);
  const t = Date.now() - t0;
  if (!shotLoading && t > 1500 && s.rows === 0) { await page.shot('shots/03-onboarding-after-oauth-loading.png'); shotLoading = true; samples.push({ t, note: 'loading-shot', text: s.text }); }
  if (s.rows > 0 && firstRows === null) { firstRows = t; samples.push({ t, rows: s.rows, text: s.text }); break; }
  if (i % 10 === 0) samples.push({ t, rows: s.rows, text: s.text.slice(0, 160) });
  await sleep(50);
}
await sleep(400);
await page.shot('shots/04-first-inbox-after-connect.png');
console.log(JSON.stringify({ msToFirstRows: firstRows, samples }, null, 1));
await sleep(6000);
await page.shot('shots/05-inbox-default-split-important.png');
console.log('ROWS', await page.eval(`Array.from(document.querySelectorAll('[data-thread-row]')).map(r => r.getAttribute('aria-label')).slice(0,40)`));
page.close();
