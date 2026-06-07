'use strict';

const { app, Tray, Menu, BrowserWindow, screen, nativeImage, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const credentials = require('./lib/credentials');
const usage = require('./lib/usage');
const fmt = require('./lib/format');

// ---- Config ---------------------------------------------------------------
const POLL_INTERVAL_MS = 180_000; // 180s — endpoint is rate-limit sensitive
const BACKOFF_INTERVAL_MS = 300_000; // 300s after a 429
const MIN_ADHOC_GAP_MS = 30_000; // throttle manual/refresh polls
const POPUP_W = 320;
const POPUP_H = 320;

// ---- State ----------------------------------------------------------------
let tray = null;
let iconWin = null; // hidden renderer that paints the tray badge
let popup = null;
let pollTimer = null;
let lastPollAt = 0;

/** The most recent good reading, kept so we can show it when stale. */
let lastReading = null; // normalized usage object
/** Current display status: 'ok' | 'stale' | 'not_found' | 'error' */
let status = 'loading';
let statusDetail = '';

// ---------------------------------------------------------------------------
// Single instance — a second launch just surfaces the existing one.
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => togglePopup(true));
}

// No dock/taskbar presence; this is a tray-only app.
if (process.platform === 'win32') app.setAppUserModelId('com.claudeusage.tracker');

app.whenReady().then(init);
app.on('window-all-closed', (e) => e.preventDefault()); // stay alive in tray

async function init() {
  createIconWindow();
  tray = new Tray(await makeBadge('…', false));
  tray.setToolTip('Claude Usage — starting…');
  tray.on('click', () => togglePopup());
  tray.on('right-click', showMenu);
  rebuildMenu();

  await poll(); // first read immediately
  pollTimer = setInterval(poll, POLL_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// Hidden icon renderer
// ---------------------------------------------------------------------------
function createIconWindow() {
  iconWin = new BrowserWindow({
    width: 64,
    height: 64,
    show: false,
    webPreferences: { offscreen: false, backgroundThrottling: false },
  });
  iconWin.loadFile(path.join(__dirname, 'icon.html'));
}

/** Ask the hidden renderer to paint a badge and return it as a nativeImage. */
async function makeBadge(text, stale) {
  // Wait for the renderer to be ready on the very first call.
  if (iconWin.webContents.isLoading()) {
    await new Promise((res) => iconWin.webContents.once('did-finish-load', res));
  }
  const js = `drawBadge(${JSON.stringify(String(text))}, ${stale ? 'true' : 'false'})`;
  const dataUrl = await iconWin.webContents.executeJavaScript(js);
  const img = nativeImage.createFromDataURL(dataUrl);
  return img;
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------
async function poll() {
  lastPollAt = Date.now();
  let cred;
  try {
    cred = credentials.getAccessToken();
  } catch (err) {
    // No file / malformed → not-logged-in state, keep whatever we last had.
    status = err.status === credentials.CredStatus.NOT_FOUND ? 'not_found' : 'error';
    statusDetail = err.message;
    return render();
  }

  if (cred.expired) {
    // READ-ONLY: we never refresh. Show last-known dimmed + still-accurate countdown.
    status = lastReading ? 'stale' : 'expired';
    statusDetail = 'Token expired — open Claude Code to refresh.';
    return render();
  }

  try {
    const raw = await usage.fetchRaw(cred.token);
    maybeWriteDiscoveryLog(raw);
    lastReading = usage.normalize(raw);
    status = 'ok';
    statusDetail = '';
    // Recover from any prior backoff.
    resetPollTimer(POLL_INTERVAL_MS);
  } catch (err) {
    if (err instanceof usage.UsageHttpError && err.status === 429) {
      status = lastReading ? 'stale' : 'error';
      statusDetail = 'Rate limited — backing off.';
      resetPollTimer(BACKOFF_INTERVAL_MS);
    } else if (err instanceof usage.UsageHttpError && err.status === 401) {
      // Token rejected; treat like expired (no refresh in read-only mode).
      status = lastReading ? 'stale' : 'expired';
      statusDetail = 'Token rejected — open Claude Code to refresh.';
    } else {
      status = lastReading ? 'stale' : 'error';
      statusDetail = err.message || 'Network error.';
    }
  }
  render();
}

function resetPollTimer(interval) {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(poll, interval);
}

/** Manual refresh (menu / popup button), throttled to respect rate limits. */
function refreshNow() {
  if (Date.now() - lastPollAt < MIN_ADHOC_GAP_MS) {
    return; // too soon; ignore
  }
  poll();
}

// Write the first successful raw response once, to confirm field names for this
// account type. Never overwritten after that.
let discoveryWritten = false;
function maybeWriteDiscoveryLog(raw) {
  if (discoveryWritten) return;
  discoveryWritten = true;
  try {
    const p = path.join(app.getPath('userData'), 'last-usage.json');
    fs.writeFileSync(p, JSON.stringify(raw, null, 2), 'utf8');
  } catch {
    /* non-fatal */
  }
}

// ---------------------------------------------------------------------------
// Rendering: tray badge + tooltip + popup push
// ---------------------------------------------------------------------------
async function render() {
  const stale = status === 'stale' || status === 'expired';

  // --- Tray badge: dark gradient badge showing session % (dimmed if stale) ---
  let text = '?';
  if (lastReading && lastReading.session) {
    text = String(fmt.roundPct(lastReading.session.pct));
  } else if (status === 'not_found') {
    text = '!';
  }

  try {
    tray.setImage(await makeBadge(text, stale));
  } catch {
    /* ignore transient renderer issues */
  }
  tray.setToolTip(buildTooltip());

  // --- Push to popup if open ---
  if (popup && !popup.isDestroyed()) {
    popup.webContents.send('usage', payload());
  }
  rebuildMenu();
}

function buildTooltip() {
  // Windows tray tooltips support newlines (and ~128 chars), so we lay the
  // limits out one-per-line with a "Claude Usage" header instead of one run-on.
  if (status === 'not_found') return 'Claude Usage\nNot signed in — open Claude Code';
  if (!lastReading || !lastReading.session) return 'Claude Usage\nWaiting for data…';
  const s = lastReading.session;
  const lines = ['Claude Usage'];
  let session = `Session: ${fmt.roundPct(s.pct)}%`;
  const r = fmt.resetsIn(s.resetsAt);
  if (r) session += ` (resets in ${r})`;
  lines.push(session);
  if (lastReading.week) lines.push(`Week: ${fmt.roundPct(lastReading.week.pct)}%`);
  if (lastReading.opus) lines.push(`Opus only: ${fmt.roundPct(lastReading.opus.pct)}%`);
  if (lastReading.sonnet) lines.push(`Sonnet only: ${fmt.roundPct(lastReading.sonnet.pct)}%`);
  // Keep the stale note short so the whole tooltip stays under the char cap.
  if (status === 'stale' || status === 'expired') {
    lines.push(`(as of ${fmt.clockTime(lastReading.updatedAt)})`);
  }
  return lines.join('\n');
}

/** The data object handed to the popup renderer. */
function payload() {
  return {
    status,
    statusDetail,
    reading: lastReading,
  };
}

// ---------------------------------------------------------------------------
// Popup window
// ---------------------------------------------------------------------------
function createPopup() {
  popup = new BrowserWindow({
    width: POPUP_W,
    height: POPUP_H,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  popup.loadFile(path.join(__dirname, 'popup.html'));
  popup.on('blur', () => {
    if (popup && !popup.isDestroyed()) popup.hide();
  });
  popup.webContents.on('did-finish-load', () => {
    popup.webContents.send('usage', payload());
  });
}

/** Height that fits exactly the rows we'll show (so there's no dead space). */
function popupHeight() {
  let rows = 0;
  if (lastReading) {
    for (const k of ['session', 'week', 'opus', 'sonnet']) if (lastReading[k]) rows++;
  }
  rows = Math.max(rows, 1);
  const bannerShown = status !== 'ok' && !!statusDetail;
  return 104 + 82 * rows + (bannerShown ? 46 : 0);
}

function positionPopup() {
  const trayBounds = tray.getBounds();
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  const wa = display.workArea;
  const h = Math.min(popupHeight(), wa.height - 8);
  // Right-align to the tray icon, sit just above the taskbar with a small margin.
  let x = Math.round(trayBounds.x + trayBounds.width / 2 - POPUP_W / 2);
  let y = wa.y + wa.height - h - 12;
  x = Math.max(wa.x + 4, Math.min(x, wa.x + wa.width - POPUP_W - 4));
  y = Math.max(wa.y + 4, y);
  popup.setBounds({ x, y, width: POPUP_W, height: h });
}

function togglePopup(forceShow) {
  if (!popup) createPopup();
  if (!forceShow && popup.isVisible()) {
    popup.hide();
    return;
  }
  positionPopup();
  popup.show();
  popup.focus();
  popup.webContents.send('usage', payload());
}

// ---------------------------------------------------------------------------
// Tray context menu
// ---------------------------------------------------------------------------
function rebuildMenu() {
  if (!tray) return;
  const loginEnabled = app.getLoginItemSettings().openAtLogin;
  const menu = Menu.buildFromTemplate([
    { label: 'Show usage panel', click: () => togglePopup(true) },
    { label: 'Refresh now', click: refreshNow },
    { type: 'separator' },
    {
      label: 'Start at login',
      type: 'checkbox',
      checked: loginEnabled,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked });
        rebuildMenu();
      },
    },
    {
      label: 'Open claude.ai usage',
      click: () => shell.openExternal('https://claude.ai/settings/usage'),
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { tray.destroy(); app.exit(0); } },
  ]);
  tray.setContextMenu(menu);
}

function showMenu() {
  tray.popUpContextMenu();
}

// ---------------------------------------------------------------------------
// IPC from popup
// ---------------------------------------------------------------------------
ipcMain.handle('refresh', () => { refreshNow(); return payload(); });
ipcMain.on('quit', () => { if (tray) tray.destroy(); app.exit(0); });
ipcMain.on('open-claude', () => shell.openExternal('https://claude.ai/settings/usage'));
