import { connect, sleep } from './cdp.mjs';
const page = await connect();
const out = process.argv[2];
await sleep(500);
if (out) await page.shot(out);
console.log(JSON.stringify(await page.eval(`({w: innerWidth, h: innerHeight, dpr: devicePixelRatio, text: document.body.innerText.slice(0, 1500)})`), null, 1));
page.close();
