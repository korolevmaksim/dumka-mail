// Cold start: process spawn -> window target -> first thread rows painted. Usage: node coldstart.mjs <profile> [runs] [KEY=VALUE...]
import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, sleep, control } from './cdp.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const [profile, runsArg, ...kv] = process.argv.slice(2);
const runs = Number(runsArg || 5);
const scratch = process.env.DR_SCRATCH;
const env = { ...process.env, DR_APP_DIR: `${scratch}/app`, DR_PROFILE: `${scratch}/profiles/${profile}` };
kv.forEach(pair => { const [k, v] = pair.split('='); env[k] = v; });
const samples = [];
for (let i = 0; i < runs; i++) {
  try { execSync('pkill -f harness/main.cjs'); } catch { /* none running */ }
  await sleep(1500);
  const t0 = Date.now();
  const child = spawn(`${repo}/node_modules/.bin/electron`, [`${here}/main.cjs`, '--remote-debugging-port=9333'], { env, detached: true, stdio: 'ignore' });
  child.unref();
  const page = await connect(9333, { timeoutMs: 30000 });
  const tTarget = Date.now() - t0;
  await page.waitFor(`document.querySelectorAll('[data-thread-row]').length > 0`, { timeoutMs: 60000, intervalMs: 20 });
  const tRows = Date.now() - t0;
  const nav = await page.eval(`(() => { const n = performance.getEntriesByType('navigation')[0]; return { domContentLoaded: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), sinceNavStart: Math.round(performance.now()) }; })()`);
  samples.push({ windowTargetMs: tTarget, firstRowsMs: tRows, ...nav });
  page.close();
  await sleep(500);
}
const med = key => samples.map(s => s[key]).sort((a, b) => a - b)[Math.floor(samples.length / 2)];
console.log(JSON.stringify({ profile, runs, medianWindowTargetMs: med('windowTargetMs'), medianFirstRowsMs: med('firstRowsMs'), samples }, null, 1));
