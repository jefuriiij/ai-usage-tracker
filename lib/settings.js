'use strict';

/**
 * Tiny JSON settings store in Electron's userData dir.
 *
 * Deliberately minimal: a flat object, synchronous reads, best-effort writes.
 * Losing a preference is never worth crashing the tray, so every failure path
 * falls back to the in-memory default.
 */

const fs = require('fs');
const path = require('path');

const FILE = 'settings.json';

let cache = null;
let filePath = null;

/** Must be called once after app.whenReady(), before get/set. */
function init(userDataDir) {
  filePath = path.join(userDataDir, FILE);
  cache = load();
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) || {};
  } catch {
    return {}; // missing or corrupt — start clean
  }
}

function get(key, fallback) {
  if (!cache) return fallback;
  return Object.prototype.hasOwnProperty.call(cache, key) ? cache[key] : fallback;
}

function set(key, value) {
  if (!cache) cache = {};
  cache[key] = value;
  try {
    fs.writeFileSync(filePath, JSON.stringify(cache, null, 2), 'utf8');
  } catch {
    /* non-fatal — the preference just won't survive a restart */
  }
}

module.exports = { init, get, set };
