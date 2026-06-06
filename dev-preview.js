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
    ['47', '#f5a623', false, 'badge-47.png'],
    ['9', '#30a46c', false, 'badge-09.png'],
    ['91', '#e5484d', true, 'badge-91-stale.png'],
  ];
  for (const [text, color, stale, file] of states) {
    const url = await iconWin.webContents.executeJavaScript(
      `drawBadge(${JSON.stringify(text)}, ${JSON.stringify(color)}, ${stale})`
    );
    fs.writeFileSync(path.join(__dirname, file), nativeImage.createFromDataURL(url).toPNG());
    console.log('wrote', file);
  }

  app.quit();
});
