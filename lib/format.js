'use strict';

/**
 * Small pure formatting helpers shared by the tray, tooltip and popup.
 */

/** Round a 0–100 utilization to a whole-number percent, clamped. */
function roundPct(pct) {
  if (typeof pct !== 'number' || Number.isNaN(pct)) return 0;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

/**
 * Color for a given percent — green / amber / red, matching the tray badge and
 * the popup progress bars.
 */
function colorForPct(pct) {
  const p = roundPct(pct);
  if (p >= 85) return '#e5484d'; // red — almost out
  if (p >= 50) return '#f5a623'; // amber — heads up
  return '#30a46c'; // green — plenty left
}

/**
 * Human "resets in" string from an ISO timestamp, e.g. "1 hr 35 min", "12 min",
 * "2 days". Returns "now" once the reset moment has passed.
 *
 * @param {string|null} resetsAt ISO-8601 timestamp
 * @param {number} [now] unix ms
 */
function resetsIn(resetsAt, now = Date.now()) {
  if (!resetsAt) return null;
  const target = Date.parse(resetsAt);
  if (Number.isNaN(target)) return null;

  let ms = target - now;
  if (ms <= 0) return 'now';

  const totalMin = Math.floor(ms / 60_000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;

  if (days > 0) {
    return hours > 0 ? `${days} day${days > 1 ? 's' : ''} ${hours} hr` : `${days} day${days > 1 ? 's' : ''}`;
  }
  if (hours > 0) {
    return mins > 0 ? `${hours} hr ${mins} min` : `${hours} hr`;
  }
  return `${mins} min`;
}

/** Compact form for the tray tooltip, e.g. "1h 35m", "12m". */
function resetsInShort(resetsAt, now = Date.now()) {
  if (!resetsAt) return null;
  const target = Date.parse(resetsAt);
  if (Number.isNaN(target)) return null;
  let ms = target - now;
  if (ms <= 0) return 'now';
  const totalMin = Math.floor(ms / 60_000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/** Local "HH:MM" for the "Updated"/"as of" labels. */
function clockTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

module.exports = { roundPct, colorForPct, resetsIn, resetsInShort, clockTime };
