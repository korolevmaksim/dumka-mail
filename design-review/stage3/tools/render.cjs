// Renders HTML mock files to PNG with Electron (offscreen, no network).
// Usage: electron tools/render.cjs <out-dir> <file.html[#state]> [...]
// A file may expose several states through the URL hash; the page reads location.hash.
'use strict';
const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const fs = require('fs');

const [outDir, ...targets] = process.argv.slice(2);
const [W, H] = (process.env.RENDER_SIZE || '1440x900').split('x').map(Number);
app.commandLine.appendSwitch('force-device-scale-factor', '2');
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith('file://') && !details.url.startsWith('data:') && !details.url.startsWith('devtools:') });
  });
  fs.mkdirSync(outDir, { recursive: true });
  const win = new BrowserWindow({ width: W, height: H, show: false, useContentSize: true, webPreferences: { offscreen: true, backgroundThrottling: false } });
  let n = 0;
  for (const target of targets) {
    n += 1;
    const [spec, outName] = target.split('@@');
    const [file, hash] = spec.split('#');
    const abs = path.resolve(file);
    await win.loadURL(`file://${abs}?v=${n}${hash ? `#${hash}` : ''}`); // the query forces a fresh document per state
    await new Promise(resolve => setTimeout(resolve, Number(process.env.RENDER_WAIT || 350)));
    const image = await win.webContents.capturePage();
    const name = outName ? `${outName}.png` : `${path.basename(file, '.html')}${hash ? `-${hash}` : ''}.png`;
    fs.writeFileSync(path.join(outDir, name), image.toPNG());
    console.log('rendered', name, image.getSize());
  }
  app.quit();
});
