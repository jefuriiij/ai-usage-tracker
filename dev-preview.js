'use strict';

// Dev-only: renders the popup UI and the tray badge to PNGs so we can eyeball
// them without a live tray. Run:  npx electron dev-preview.js
// Produces popup-preview.png and badge-preview.png, then exits.
//
//   npx electron dev-preview.js          # fixed sample data (two providers)
//   npx electron dev-preview.js --live   # your real signed-in providers

const { app, BrowserWindow, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const providers = require('./lib/providers');

const live = process.argv.includes('--live');
const now = Date.now();

/** Fixed two-provider sample so the preview is deterministic. */
const sample = {
  providers: [
    {
      id: 'claude',
      label: 'Claude',
      accent: '#d97757',
      consoleUrl: 'https://claude.ai/settings/usage',
      signInHint: 'Sign in via Claude Code',
      refreshHint: 'Open Claude Code to refresh',
      status: 'ok',
      statusDetail: '',
      reading: {
        session: { pct: 47, resetsAt: new Date(now + 43 * 60000).toISOString() },
        week: { pct: 52, resetsAt: new Date(now + (21 * 60 + 53) * 60000).toISOString() },
        scoped: [{ label: 'Fable', pct: 9, resetsAt: new Date(now + (21 * 60 + 53) * 60000).toISOString() }],
        updatedAt: now,
      },
    },
    {
      id: 'codex',
      label: 'Codex',
      accent: '#10a37f',
      consoleUrl: 'https://chatgpt.com/codex/settings/usage',
      signInHint: 'Sign in via Codex CLI',
      refreshHint: 'Open Codex CLI to refresh',
      status: 'ok',
      statusDetail: '',
      reading: {
        session: { pct: 3, resetsAt: new Date(now + (4 * 60 + 12) * 60000).toISOString() },
        week: { pct: 16, resetsAt: new Date(now + 78 * 60 * 60000).toISOString() },
        scoped: [],
        updatedAt: now,
        plan: 'plus',
        credits: null,
      },
    },
  ],
};

/** Mirror of main.js popupHeight() so the screenshot matches the real window. */
function popupHeight(entries) {
  let h = 92;
  if (!entries.length) return h + 70;
  for (const e of entries) {
    h += 30;
    let rows = 0;
    if (e.reading) {
      if (e.reading.session) rows++;
      if (e.reading.week) rows++;
      rows += (e.reading.scoped || []).length;
    }
    if (e.status !== 'ok' && e.statusDetail) h += 42;
    h += rows ? 76 * rows : 24;
    h += 10;
  }
  return h;
}

async function buildPayload() {
  if (!live) return sample;
  const results = await providers.pollAll();
  return {
    providers: results.map((r) => ({
      id: r.id,
      label: r.label,
      accent: r.accent,
      consoleUrl: r.consoleUrl,
      signInHint: r.signInHint,
      refreshHint: r.refreshHint,
      status: r.result.ok ? 'ok' : r.result.code === 'not_found' ? 'not_found' : 'error',
      statusDetail: r.result.ok ? '' : r.result.message,
      reading: r.result.ok ? r.result.reading : null,
    })),
  };
}

app.whenReady().then(async () => {
  const payload = await buildPayload();

  // ---- popup preview ----
  const win = new BrowserWindow({
    width: 320,
    height: popupHeight(payload.providers),
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
  win.webContents.send('usage', payload);
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
