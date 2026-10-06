'use strict';

/**
 * Self-update from GitHub Releases, via electron-updater.
 *
 * Checks shortly after launch and then every few hours, downloads in the
 * background, and installs on the next quit. When a download is ready it shows
 * a notification and the tray menu offers "Restart to update".
 *
 * Network trouble is never surfaced: a tray app is offline all the time (sleep,
 * VPN, train), and the next scheduled check simply tries again.
 *
 * Only packaged Windows builds and AppImages update. A dev checkout
 * (`npm start`) and other Linux packages (e.g. a locally built rpm) never
 * check, and the menu hides the toggle for them.
 */

const { Notification } = require('electron');

const SETTING = 'autoUpdate';
const FIRST_CHECK_DELAY_MS = 30_000; // let the first usage poll go out first
const CHECK_INTERVAL_MS = 6 * 60 * 60_000; // 6h — GitHub allows far more

let app = null;
let settings = null;
let onChange = () => {};
let onRelocate = () => {};

let autoUpdater = null; // only loaded where updating is supported
let firstTimer = null;
let intervalTimer = null;
let readyVersion = null; // set once an update is downloaded and waiting
let notice = null; // held so the click handler isn't garbage-collected

/** True when this build can update itself at all. */
function isSupported() {
  if (!app || !app.isPackaged) return false;
  if (process.platform === 'win32') return true;
  // The AppImage runtime sets $APPIMAGE; without it there is no file to replace.
  return process.platform === 'linux' && !!process.env.APPIMAGE;
}

/** The user's "Update automatically" choice. On by default. */
function isEnabled() {
  return settings.get(SETTING, true) !== false;
}

/**
 * @param {object} opts
 * @param {Electron.App} opts.app
 * @param {{get: Function, set: Function}} opts.settings  lib/settings.js
 * @param {() => void} [opts.onChange]  an update finished downloading
 * @param {(path: string) => void} [opts.onRelocate]  the AppImage was renamed
 */
function init(opts) {
  app = opts.app;
  settings = opts.settings;
  if (opts.onChange) onChange = opts.onChange;
  if (opts.onRelocate) onRelocate = opts.onRelocate;
  if (!isSupported()) return;

  autoUpdater = require('electron-updater').autoUpdater;
  autoUpdater.autoDownload = true;
  // Leave this true: electron-updater registers its install-on-quit hook only
  // once, when a download finishes, and skips it for good if the flag is false
  // at that moment. The user's choice is applied just before quitting instead
  // (the hook re-reads the flag on 'quit', which follows 'before-quit').
  autoUpdater.autoInstallOnAppQuit = true;
  app.on('before-quit', () => {
    autoUpdater.autoInstallOnAppQuit = isEnabled();
  });

  autoUpdater.on('update-downloaded', (info) => {
    readyVersion = info.version;
    // A download already in flight when the user turned updates off still
    // lands; offer it in the menu, but don't interrupt with a toast.
    if (isEnabled()) notify(info.version);
    onChange();
  });
  // Must be handled: an EventEmitter with no 'error' listener throws.
  autoUpdater.on('error', () => {
    /* offline or feed hiccup — the next scheduled check retries */
  });
  // The AppImage updater renames the file when its name carries the version.
  autoUpdater.on('appimage-filename-updated', (path) => onRelocate(path));

  if (isEnabled()) schedule();
}

function schedule() {
  unschedule();
  firstTimer = setTimeout(check, FIRST_CHECK_DELAY_MS);
  intervalTimer = setInterval(check, CHECK_INTERVAL_MS);
}

function unschedule() {
  clearTimeout(firstTimer);
  clearInterval(intervalTimer);
  firstTimer = intervalTimer = null;
}

async function check() {
  if (readyVersion) return; // already downloaded; it installs on quit
  try {
    const result = await autoUpdater.checkForUpdates();
    // The download runs on in the background and rejects on failure; the
    // 'error' listener already saw it.
    if (result && result.downloadPromise) await result.downloadPromise;
  } catch {
    /* see the 'error' listener */
  }
}

function notify(version) {
  if (!Notification.isSupported()) return;
  notice = new Notification({
    title: 'AI Usage Tracker update ready',
    body: `Version ${version} is downloaded. Click to restart now, or it installs when you quit.`,
  });
  notice.on('click', installNow);
  notice.show();
}

/** Turn automatic checking (and install-on-quit) on or off. */
function setEnabled(enabled) {
  settings.set(SETTING, !!enabled);
  if (!autoUpdater) return;
  if (enabled) schedule();
  else unschedule();
}

/** The downloaded version waiting to install, or null. */
function pendingVersion() {
  return readyVersion;
}

/** Quit, install silently, and relaunch the new version. */
function installNow() {
  if (!autoUpdater || !readyVersion) return;
  // The relaunched app must not find this one still holding the lock, or it
  // would hand off to us mid-quit and exit, leaving nothing running.
  app.releaseSingleInstanceLock();
  autoUpdater.quitAndInstall(true, true);
}

module.exports = { init, isSupported, isEnabled, setEnabled, pendingVersion, installNow };
