import { open, sleep } from './capture-lib.mjs';
const a = await open();
const { page } = a;
const toasts = () => page.eval(`Array.from(document.querySelectorAll('[role=status],[role=alert]')).map(e => e.innerText.replace(/\\n/g,' ')).filter(Boolean).slice(0,4)`);
const headers = () => page.eval(`Array.from(document.querySelectorAll('[data-section-header]')).map(e => e.innerText.replace(/\\n/g,' ').slice(0,70))`);
const archiveButton = () => page.eval(`(() => { const b = Array.from(document.querySelectorAll('button')).find(b => /^Archive \\d+/.test(b.innerText.trim())); if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: b.innerText.replace(/\\n/g,' ') }; })()`);

await a.step('31 group archive', async () => {
  await a.esc(2);
  await sleep(3000);
  console.log('before', await headers());
  let b = await archiveButton();
  await page.clickAt(b.x, b.y);
  await sleep(900);
  console.log('after first click', await toasts(), await headers());
  await a.shot('31-group-archived-undo-toast');
  b = await archiveButton();
  console.log('button now', b && b.text);
  if (b) { await page.clickAt(b.x, b.y); await sleep(1100); }
  console.log('after second click', await toasts(), await headers());
  await a.shot('32-clear-group-open-review');
  await page.key('z', { code: 'KeyZ' });
  await sleep(2000);
  console.log('after undo', await headers());
});
page.close();
