import { open, sleep } from './capture-lib.mjs';
const a = await open();
const { page } = a;
const openSettings = async () => { await page.eval(`document.querySelector('button[title=Settings]').click()`); await sleep(900); };
const nav = async text => { const ok = await a.clickText(text, 'button'); await sleep(1200); return ok; };

await a.step('close composer', async () => {
  await page.eval(`(() => { const b = document.querySelector('button[title="Close composer"]'); b && b.click(); })()`);
  await sleep(500);
});
await a.step('settings', async () => {
  await openSettings();
  console.log('nav items', await page.eval(`Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim().replace(/\\n/g,' ')).filter(t => t && t.length < 40).slice(0, 40)`));
  await nav('alex.morgan@northwind');
  await a.shot('22-settings-account');
  // Scroll the settings page itself to its end: row names change, the scroll container does not.
  console.log('scrolled', await page.eval(`(() => { const boxes = Array.from(document.querySelectorAll('*')).filter(e => e.scrollHeight > e.clientHeight + 80 && /auto|scroll/.test(getComputedStyle(e).overflowY) && e.clientHeight > 300); const box = boxes.sort((l, r) => r.clientWidth - l.clientWidth)[0]; if (!box) return null; box.scrollTop = box.scrollHeight; return box.scrollTop; })()`));
  await sleep(400);
  await a.shot('23-settings-account-lower');
  await nav('Appearance');
  await a.shot('24-settings-appearance');
  await nav('Shortcuts');
  await a.shot('25-settings-shortcuts');
  await nav('AI model');
  await a.shot('26-settings-ai-model');
  await nav('Privacy and data');
  await a.shot('27-settings-privacy');
  await nav('About');
  await a.shot('27b-settings-about');
});
await a.step('background on', async () => {
  await nav('AI model');
  await page.eval(`(() => { const sw = document.querySelector('[data-settings-section=background-work] [role=switch]'); if (sw && sw.getAttribute('aria-checked') !== 'true') sw.click(); })()`);
  await sleep(2500);
  await page.eval(`document.querySelector('[data-settings-section=background-work]').scrollIntoView({ block: 'center' })`);
  await a.shot('28-settings-ai-background-on');
  await a.clickText('Close settings', 'button');
  await sleep(9000);
});
await a.step('model sections', async () => {
  await page.key('1', { meta: true, code: 'Digit1' });
  await sleep(1500);
  await a.esc(1);
  await a.shot('29-inbox-model-sections');
  console.log(await page.eval(`Array.from(document.querySelectorAll('[data-section-header]')).map(e => e.innerText.replace(/\\n/g,' '))`));
});
page.close();
