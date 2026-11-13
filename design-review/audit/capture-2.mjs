import { open, sleep } from './capture-lib.mjs';
const a = await open();
const { page } = a;

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
  await sleep(500);
});
await a.step('10 unsubscribe sheet', async () => {
  await a.esc(2);
  const ok = await a.clickText('Review, asks first', 'button');
  await sleep(900);
  await a.shot('10-unsubscribe-sheet');
  await a.esc(1);
  console.log('unsub', ok);
});
await a.step('11 move to section', async () => {
  await a.openThread('Interview loop');
  await a.blur();
  await page.key('v', { code: 'KeyV' });
  await sleep(600);
  await a.shot('11-move-to-section');
  await a.esc(1);
});
await a.step('12 command palette', async () => {
  await page.key('k', { meta: true, code: 'KeyK' });
  await sleep(700);
  await a.shot('12-command-palette');
  await a.esc(1);
});
await a.step('13 shortcuts', async () => {
  await a.blur();
  await page.key('?', { shift: true });
  await sleep(700);
  await a.shot('13-shortcut-guide');
  await a.esc(1);
});
await a.step('14 search', async () => {
  await page.key('/', {});
  await sleep(300);
  await page.type('invoice');
  await sleep(1500);
  await a.shot('14-search-results');
  await a.clickText('Clear search', 'button');
  await a.esc(2);
  await page.eval(`(() => { const i = document.querySelector('input[placeholder="Search mail"]'); if (i) { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); i.blur(); } })()`);
  await sleep(800);
});
await a.step('15 ask dumka', async () => {
  await a.openThread('Contract redlines');
  await a.blur();
  // ⌘J is a native menu accelerator, which synthetic key events do not reach: open the panel from the palette.
  await page.key('k', { meta: true, code: 'KeyK' });
  await sleep(600);
  await page.type('Ask Dumka');
  await sleep(600);
  await page.key('Enter');
  await sleep(1000);
  await page.type('What do I need to decide here?');
  await page.key('Enter');
  await sleep(6000);
  await a.shot('15-ask-dumka');
  await a.esc(1);
});
await a.step('16 compose', async () => {
  await a.esc(1);
  await a.blur();
  await page.key('c', { code: 'KeyC' });
  await sleep(900);
  await page.type('priya.raman@lumenlabs.example');
  await a.shot('16-compose-new');
  await page.eval(`(() => { const b = document.querySelector('button[title="Close composer"]'); b && b.click(); })()`);
  await sleep(600);
});
await a.step('17 mailbox menu', async () => {
  await page.eval(`(() => { const b = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim().startsWith('Inbox')); b && b.click(); })()`);
  await sleep(500);
  await a.shot('17-mailbox-switcher');
  await a.esc(1);
});
console.log(await page.eval(`document.querySelector('[data-reply-dock]') ? document.querySelector('[data-reply-dock]').getAttribute('data-reply-dock') : 'no dock'`));
page.close();
