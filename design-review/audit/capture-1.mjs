import { open, sleep } from './capture-lib.mjs';
const a = await open();
const { page } = a;

await a.step('connect', async () => {
  await page.click({ text: 'Connect Gmail', selector: 'button', exact: true });
  await page.waitFor(`!!${a.rowByText('Priya Raman')}`, { timeoutMs: 90000, intervalMs: 200 });
  await sleep(1500);
});
await a.step('02 inbox', async () => { await a.shot('02-inbox-default'); });
await a.step('03 thread', async () => { await a.openThread('Need your numbers'); await a.blur(); await a.shot('03-thread-open'); });
await a.step('04 draft', async () => {
  await page.key('R', { shift: true, code: 'KeyR' });
  await page.waitFor(`document.querySelector('[data-reply-dock]').getAttribute('data-reply-dock') === 'prepared'`, { timeoutMs: 20000 });
  await a.shot('04-thread-draft-written');
});
await a.step('05 editing', async () => {
  await page.key('r', { code: 'KeyR' });
  await sleep(900);
  await a.shot('05-thread-reply-editing');
  await a.esc(1);
});
await a.step('06 invite', async () => { await a.openThread('Invitation: Lumen Labs weekly sync'); await a.blur(); await a.shot('06-thread-invitation'); });
await a.step('07 long thread', async () => {
  await a.openThread('Onboarding flow v4');
  await page.waitFor(`document.body.innerText.includes('Summary') || !!document.querySelector('[data-thread-summary]')`, { timeoutMs: 15000 }).catch(() => {});
  await sleep(2500);
  await a.blur();
  await a.shot('07-long-thread-summary');
});
await a.step('08 newsletter', async () => {
  const opened = await page.eval(`(() => { const g = document.querySelector('[data-group-expand]'); if (g) g.click(); return !!g; })()`);
  await sleep(700);
  await a.shot('08-clear-group-open');
  await a.openThread('Pragmatic Dispatch');
  await a.blur();
  await a.shot('09-newsletter-open');
  console.log('group opened', opened);
});
console.log(await page.eval(`Array.from(document.querySelectorAll('[data-section-header]')).map(e => e.innerText.replace(/\\n/g,' '))`));
page.close();
