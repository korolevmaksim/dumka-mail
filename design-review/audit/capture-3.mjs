import { open, sleep } from './capture-lib.mjs';
const a = await open();
const { page } = a;

await a.step('reset search', async () => {
  await a.clickText('Clear search', 'button');
  await sleep(800);
  await a.esc(2);
  console.log('rows', await page.eval(`document.querySelectorAll('[data-thread-row]').length`));
});
await a.step('15 ask dumka', async () => {
  await a.openThread('Contract redlines');
  await a.blur();
  await page.key('k', { meta: true, code: 'KeyK' });
  await sleep(600);
  await page.type('Ask Dumka');
  await sleep(600);
  await page.key('Enter');
  await sleep(1000);
  await page.type('What do I need to decide here?');
  await sleep(200);
  await page.key('Enter');
  await sleep(7000);
  await a.shot('15-ask-dumka');
  console.log('panel', await page.eval(`document.body.innerText.includes('Ask Dumka')`));
  await a.esc(1);
});
await a.step('16 compose', async () => {
  await a.esc(2);
  await page.eval(`${a.rowByText('Q3 rollout')}.focus()`);
  await a.blur();
  await page.key('c', { code: 'KeyC' });
  await sleep(900);
  await page.type('priya');
  await sleep(700);
  await a.shot('16-compose-new');
  await page.eval(`(() => { const b = document.querySelector('[aria-label="Close"],[title="Close"]'); })()`);
  await a.esc(1);
  await sleep(600);
});
await a.step('18 calendar', async () => {
  await page.eval(`(() => { const b = document.querySelector('button[title*="Calendar"],button[aria-label*="Calendar"]'); b && b.click(); })()`);
  await sleep(2500);
  await a.shot('18-calendar');
});
await a.step('back to mail', async () => {
  await page.key('1', { meta: true, code: 'Digit1' });
  await sleep(1200);
  console.log('rows', await page.eval(`document.querySelectorAll('[data-thread-row]').length`));
});
page.close();
