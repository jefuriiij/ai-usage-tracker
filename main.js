'use strict';

const { app, Tray, Menu, BrowserWindow, screen, nativeImage, nativeTheme, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const providers = require('./lib/providers');
const settings = require('./lib/settings');
const fmt = require('./lib/format');
const autostart = require('./lib/autostart');
const updater = require('./lib/updater');

// ---- Config ---------------------------------------------------------------
const POLL_INTERVAL_MS = 180_000; // 180s — endpoints are rate-limit sensitive
const BACKOFF_INTERVAL_MS = 300_000; // 300s after a 429
const MIN_ADHOC_GAP_MS = 30_000; // throttle manual/refresh polls
const POPUP_W = 320;

/** Tray badge source: 'auto' = whichever provider is closest to its limit. */
const BADGE_AUTO = 'auto';

// Linux tray backends (StatusNotifierItem via libappindicator) differ from the
// Win/macOS ones in three ways that matter here: no hover tooltip, no icon
// position from getBounds(), and no left-click event — left-click opens the
// menu. Everything guarded by this flag exists to cover those gaps.
const IS_LINUX = process.platform === 'linux';

// ---- State ----------------------------------------------------------------
let tray = null;
let iconWin = null; // hidden renderer that paints the tray badge
let popup = null;
let menuIcons = {}; // cached nativeImages for the context-menu items
let pollTimer = null;
let lastPollAt = 0;

/**
 * Per-provider display state, keyed by provider id:
 *   { id, label, accent, consoleUrl, signInHint, refreshHint,
 *     status: 'loading'|'ok'|'stale'|'expired'|'not_found'|'error',
 *     statusDetail: string,
 *     reading: object|null }   // last GOOD reading, kept so we can show it when stale
 */
const state = new Map();

/**
 * Which provider the tray badge speaks for: a provider id, or BADGE_AUTO to
 * follow whichever one is closest to its session limit. Persisted across
 * restarts; loaded in init() once userData is available.
 */
let badgeSource = BADGE_AUTO;

// ---------------------------------------------------------------------------
// Single instance — a second launch just surfaces the existing one.
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => togglePopup(true));
}

// No dock/taskbar presence; this is a tray-only app.
if (process.platform === 'win32') app.setAppUserModelId('com.aiusage.tracker');

app.whenReady().then(init);
app.on('window-all-closed', (e) => e.preventDefault()); // stay alive in tray

async function init() {
  settings.init(app.getPath('userData'));
  badgeSource = settings.get('badgeSource', BADGE_AUTO);

  seedState();
  createIconWindow();
  tray = new Tray(await makeBadge('…', false, null));
  tray.setToolTip('AI Usage — starting…');
  tray.on('click', () => togglePopup());
  tray.on('right-click', showMenu);
  await loadMenuIcons();
  try {
    updater.init({
      app,
      settings,
      onChange: rebuildMenu, // shows "Restart to update"
      onRelocate: (newPath) => autostart.retarget(app, newPath),
    });
  } catch {
    /* updates are optional — never let them stop the usage polling */
  }
  rebuildMenu();

  // Re-theme the menu glyphs if the OS switches between light/dark.
  nativeTheme.on('updated', async () => {
    await loadMenuIcons();
    rebuildMenu();
  });

  await poll(); // first read immediately; poll() arms the interval timer itself
}

/**
 * Pre-populate state for every provider that has credentials on disk, so the
 * panel shows the right set of sections before the first poll resolves.
 */
function seedState() {
  for (const p of providers.available()) {
    if (state.has(p.id)) continue;
    state.set(p.id, {
      id: p.id,
      label: p.label,
      accent: p.accent,
      consoleUrl: p.consoleUrl,
      signInHint: p.signInHint,
      refreshHint: p.refreshHint,
      status: 'loading',
      statusDetail: '',
      reading: null,
    });
  }
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
async function makeBadge(text, stale, accent) {
  // Wait for the renderer to be ready on the very first call.
  if (iconWin.webContents.isLoading()) {
    await new Promise((res) => iconWin.webContents.once('did-finish-load', res));
  }
  const js = `drawBadge(${JSON.stringify(String(text))}, ${stale ? 'true' : 'false'}, ${
    accent ? JSON.stringify(accent) : 'null'
  })`;
  const dataUrl = await iconWin.webContents.executeJavaScript(js);
  const img = nativeImage.createFromDataURL(dataUrl);
  return img;
}

/**
 * Render the context-menu glyphs once and cache them as nativeImages, colored
 * to match the current OS menu theme (light vs dark). Called at startup and
 * whenever the system theme changes.
 */
async function loadMenuIcons() {
  if (!iconWin) return;
  if (iconWin.webContents.isLoading()) {
    await new Promise((res) => iconWin.webContents.once('did-finish-load', res));
  }
  const color = nativeTheme.shouldUseDarkColors ? 'rgba(255, 255, 255, 0.85)' : 'rgba(0, 0, 0, 0.72)';
  const want = {
    showPanel: 'panel',
    refresh: 'refresh',
    openUsage: 'external',
    quit: 'power',
    badge: 'badge',
    checkOn: 'check-on',
    checkOff: 'check-off',
    update: 'update',
  };
  const out = {};
  for (const [key, glyph] of Object.entries(want)) {
    try {
      const url = await iconWin.webContents.executeJavaScript(
        `drawMenuGlyph(${JSON.stringify(glyph)}, ${JSON.stringify(color)}, 16)`
      );
      out[key] = nativeImage.createFromDataURL(url);
    } catch {
      /* leave this glyph unset — the menu item just renders without an icon */
    }
  }
  menuIcons = out;
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------
/**
 * Poll every provider once. A call made while a poll is already in flight
 * joins it instead of starting a second request, so a manual refresh can
 * never race the timer and double-hit the rate-limited endpoints.
 */
let inFlight = null;
function poll() {
  if (!inFlight) {
    inFlight = pollOnce().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function pollOnce() {
  lastPollAt = Date.now();
  seedState(); // a provider's CLI may have been installed/signed in since startup

  const results = await providers.pollAll();
  let rateLimited = false;

  for (const r of results) {
    const prev = state.get(r.id) || {};
    const entry = {
      id: r.id,
      label: r.label,
      accent: r.accent,
      consoleUrl: r.consoleUrl,
      signInHint: r.signInHint,
      refreshHint: r.refreshHint,
      status: prev.status,
      statusDetail: prev.statusDetail || '',
      reading: prev.reading || null,
    };

    if (r.result.ok) {
      maybeWriteDiscoveryLog(r.id, r.result.raw);
      entry.reading = r.result.reading;
      entry.status = 'ok';
      entry.statusDetail = '';
    } else {
      const { code, message } = r.result;
      entry.statusDetail = message;
      if (code === 'not_found') {
        entry.status = 'not_found';
      } else if (code === 'expired' || code === 'auth') {
        // READ-ONLY: we never refresh. Show last-known dimmed, still-accurate countdown.
        entry.status = entry.reading ? 'stale' : 'expired';
      } else {
        if (code === 'rate_limited') rateLimited = true;
        entry.status = entry.reading ? 'stale' : 'error';
      }
    }
    state.set(r.id, entry);
  }

  // Drop providers whose credentials vanished (CLI uninstalled / signed out).
  const live = new Set(results.map((r) => r.id));
  for (const id of [...state.keys()]) {
    if (!live.has(id)) state.delete(id);
  }

  // One rate-limited provider backs the whole loop off; a clean pass recovers it.
  resetPollTimer(rateLimited ? BACKOFF_INTERVAL_MS : POLL_INTERVAL_MS);
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

// Write the first successful raw response per provider, to confirm field names
// for this account type. Never overwritten after that.
const discoveryWritten = new Set();
function maybeWriteDiscoveryLog(id, raw) {
  if (!raw || discoveryWritten.has(id)) return;
  discoveryWritten.add(id);
  try {
    const p = path.join(app.getPath('userData'), `last-usage-${id}.json`);
    fs.writeFileSync(p, JSON.stringify(raw, null, 2), 'utf8');
  } catch {
    /* non-fatal */
  }
}

// ---------------------------------------------------------------------------
// Rendering: tray badge + tooltip + popup push
// ---------------------------------------------------------------------------

/** Providers in registry order, so the panel never reshuffles between polls. */
function ordered() {
  return providers
    .all()
    .map((p) => state.get(p.id))
    .filter(Boolean);
}

/**
 * The provider the tray badge speaks for.
 *
 * Pinned to one provider, that provider always wins — even mid-poll or while
 * stale, so the number never silently switches owners behind your back. If the
 * pinned provider signs out it falls through to auto rather than showing "?".
 * On 'auto', it's whichever provider is closest to running out of its current
 * session: the number you actually need at a glance.
 */
function headline() {
  const entries = ordered();

  if (badgeSource !== BADGE_AUTO) {
    const pinned = entries.find((e) => e.id === badgeSource);
    if (pinned && pinned.reading && pinned.reading.session) return pinned;
    if (pinned) return null; // signed in but no reading yet — show "?", not someone else's %
  }

  let best = null;
  for (const e of entries) {
    if (!e.reading || !e.reading.session) continue;
    if (!best || e.reading.session.pct > best.reading.session.pct) best = e;
  }
  return best;
}

/** True when the pinned provider is gone from the panel (CLI signed out). */
function pinnedMissing() {
  return badgeSource !== BADGE_AUTO && !state.has(badgeSource);
}

async function render() {
  const entries = ordered();
  // A pin pointing at a provider that's no longer signed in silently degrades
  // to auto, so the badge keeps showing something useful.
  if (pinnedMissing()) badgeSource = BADGE_AUTO;

  const lead = headline();
  // Dim the badge only when nothing we're showing is fresh.
  const anyFresh = entries.some((e) => e.status === 'ok');
  const stale = !anyFresh && entries.some((e) => e.status === 'stale' || e.status === 'expired');

  // --- Tray badge: dark gradient badge showing the chosen session % ---
  let text = '?';
  if (lead) {
    text = String(fmt.roundPct(lead.reading.session.pct));
  } else if (entries.length && entries.every((e) => e.status === 'not_found')) {
    text = '!';
  }

  // Accent stripe identifies whose number this is — but only when there's more
  // than one provider to confuse it with.
  const accent = lead && entries.length > 1 ? lead.accent : null;

  try {
    tray.setImage(await makeBadge(text, stale, accent));
  } catch {
    /* ignore transient renderer issues */
  }
  tray.setToolTip(buildTooltip());

  // --- Push to popup if open ---
  if (popup && !popup.isDestroyed()) {
    popup.webContents.send('usage', payload());
    // Section count can change between polls (a CLI signs in / out).
    if (popup.isVisible()) positionPopup();
  }
  rebuildMenu();
}

/**
 * The current reading as one compact line per provider. On Windows/macOS these
 * become the tray tooltip; on Linux, where the tray backend shows no tooltip at
 * all, they are also pinned to the top of the context menu so the numbers stay
 * reachable.
 *
 * @param {boolean} [markLead=true] prefix the badge's provider with "●". The
 *   Linux menu turns this off: menu fonts are proportional, so the padding
 *   that lines the other rows up there collapses, and the "Tray icon shows"
 *   submenu already says whose number the badge is.
 */
function summaryLines(markLead = true) {
  const entries = ordered();
  if (!entries.length) return ['No AI CLI signed in'];

  const lead = headline();
  const lines = [];
  for (const e of entries) {
    // A marker on the provider the badge number belongs to, so the summary
    // explains the icon rather than just repeating it.
    const mark = !markLead ? '' : entries.length > 1 && lead && e.id === lead.id ? '● ' : '   ';
    if (e.status === 'not_found') {
      lines.push(`${mark}${e.label}: not signed in`);
      continue;
    }
    if (!e.reading || !e.reading.session) {
      lines.push(`${mark}${e.label}: waiting…`);
      continue;
    }
    const s = e.reading.session;
    let line = `${mark}${e.label}: ${fmt.roundPct(s.pct)}%`;
    const r = fmt.resetsInShort(s.resetsAt);
    if (r) line += ` (${r})`;
    if (e.reading.week) line += ` · wk ${fmt.roundPct(e.reading.week.pct)}%`;
    if (e.status === 'stale' || e.status === 'expired') line += ' — stale';
    lines.push(line);
  }
  return lines;
}

function buildTooltip() {
  // Windows tray tooltips support newlines and ~128 chars. With two providers
  // the per-window breakdown no longer fits, so each provider gets one compact
  // line — the popup carries the detail.
  return ['AI Usage', ...summaryLines()].join('\n');
}

/** The data object handed to the popup renderer. */
function payload() {
  return { providers: ordered() };
}

// ---------------------------------------------------------------------------
// Popup window
// ---------------------------------------------------------------------------
function createPopup() {
  popup = new BrowserWindow({
    width: POPUP_W,
    height: popupHeight(),
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
    if (popup && !popup.isDestroyed() && popup.isVisible()) {
      popup.hide();
      lastBlurHideAt = Date.now();
    }
  });
  popup.webContents.on('did-finish-load', () => {
    popup.webContents.send('usage', payload());
  });
}

/** Height that fits exactly the rows we'll show (so there's no dead space). */
function popupHeight() {
  const entries = ordered();
  let h = 92; // header + footer chrome
  if (!entries.length) return h + 70;

  for (const e of entries) {
    h += 30; // provider section header
    let rows = 0;
    if (e.reading) {
      if (e.reading.session) rows++;
      if (e.reading.week) rows++;
      rows += (e.reading.scoped || []).length;
    }
    const banner = e.status !== 'ok' && e.statusDetail;
    if (banner) h += 42; // per-provider banner
    // Rows, or a one-line placeholder — popup.js omits the placeholder when a
    // banner is already explaining the empty section.
    h += rows ? 76 * rows : banner ? 0 : 24;
    h += 10; // gap below the section
  }
  return h;
}

/**
 * Where the panel appears.
 *
 * On Windows/macOS the tray icon reports real bounds, so we centre the panel
 * under it. Linux tray backends expose no position at all — getBounds() is all
 * zeros — which would pin the panel to the bottom-left corner regardless of
 * where the tray actually is. So there we anchor to the screen edge the panel
 * occupies, inferred from how the work area is inset from the full display.
 */
function positionPopup() {
  const trayBounds = tray.getBounds();
  const haveTrayBounds = trayBounds.width > 0 && trayBounds.height > 0;
  const display = haveTrayBounds
    ? screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y })
    : screen.getPrimaryDisplay();
  const wa = display.workArea;
  const h = Math.min(popupHeight(), wa.height - 8);

  let x;
  let y;
  if (haveTrayBounds) {
    // Right-align to the tray icon, sit just above the taskbar with a small margin.
    x = Math.round(trayBounds.x + trayBounds.width / 2 - POPUP_W / 2);
    y = wa.y + wa.height - h - 12;
  } else {
    const b = display.bounds;
    const insets = {
      top: wa.y - b.y,
      bottom: b.y + b.height - (wa.y + wa.height),
      left: wa.x - b.x,
      right: b.x + b.width - (wa.x + wa.width),
    };
    // Widest inset is the desktop panel; default to bottom when there is none.
    const edge = Object.keys(insets).reduce((best, k) => (insets[k] > insets[best] ? k : best), 'bottom');
    // Trays sit at the far end of a panel, which on every common layout is the
    // right side (horizontal panel) or the top (vertical one).
    x = edge === 'left' ? wa.x + 12 : wa.x + wa.width - POPUP_W - 12;
    y = edge === 'bottom' ? wa.y + wa.height - h - 12 : wa.y + 12;
  }

  x = Math.max(wa.x + 4, Math.min(x, wa.x + wa.width - POPUP_W - 4));
  y = Math.max(wa.y + 4, Math.min(y, wa.y + wa.height - h - 4));
  popup.setBounds({ x, y, width: POPUP_W, height: h });
}

/**
 * Clicking the tray icon while the popup is open blurs the popup first, which
 * hides it; the click then arrives and would reopen it. A hide that happened
 * this recently is treated as the click's own close.
 */
const BLUR_CLICK_GRACE_MS = 300;
let lastBlurHideAt = 0;

function togglePopup(forceShow) {
  if (!popup) createPopup();
  if (!forceShow && (popup.isVisible() || Date.now() - lastBlurHideAt < BLUR_CLICK_GRACE_MS)) {
    popup.hide();
    lastBlurHideAt = 0;
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
  const entries = ordered();

  // One "open usage" item per signed-in provider, so the menu reflects exactly
  // what the panel is tracking.
  const usageItems = entries.map((e) => ({
    label: `Open ${e.label} usage`,
    icon: menuIcons.openUsage,
    click: () => shell.openExternal(e.consoleUrl),
  }));

  // "Tray icon shows" — pick which provider the badge number belongs to.
  // Only meaningful with more than one provider signed in, so it's hidden
  // otherwise rather than shown as a pointless one-option submenu.
  const lead = headline();
  const badgeItems =
    entries.length > 1
      ? [
          {
            label: 'Tray icon shows',
            icon: menuIcons.badge,
            submenu: [
              {
                label:
                  lead && badgeSource === BADGE_AUTO
                    ? `Highest usage (now ${lead.label})`
                    : 'Highest usage',
                type: 'radio',
                checked: badgeSource === BADGE_AUTO,
                click: () => setBadgeSource(BADGE_AUTO),
              },
              { type: 'separator' },
              ...entries.map((e) => ({
                label: e.label,
                type: 'radio',
                checked: badgeSource === e.id,
                click: () => setBadgeSource(e.id),
              })),
            ],
          },
        ]
      : [];

  const template = [];

  // Linux has no tray tooltip, so the reading itself leads the menu — otherwise
  // the numbers would only exist inside the popup. The rows stay enabled
  // because desktops grey out disabled items; clicking one opens the panel.
  if (IS_LINUX) {
    for (const line of summaryLines(false)) {
      template.push({ label: line, click: () => togglePopup(true) });
    }
    template.push({ type: 'separator' });
  }

  // A downloaded update offers itself first; otherwise it installs on quit.
  const pending = updater.pendingVersion();
  if (pending) {
    template.push(
      { label: `Restart to update to v${pending}`, icon: menuIcons.update, click: updater.installNow },
      { type: 'separator' }
    );
  }

  const updateItems = updater.isSupported() ? [autoUpdateItem()] : [];

  template.push(
    { label: 'Show usage panel', icon: menuIcons.showPanel, click: () => togglePopup(true) },
    { label: 'Refresh now', icon: menuIcons.refresh, click: refreshNow },
    { type: 'separator' },
    ...badgeItems,
    startAtLoginItem(),
    ...updateItems,
    ...usageItems,
    { type: 'separator' },
    { label: 'Quit', icon: menuIcons.quit, click: quitApp }
  );

  // On Linux, changes to individual items don't take effect until the whole menu
  // is set again — which is what this function does on every render anyway.
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

/**
 * An on/off menu item. Elsewhere it's a real checkbox item, whose check state
 * is its indicator. KDE draws that checkbox outside the icon column, so it sat
 * out of line with every other row; on Linux it's a plain item whose icon is
 * a drawn checkbox instead.
 */
function toggleItem(label, enabled, toggle) {
  if (IS_LINUX) {
    return { label, icon: enabled ? menuIcons.checkOn : menuIcons.checkOff, click: toggle };
  }
  return { label, type: 'checkbox', checked: enabled, click: toggle };
}

function startAtLoginItem() {
  const enabled = autostart.isEnabled(app);
  // Re-read the real state rather than trusting the click: on Linux this
  // writes a file that may fail, and the box must reflect what stuck.
  return toggleItem('Start at login', enabled, () => {
    autostart.setEnabled(app, !enabled);
    rebuildMenu();
  });
}

function autoUpdateItem() {
  const enabled = updater.isEnabled();
  return toggleItem('Update automatically', enabled, () => {
    updater.setEnabled(!enabled);
    rebuildMenu();
  });
}

/**
 * app.quit(), not app.exit(): exit() skips the quit events, and a downloaded
 * update installs from the 'quit' event.
 */
function quitApp() {
  if (tray) tray.destroy();
  app.quit();
}

/** Persist the tray-badge choice and repaint immediately. */
function setBadgeSource(id) {
  badgeSource = id;
  settings.set('badgeSource', id);
  render(); // repaints the badge, tooltip and menu — no refetch needed
}

function showMenu() {
  tray.popUpContextMenu();
}

// ---------------------------------------------------------------------------
// IPC from popup
// ---------------------------------------------------------------------------
ipcMain.handle('refresh', () => { refreshNow(); return payload(); });
ipcMain.on('quit', quitApp);
ipcMain.on('open-console', (_e, id) => {
  const entry = state.get(id) || providers.byId(id);
  if (entry && entry.consoleUrl) shell.openExternal(entry.consoleUrl);
});
