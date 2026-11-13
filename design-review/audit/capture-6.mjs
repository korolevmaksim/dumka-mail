import { open, sleep, control } from './capture-lib.mjs';
const a = await open();
const { page } = a;

await a.step('30 reply thread with model', async () => {
  await a.openThread('Intro: Alex');
  await a.blur();
  await a.shot('30-thread-model-sections');
});
await a.esc(1);
await a.step('34 offline', async () => {
  await control('/state', { offline: true });
  await sleep(1000);
  await a.openThread('Interview loop');
  await a.blur();
  await page.key('e', { code: 'KeyE' });
  await sleep(4000);
  await a.shot('34-offline-after-archive');
  console.log('status text', await page.eval(`document.body.innerText.split('\\n').filter(l => /offline|Offline|couldn|Could|retry|Retry|pending|Pending|sync/i.test(l)).slice(0,6)`));
  await control('/state', { offline: false });
  await page.key('z', { code: 'KeyZ' });
  await sleep(2500);
});
await a.step('35 model unreachable', async () => {
  await control('/state', { aiFail: true });
  await a.openThread('Contract redlines');
  await a.blur();
  await page.key('R', { shift: true, code: 'KeyR' });
  await sleep(4000);
  await a.shot('35-model-unreachable');
  await control('/state', { aiFail: false });
  await a.esc(1);
});
page.close();
