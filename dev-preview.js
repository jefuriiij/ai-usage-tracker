'use strict';

// Dev-only: renders the popup UI and the tray badge to PNGs so we can eyeball
// them without a live tray. Run:  npx electron dev-preview.js
// Produces popup-preview.png and badge-preview.png, then exits.

const { app, BrowserWindow, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const now = Date.now();
const sample = {
  status: 'ok',
  statusDetail: '',
  reading: {
    session: { pct: 47, resetsAt: new Date(now + 43 * 60000).toISOString() },
    week: { pct: 52, resetsAt: new Date(now + (21 * 60 + 53) * 60000).toISOString() },
    opus: null,
    sonnet: { pct: 9, resetsAt: new Date(now + (21 * 60 + 53) * 60000).toISOString() },
    updatedAt: now,
  },
};

app.whenReady().then(async () => {
  // ---- popup preview ----
  const win = new BrowserWindow({
    width: 320,
    height: 320,
    show: false,
    frame: false,
    backgroundColor: '#262624',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await win.loadFile(path.join(__dirname, 'popup.html'));
  win.webContents.send('usage', sample);
  await new Promise((r) => setTimeout(r, 700));
  const shot = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, 'popup-preview.png'), shot.toPNG());
  console.log('wrote popup-preview.png');

  // ---- badge previews (three states) ----
  const iconWin = new BrowserWindow({ width: 64, height: 64, show: false });
  await iconWin.loadFile(path.join(__dirname, 'icon.html'));
  const states = [
    ['47', false, 'badge-47.png'],
    ['9', false, 'badge-09.png'],
    ['100', true, 'badge-100-stale.png'],
  ];
  const urls = {};
  for (const [text, stale, file] of states) {
    const url = await iconWin.webContents.executeJavaScript(
      `drawBadge(${JSON.stringify(text)}, ${stale})`
    );
    urls[file] = url;
    fs.writeFileSync(path.join(__dirname, file), nativeImage.createFromDataURL(url).toPNG());
    console.log('wrote', file);
  }

  // ---- tray simulation: badge at real tray sizes on dark + light taskbars ----
  const simUrl = await iconWin.webContents.executeJavaScript(`(async () => {
    const c = document.createElement('canvas'); c.width = 260; c.height = 56;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1d1d1d'; ctx.fillRect(0, 0, 260, 28);   // Win11 dark taskbar
    ctx.fillStyle = '#e9e6df'; ctx.fillRect(0, 28, 260, 28);  // light taskbar
    const load = (u) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = u; });
    const b = await load(${JSON.stringify(urls['badge-47.png'])});
    const sizes = [16, 20, 24];
    let x = 24;
    for (const s of sizes) {
      ctx.drawImage(b, x, 14 - s / 2, s, s);       // on dark strip
      ctx.drawImage(b, x, 42 - s / 2, s, s);       // on light strip
      x += s + 44;
    }
    return c.toDataURL('image/png');
  })()`);
  fs.writeFileSync(path.join(__dirname, 'tray-sim.png'), nativeImage.createFromDataURL(simUrl).toPNG());
  console.log('wrote tray-sim.png');

  app.quit();
});
