'use strict';

// Dev/build tool: generates build/icon.ico (and build/icon.png) for the app +
// installer. Renders a 256x256 icon with Electron's canvas, then wraps the PNG
// into a valid ICO container (PNG-in-ICO, supported on Windows Vista+).
// Run:  npx electron build-icon.js

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

function drawIcon() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Background: coral gradient rounded square.
  const g = ctx.createLinearGradient(0, 0, 256, 256);
  g.addColorStop(0, '#e2885f');
  g.addColorStop(1, '#c2542f');
  ctx.fillStyle = g;
  roundRect(0, 0, 256, 256, 58);
  ctx.fill();

  // Subtle top highlight.
  const hl = ctx.createLinearGradient(0, 0, 0, 128);
  hl.addColorStop(0, 'rgba(255,255,255,0.18)');
  hl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hl;
  roundRect(0, 0, 256, 256, 58);
  ctx.fill();

  // Gauge ring (3/4 arc) to read as a "usage meter".
  const cx = 128;
  const cy = 138;
  const radius = 70;
  const start = 0.75 * Math.PI;
  const end = 2.25 * Math.PI;
  ctx.lineCap = 'round';
  ctx.lineWidth = 22;
  ctx.strokeStyle = 'rgba(255,255,255,0.30)';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, start, end);
  ctx.stroke();
  // Filled portion (~62%).
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, start, start + (end - start) * 0.62);
  ctx.stroke();

  // Center percent mark.
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 70px "Segoe UI", system-ui, sans-serif';
  ctx.fillText('%', cx, cy + 4);

  return c.toDataURL('image/png');
}

function pngToIco(pngBuf) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = icon
  header.writeUInt16LE(1, 4); // image count
  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0); // width 0 => 256
  entry.writeUInt8(0, 1); // height 0 => 256
  entry.writeUInt8(0, 2); // palette
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(pngBuf.length, 8); // size of PNG
  entry.writeUInt32LE(22, 12); // offset (6 + 16)
  return Buffer.concat([header, entry, pngBuf]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 256, height: 256 });
  await win.loadURL('data:text/html,<html><body></body></html>');
  const dataUrl = await win.webContents.executeJavaScript(`(${drawIcon.toString()})()`);
  const pngBuf = Buffer.from(dataUrl.split(',')[1], 'base64');

  const buildDir = path.join(__dirname, 'build');
  fs.mkdirSync(buildDir, { recursive: true });
  fs.writeFileSync(path.join(buildDir, 'icon.png'), pngBuf);
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), pngToIco(pngBuf));
  console.log('wrote build/icon.png and build/icon.ico');
  app.quit();
});
