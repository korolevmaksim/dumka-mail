// Indexes the whole synthetic archive through the app's own backfill API
// (the same call the "Resume Older Mail Indexing" command makes, one 100-thread page per call).
import { connect } from './cdp.mjs';
const page = await connect();
const out = {};
for (const email of ['alex.morgan@northwind.example', 'alex@morgan-family.example']) {
  const t0 = Date.now(); let pages = 0; let last = null;
  for (;;) {
    last = await page.eval(`window.electronAPI.runBackfillPage(${JSON.stringify(email)})`);
    pages += 1;
    if (last.completed || pages > 400) break;
  }
  out[email] = { pagesCalled: pages, threadsIndexed: last.threadsIndexed, completed: last.completed, seconds: +((Date.now() - t0) / 1000).toFixed(1) };
}
console.log(JSON.stringify(out, null, 1));
page.close();
