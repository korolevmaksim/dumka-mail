import { connect, sleep } from './cdp.mjs';
const page = await connect();
await page.click({ text: 'Connect Gmail', selector: 'button' });
await sleep(1500);
await page.shot('shots/02-first-run-connect-without-oauth-client.png');
console.log('AFTER CONNECT:', (await page.text()).slice(0, 900));
page.close();
