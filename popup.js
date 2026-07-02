'use strict';

// Renderer for the usage panel. Pure DOM + small local formatters (no Node access).
// Receives payloads from main via the preload `api` bridge.

let latest = null; // last payload {status, statusDetail, reading}

// ---- local formatters (mirror lib/format.js) ------------------------------
function roundPct(p) {
  if (typeof p !== 'number' || Number.isNaN(p)) return 0;
  return Math.max(0, Math.min(100, Math.round(p)));
}
function colorForPct(p) {
  const v = roundPct(p);
  if (v >= 85) return '#e5484d';
  if (v >= 50) return '#f5a623';
  return '#30a46c';
}
function resetsIn(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  let ms = t - Date.now();
  if (ms <= 0) return 'now';
  const totalMin = Math.floor(ms / 60000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return hours > 0 ? `${days} day${days > 1 ? 's' : ''} ${hours} hr` : `${days} day${days > 1 ? 's' : ''}`;
  if (hours > 0) return mins > 0 ? `${hours} hr ${mins} min` : `${hours} hr`;
  return `${mins} min`;
}
function clockTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ---- DOM refs -------------------------------------------------------------
const els = {
  dot: document.getElementById('statusDot'),
  banner: document.getElementById('banner'),
  rows: document.getElementById('rows'),
  updated: document.getElementById('updated'),
  footNote: document.getElementById('footNote'),
  refreshBtn: document.getElementById('refreshBtn'),
  quitBtn: document.getElementById('quitBtn'),
};

function rowEl(key) {
  return els.rows.querySelector(`.row[data-key="${key}"]`);
}

function fillRow(row, win, dimmed) {
  row.classList.toggle('dimmed', !!dimmed);
  const pct = roundPct(win.pct);
  row.querySelector('.row-pct').textContent = `${pct}%`;
  const bar = row.querySelector('.bar > span');
  bar.style.width = `${pct}%`;
  bar.style.background = colorForPct(pct);
  const reset = resetsIn(win.resetsAt);
  row.querySelector('.row-reset').textContent = reset ? `Resets in ${reset}` : '';
}

function renderWindow(key, win, dimmed) {
  const row = rowEl(key);
  if (!win) {
    row.classList.add('hidden');
    return;
  }
  row.classList.remove('hidden');
  fillRow(row, win, dimmed);
}

/**
 * Sync the dynamic model/surface-scoped rows (reading.scoped) with the DOM.
 * Rows are keyed by label and reused across renders so the bar's width
 * transition doesn't restart from 0 on every 30s countdown re-tick.
 */
function syncScopedRows(scoped, dimmed) {
  const tpl = document.getElementById('scopedRowTpl');
  const existing = new Map(
    [...els.rows.querySelectorAll('.row[data-scope]')].map((r) => [r.dataset.scope, r])
  );
  const keep = new Set();
  for (const win of scoped || []) {
    const key = String(win.label || 'Scoped');
    keep.add(key);
    let row = existing.get(key);
    if (!row) {
      row = tpl.content.firstElementChild.cloneNode(true);
      row.dataset.scope = key;
      row.querySelector('.row-label').textContent = `This week (${key})`;
      els.rows.appendChild(row);
    }
    fillRow(row, win, dimmed);
  }
  for (const [key, row] of existing) {
    if (!keep.has(key)) row.remove();
  }
}

function render(payload) {
  if (!payload) return;
  latest = payload;
  const { status, statusDetail, reading } = payload;
  const stale = status === 'stale' || status === 'expired';
  const bad = status === 'error' || status === 'not_found' || status === 'expired';

  // status dot
  els.dot.className = 'dot ' + (status === 'ok' ? 'ok' : stale ? 'stale' : bad ? 'bad' : '');

  // banner
  if (status === 'ok' || !statusDetail) {
    els.banner.classList.remove('show');
    els.banner.textContent = '';
  } else {
    els.banner.classList.add('show');
    els.banner.textContent = statusDetail;
  }

  // rows
  if (reading) {
    renderWindow('session', reading.session, stale);
    renderWindow('week', reading.week, stale);
    syncScopedRows(reading.scoped, stale);
  } else {
    ['session', 'week'].forEach((k) => rowEl(k).classList.add('hidden'));
    syncScopedRows([], false);
  }

  // footer / updated label
  if (reading && reading.updatedAt) {
    const when = clockTime(reading.updatedAt);
    if (stale) {
      els.updated.textContent = `as of ${when}`;
      els.footNote.textContent = 'Open Claude Code to refresh';
    } else {
      els.updated.textContent = `Updated ${when}`;
      els.footNote.textContent = '';
    }
  } else {
    els.updated.textContent = '';
    els.footNote.textContent = status === 'not_found' ? 'Sign in via Claude Code' : '';
  }
}

// Re-tick the countdowns every 30s without needing a new fetch.
setInterval(() => { if (latest && latest.reading) render(latest); }, 30000);

els.refreshBtn.addEventListener('click', async () => {
  els.refreshBtn.disabled = true;
  try { render(await window.api.refresh()); } finally {
    setTimeout(() => { els.refreshBtn.disabled = false; }, 1200);
  }
});
els.quitBtn.addEventListener('click', () => window.api.quit());

window.api.onUsage(render);
