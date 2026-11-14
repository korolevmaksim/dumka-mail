// Shared helpers for the audit capture scripts (synthetic mail only; see ../stage0/harness/README.md).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, sleep, control } from '../stage0/harness/cdp.mjs';

export { sleep, control };
export const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), process.env.AUDIT_SHOTS || 'shots');

export async function open() {
  const page = await connect();
  const api = {
    page,
    shot: async name => { await sleep(350); await page.shot(path.join(SHOTS, `${name}.png`)); console.log('shot', name); },
    rowByText: text => `Array.from(document.querySelectorAll('[data-thread-row]')).find(r => (r.getAttribute('aria-label') || '').includes(${JSON.stringify(text)}))`,
    openThread: async text => {
      await page.eval(`${api.rowByText(text)}.click()`);
      await sleep(900);
    },
    blur: () => page.eval(`document.activeElement && document.activeElement.blur && document.activeElement.blur()`),
    esc: async (times = 1) => { for (let i = 0; i < times; i += 1) { await page.key('Escape'); await sleep(250); } },
    clickText: (text, selector = 'button') => page.eval(`(() => { const el = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(b => (b.innerText || '').trim().startsWith(${JSON.stringify(text)})); if (el) el.click(); return !!el; })()`),
    step: async (name, fn) => {
      try { await fn(); } catch (error) { console.log('STEP FAILED', name, '-', error.message); }
    },
  };
  return api;
}
