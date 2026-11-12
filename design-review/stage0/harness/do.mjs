// Ad-hoc driver: node harness/do.mjs '<async js body using page, sleep, control>'
import { connect, sleep, control } from './cdp.mjs';
const page = await connect();
const rows = () => page.eval(`document.querySelectorAll('[data-thread-row]').length`);
const body = (n = 1200) => page.eval(`document.body.innerText.slice(0, ${n})`);
const fn = new Function('page', 'sleep', 'control', 'rows', 'body', `return (async () => { ${process.argv[2]} })()`);
try { const out = await fn(page, sleep, control, rows, body); if (out !== undefined) console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 1)); }
catch (e) { console.error('ERR', e.message); }
page.close();
