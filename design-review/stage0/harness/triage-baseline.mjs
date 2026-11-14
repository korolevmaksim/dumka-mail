// Criterion 1 baseline: clear the 28-thread synthetic work inbox to zero in the CURRENT UI,
// as a keyboard-first expert would, and count every input the app required.
// No AI provider is configured (out-of-the-box state).
import fs from 'node:fs';
import { connect, sleep } from './cdp.mjs';

const page = await connect();
const counts = { keys: 0, typedChars: 0, pointerClicks: 0, decisions: 0 };
const log = [];
const key = async (k, mods) => { counts.keys += 1; await page.key(k, mods); };
const type = async text => { counts.typedChars += text.length; await page.type(text); };
const click = async opts => { counts.pointerClicks += 1; await page.click(opts); };
const title = () => page.eval(`(document.querySelector('.dm-reader-header h1')?.innerText || '')`);
const rows = () => page.eval(`document.querySelectorAll('[data-thread-row]').length`);
const inboxCount = () => page.eval(`(document.querySelector('button[title^="Switch mailbox"]')?.innerText || '').replace(/\\s+/g, ' ')`);

// What a careful user would do with each thread (subject fragment -> action).
const PLAN = [
  [/pilot to the 24th/, 'reply', 'Hi Priya, the 24th works for us. I will move the invite today. Best, Alex'],
  [/board deck/, 'reply+remind', 'Daniel, understood. You will have all three by Wednesday 5pm. Alex'],
  [/Invitation: Lumen Labs/, 'archive'],            // RSVP is impossible until Calendar is enabled (extra OAuth)
  [/redlines/, 'reply', 'Hi Sofia, both points work for us. Please issue the signature copy. Kind regards, Alex'],
  [/Jamie Chen/, 'reply', 'Hey Marcus, Wednesday 2 to 3pm works. Please send the invite. Alex'],
  [/offsite moved/, 'archive'],
  [/Updated invitation/, 'archive'],
  [/Intro: Alex/, 'reply', 'Thanks Hannah. Hi Tomas, happy to talk. Does Tuesday or Wednesday next week work? Alex'],
  [/Invoice #2291/, 'archive'], [/Receipt for your subscription/, 'archive'],
  [/connection requests/, 'archive'],
  [/commented on/, 'remind'], [/NW-1432/, 'remind'], [/NW-1398/, 'archive'], [/Elevated API latency/, 'archive'],
  [/October newsletter/, 'archive'], [/New sign-in/, 'archive'],
  [/Fix retry backoff/, 'remind'], [/Run failed/, 'archive'], [/package arrives/, 'archive'], [/Deploy freeze/, 'archive'],
  [/Onboarding flow v4/, 'archive'], [/Issue #212/, 'archive'], [/40% off/, 'unsubscribe'], [/e-ticket/, 'archive'],
  [/onboarding teardown/, 'archive'], [/New arrivals/, 'unsubscribe'], [/Call for papers/, 'archive'],
];

async function act(subject) {
  const entry = PLAN.find(([re]) => re.test(subject));
  const action = entry ? entry[1] : 'archive';
  counts.decisions += 1;
  const step = { subject: subject.slice(0, 60), action, notes: [] };
  if (action.startsWith('reply')) {
    await key('r'); await sleep(700);
    await type(entry[2]); await sleep(300);
    await key('Enter', { meta: true }); await sleep(1200);
    step.notes.push(`after send title="${(await title()).slice(0, 30)}"`);
  }
  if (action.includes('remind')) {
    await key('h'); await sleep(600);
    const menu = await page.eval(`(document.querySelector('[role=dialog],[role=menu]')?.innerText || '').slice(0, 80).replace(/\\n/g, ' | ')`);
    step.notes.push(`remind menu: ${menu}`);
    await key('ArrowDown'); await sleep(120); await key('ArrowDown'); await sleep(120); // Later today -> This evening -> Tomorrow
    await key('Enter'); await sleep(900);
    step.notes.push(`after remind title="${(await title()).slice(0, 30)}" menuOpen=${await page.eval(`!!document.querySelector('[role=dialog]')`)}`);
  }
  if (action === 'unsubscribe') {
    await click({ selector: 'button', text: 'Unsubscribe', exact: true }); await sleep(1500);
    const dialog = await page.eval(`(document.querySelector('[role=dialog],[role=alertdialog]')?.innerText || '').slice(0, 200).replace(/\\n/g, ' | ')`);
    step.notes.push(`unsubscribe dialog: ${dialog || '(none)'}`);
    if (dialog) {
      const buttons = await page.eval(`Array.from(document.querySelectorAll('[role=dialog] button,[role=alertdialog] button')).map(b => b.innerText.trim())`);
      step.notes.push(`dialog buttons: ${buttons.join(',')}`);
      const confirm = buttons.find(b => /unsubscribe|confirm|continue|approve/i.test(b));
      if (confirm) { await click({ selector: '[role=dialog] button,[role=alertdialog] button', text: confirm, exact: true }); await sleep(1500); }
    }
  }
  // every thread must leave the inbox
  const before = await title();
  if (before && before.includes(subject.slice(0, 20))) { await key('e'); await sleep(700); }
  else step.notes.push('thread already left the reader before archive');
  log.push(step);
}

await page.waitFor(`document.querySelectorAll('[data-thread-row]').length > 0`, { timeoutMs: 90000 });
await sleep(1000);
const startInbox = await inboxCount();
const t0 = Date.now();
for (const split of ['1', '2', '3', '4', '5']) {
  await key(split); await sleep(600);
  if ((await rows()) === 0) { log.push({ split, note: 'empty split' }); continue; }
  // harness-only: a freshly connected window has no focused row yet; give the list focus without counting it
  if (await page.eval(`!document.querySelector('[data-thread-row] .dm-selection-rail')`)) { await page.key('j'); await sleep(300); await page.key('k'); await sleep(300); }
  await key('Enter'); await sleep(900);
  let guard = 0;
  for (;;) {
    let subject = await title();
    if (!subject) {
      // reader closed: is there anything left in this split?
      if ((await rows()) === 0) break;
      await key('Enter'); await sleep(900); // re-open the next one by hand
      subject = await title();
      log.push({ split, note: 'had to press Enter again to open next thread' });
      if (!subject) break;
    }
    await act(subject);
    if (++guard > 40) break;
  }
}
await sleep(800);
await page.shot(new URL('../shots/50-inbox-zero-after-manual-triage.png', import.meta.url).pathname);
const result = { startInbox, endInbox: await inboxCount(), counts, automationRunSeconds: +((Date.now() - t0) / 1000).toFixed(1), log,
  toasts: await page.eval(`Array.from(document.querySelectorAll('[role=status],[role=alert]')).map(e => e.innerText.replace(/\\n/g, ' ')).join(' || ')`) };
fs.writeFileSync(new URL('../metrics/triage-baseline.json', import.meta.url), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 1));
page.close();
