'use strict';

/**
 * Cross-platform "Start at login" toggle.
 *
 * Windows and macOS have a real API for this (app.setLoginItemSettings). On
 * Linux that call is a silent no-op: it never throws, and getLoginItemSettings
 * always reports openAtLogin:false, so the menu checkbox could never stick.
 * There we implement the XDG Autostart spec ourselves by writing a .desktop
 * file into ~/.config/autostart, which every mainstream desktop honors
 * (KDE, GNOME, XFCE, Cinnamon...).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const DESKTOP_FILE = 'ai-usage-tracker.desktop';
const IS_LINUX = process.platform === 'linux';

/** ~/.config/autostart, respecting XDG_CONFIG_HOME. */
function autostartDir() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'autostart');
}

function autostartPath() {
  return path.join(autostartDir(), DESKTOP_FILE);
}

/** Quote one Exec= argument per the Desktop Entry spec. */
function quote(s) {
  return `"${String(s).replace(/(["`$\\])/g, '\\$1')}"`;
}

/**
 * The command that relaunches this app.
 *
 * Packaged, process.execPath is our own binary — except under AppImage, where
 * it points inside the temporary mount, so $APPIMAGE is the only path that
 * survives a reboot. Unpackaged (a dev checkout, `npm start`), execPath is the
 * Electron binary and it needs the project directory as its argument.
 */
function launchCommand(app, execPath) {
  if (app.isPackaged) {
    return quote(execPath || process.env.APPIMAGE || process.execPath);
  }
  return `${quote(process.execPath)} ${quote(app.getAppPath())}`;
}

/** @param {string} [execPath] launch this binary instead of the running one */
function desktopEntry(app, execPath) {
  // Packaged installs register an icon in the hicolor theme, so the theme name
  // resolves. A dev checkout has no theme entry — point at the file directly.
  const icon = app.isPackaged
    ? 'ai-usage-tracker'
    : path.join(app.getAppPath(), 'build', 'icon.png');
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=AI Usage Tracker',
    'Comment=Tray widget showing your Claude and Codex usage',
    `Exec=${launchCommand(app, execPath)}`,
    `Icon=${icon}`,
    'Terminal=false',
    'Categories=Utility;',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}

/** Is "start at login" currently on? */
function isEnabled(app) {
  if (!IS_LINUX) return app.getLoginItemSettings().openAtLogin;
  let raw;
  try {
    raw = fs.readFileSync(autostartPath(), 'utf8');
  } catch {
    return false; // missing (or unreadable) means off
  }
  // Desktops treat Hidden=true as "disabled" without deleting the file.
  return !/^Hidden\s*=\s*true\s*$/im.test(raw);
}

/**
 * Turn "start at login" on or off.
 * @returns {boolean} the state actually achieved (so the caller can re-check
 *   the menu box rather than trust the click).
 */
function setEnabled(app, enabled) {
  if (!IS_LINUX) {
    app.setLoginItemSettings({ openAtLogin: enabled });
    return isEnabled(app);
  }
  try {
    if (enabled) {
      fs.mkdirSync(autostartDir(), { recursive: true });
      fs.writeFileSync(autostartPath(), desktopEntry(app), 'utf8');
    } else {
      fs.rmSync(autostartPath(), { force: true });
    }
  } catch {
    /* non-fatal — fall through and report the real on-disk state */
  }
  return isEnabled(app);
}

/**
 * Point an existing autostart entry at a new binary. The AppImage updater
 * renames the file when its name carries the version and deletes the old one,
 * which would leave "Start at login" launching a file that no longer exists.
 * Leaves the entry alone when start-at-login is off.
 */
function retarget(app, execPath) {
  if (!IS_LINUX || !isEnabled(app)) return;
  try {
    fs.writeFileSync(autostartPath(), desktopEntry(app, execPath), 'utf8');
  } catch {
    /* non-fatal — the user can toggle Start at login to rewrite it */
  }
}

module.exports = { isEnabled, setEnabled, retarget, autostartPath };
