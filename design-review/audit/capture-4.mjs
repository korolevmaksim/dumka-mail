import { open, sleep } from './capture-lib.mjs';
const a = await open();
const { page } = a;
const clickContaining = (text, selector = '*') => page.eval(`(() => { const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).filter(e => e.children.length === 0 && (e.textContent || '').trim() === ${JSON.stringify(text)}); const el = els[0]; if (el) el.click(); return els.length; })()`);

await a.step('19 unified', async () => {
  await sleep(2000);
  await page.key('0', { meta: true, code: 'Digit0' });
  await sleep(1500);
  await a.shot('19-unified-inbox-two-accounts');
  await page.key('1', { meta: true, code: 'Digit1' });
  await sleep(1200);
});
await a.step('18 calendar', async () => {
  await page.eval(`(() => { const b = document.querySelector('button[title*="Calendar"],button[aria-label*="Calendar"]'); b && b.click(); })()`);
  await sleep(3500);
  await a.shot('18-calendar-month');
  console.log('week', await clickContaining('Week', 'button,button *'));
  await sleep(1500);
  await a.shot('20-calendar-week');
  const hit = await page.eval(`(() => { const el = Array.from(document.querySelectorAll('*')).find(e => e.children.length === 0 && (e.textContent || '').includes('Lumen Labs weekly sync')); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (hit) { await page.clickAt(hit.x, hit.y); await sleep(900); await a.shot('21-calendar-event'); await a.esc(1); }
  console.log('event', hit);
});
await a.step('back to mail', async () => {
  await page.key('1', { meta: true, code: 'Digit1' });
  await sleep(1500);
  console.log('rows', await page.eval(`document.querySelectorAll('[data-thread-row]').length`));
});
page.close();
