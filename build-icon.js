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

  // Background: vertical espresso gradient #120B05 (top) -> #784921 (bottom).
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#120b05');
  g.addColorStop(0.5, '#2a190d');
  g.addColorStop(1, '#784921');
  ctx.fillStyle = g;
  roundRect(0, 0, 256, 256, 58);
  ctx.fill();

  // Soft warm glow low-center for depth (clipped to the rounded square).
  ctx.save();
  roundRect(0, 0, 256, 256, 58);
  ctx.clip();
  const glow = ctx.createRadialGradient(128, 208, 8, 128, 208, 150);
  glow.addColorStop(0, 'rgba(168, 102, 48, 0.5)');
  glow.addColorStop(1, 'rgba(120, 73, 33, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 256, 256);
  ctx.restore();

  // Gauge ring (3/4 arc) to read as a "usage meter".
  const cx = 128;
  const cy = 134;
  const radius = 72;
  const start = 0.75 * Math.PI;
  const end = 2.25 * Math.PI;
  ctx.lineCap = 'round';
  ctx.lineWidth = 22;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
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
  ctx.font = '700 72px "Segoe UI", system-ui, sans-serif';
  ctx.fillText('%', cx, cy + 4);

  return c.toDataURL('image/png');
}

// Renders the 164x314 NSIS welcome/finish sidebar and returns it as a base64
// **BMP** (MUI requires BMP, not PNG). NSIS draws its page text over the right
// side, so the artwork is kept centered/upper. Encoded as 24-bit, bottom-up,
// with rows padded to 4 bytes (164*3 = 492 is already a multiple of 4).
function drawSidebar() {
  const W = 164;
  const H = 314;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');

  // Same espresso gradient as the icon.
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#120b05');
  g.addColorStop(0.5, '#2a190d');
  g.addColorStop(1, '#784921');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Soft warm glow low-center for depth.
  const glow = ctx.createRadialGradient(W / 2, H - 70, 8, W / 2, H - 70, 170);
  glow.addColorStop(0, 'rgba(168, 102, 48, 0.45)');
  glow.addColorStop(1, 'rgba(120, 73, 33, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Gauge ring (3/4 arc) in the upper third, echoing the app icon.
  const cx = W / 2;
  const cy = 100;
  const radius = 46;
  const start = 0.75 * Math.PI;
  const end = 2.25 * Math.PI;
  ctx.lineCap = 'round';
  ctx.lineWidth = 14;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, start, end);
  ctx.stroke();
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, start, start + (end - start) * 0.62);
  ctx.stroke();

  // Center percent mark.
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 44px "Segoe UI", system-ui, sans-serif';
  ctx.fillText('%', cx, cy + 3);

  // Wordmark under the gauge.
  ctx.font = '700 21px "Segoe UI", system-ui, sans-serif';
  ctx.fillText('Claude', cx, cy + radius + 46);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
  ctx.font = '400 15px "Segoe UI", system-ui, sans-serif';
  ctx.fillText('Usage Tracker', cx, cy + radius + 72);

  // ---- encode to a 24-bit BMP ----
  const setU16 = (a, o, v) => { a[o] = v & 255; a[o + 1] = (v >> 8) & 255; };
  const setU32 = (a, o, v) => {
    a[o] = v & 255; a[o + 1] = (v >> 8) & 255; a[o + 2] = (v >> 16) & 255; a[o + 3] = (v >>> 24) & 255;
  };
  const img = ctx.getImageData(0, 0, W, H).data;
  const rowBytes = W * 3; // 492, already 4-byte aligned
  const pixBytes = rowBytes * H;
  const buf = new Uint8Array(54 + pixBytes);
  buf[0] = 0x42; buf[1] = 0x4d; // "BM"
  setU32(buf, 2, buf.length);
  setU32(buf, 10, 54); // pixel data offset
  setU32(buf, 14, 40); // DIB header size
  setU32(buf, 18, W);
  setU32(buf, 22, H); // positive height => bottom-up
  setU16(buf, 26, 1); // planes
  setU16(buf, 28, 24); // bits per pixel
  setU32(buf, 34, pixBytes);
  setU32(buf, 38, 2835); // 72 DPI x
  setU32(buf, 42, 2835); // 72 DPI y
  let off = 54;
  for (let y = H - 1; y >= 0; y--) {
    let rp = y * W * 4;
    for (let x = 0; x < W; x++) {
      buf[off] = img[rp + 2]; // B
      buf[off + 1] = img[rp + 1]; // G
      buf[off + 2] = img[rp]; // R
      off += 3;
      rp += 4;
    }
  }
  let s = '';
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return btoa(s);
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

  // Installer welcome/finish sidebar (BMP).
  const sidebarB64 = await win.webContents.executeJavaScript(`(${drawSidebar.toString()})()`);
  fs.writeFileSync(path.join(buildDir, 'sidebar.bmp'), Buffer.from(sidebarB64, 'base64'));
  console.log('wrote build/sidebar.bmp');

  app.quit();
});
