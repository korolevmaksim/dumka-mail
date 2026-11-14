import { connect } from './cdp.mjs';
const page = await connect();
await page.waitFor(`!!Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'Connect Gmail')`);
await page.click({ text: 'Connect Gmail', selector: 'button', exact: true });
await page.waitFor(`Array.from(document.querySelectorAll('[data-thread-row]')).some(r => r.getAttribute('aria-label').includes('Priya Raman'))`, { timeoutMs: 90000, intervalMs: 200 });
console.log('connected');
page.close();
