'use strict';

// Renderer for the usage panel. Pure DOM + small local formatters (no Node access).
// Receives payloads from main via the preload `api` bridge.
//
// Payload shape: { providers: [ { id, label, accent, consoleUrl, signInHint,
//                                 refreshHint, status, statusDetail, reading } ] }

let latest = null;

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
  const ms = t - Date.now();
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
  providers: document.getElementById('providers'),
  updated: document.getElementById('updated'),
  footNote: document.getElementById('footNote'),
  refreshBtn: document.getElementById('refreshBtn'),
  quitBtn: document.getElementById('quitBtn'),
};
const providerTpl = document.getElementById('providerTpl');
const rowTpl = document.getElementById('rowTpl');

function fillRow(row, label, win, dimmed) {
  row.classList.toggle('dimmed', !!dimmed);
  row.querySelector('.row-label').textContent = label;
  const pct = roundPct(win.pct);
  row.querySelector('.row-pct').textContent = `${pct}%`;
  const bar = row.querySelector('.bar > span');
  bar.style.width = `${pct}%`;
  bar.style.background = colorForPct(pct);
  const reset = resetsIn(win.resetsAt);
  row.querySelector('.row-reset').textContent = reset ? `Resets in ${reset}` : '';
}

/** The rows a provider should show, in display order. */
function rowsFor(reading) {
  const out = [];
  if (!reading) return out;
  if (reading.session) out.push({ key: 'session', label: 'Current session', win: reading.session });
  if (reading.week) out.push({ key: 'week', label: 'This week (all models)', win: reading.week });
  for (const s of reading.scoped || []) {
    const name = String(s.label || 'Scoped');
    out.push({ key: `scoped:${name}`, label: `This week (${name})`, win: s });
  }
  return out;
}

/**
 * Short right-aligned note in a provider header: plan and/or credit balance.
 * The "as of" stamp is added only when this provider's reading is older than
 * the freshest one on the panel — otherwise the header already says it and
 * repeating it here is noise.
 */
function metaFor(entry, newest) {
  const bits = [];
  const r = entry.reading;
  if (r && r.plan) bits.push(String(r.plan).replace(/_/g, ' '));
  if (r && r.credits) {
    bits.push(r.credits.unlimited ? 'unlimited credits' : `${r.credits.balance} credits`);
  }
  const stale = entry.status === 'stale' || entry.status === 'expired';
  if (stale && r && r.updatedAt && r.updatedAt !== newest) {
    bits.push(`as of ${clockTime(r.updatedAt)}`);
  }
  return bits.join(' · ');
}

/**
 * Sync one provider's section with the DOM. Sections and rows are keyed and
 * reused across renders so the bars' width transitions don't restart from 0
 * on every 30s countdown re-tick.
 */
function syncProvider(entry, newest) {
  let section = els.providers.querySelector(`.provider[data-id="${entry.id}"]`);
  if (!section) {
    section = providerTpl.content.firstElementChild.cloneNode(true);
    section.dataset.id = entry.id;
    section.querySelector('.pname').addEventListener('click', () => {
      window.api.openConsole(entry.id);
    });
    els.providers.appendChild(section);
  }

  const stale = entry.status === 'stale' || entry.status === 'expired';
  const bad = entry.status === 'error' || entry.status === 'not_found' || entry.status === 'expired';

  const dot = section.querySelector('.dot');
  dot.className = 'dot ' + (entry.status === 'ok' ? 'ok' : stale ? 'stale' : bad ? 'bad' : '');

  const name = section.querySelector('.pname');
  name.textContent = entry.label;
  name.style.color = entry.accent || '';
  name.title = `Open ${entry.label} usage page`;

  section.querySelector('.pmeta').textContent = metaFor(entry, newest);

  // --- banner (only when something is wrong) ---
  let banner = section.querySelector('.banner');
  if (entry.status !== 'ok' && entry.statusDetail) {
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'banner';
      section.appendChild(banner);
    }
    banner.textContent = entry.statusDetail;
  } else if (banner) {
    banner.remove();
  }

  // --- rows ---
  const wanted = rowsFor(entry.reading);
  const existing = new Map([...section.querySelectorAll('.row')].map((r) => [r.dataset.key, r]));
  const keep = new Set();

  for (const item of wanted) {
    keep.add(item.key);
    let row = existing.get(item.key);
    if (!row) {
      row = rowTpl.content.firstElementChild.cloneNode(true);
      row.dataset.key = item.key;
      section.appendChild(row);
    }
    fillRow(row, item.label, item.win, stale);
  }
  for (const [key, row] of existing) {
    if (!keep.has(key)) row.remove();
  }

  // --- placeholder when we have no reading at all ---
  let empty = section.querySelector('.empty');
  if (!wanted.length && !banner) {
    if (!empty) {
      empty = document.createElement('div');
      empty.className = 'empty';
      section.appendChild(empty);
    }
    empty.textContent = entry.status === 'not_found' ? entry.signInHint : 'Waiting for data…';
  } else if (empty) {
    empty.remove();
  }
}

function render(payload) {
  if (!payload) return;
  latest = payload;
  const entries = payload.providers || [];

  // Freshest reading we hold — computed first so each section knows whether its
  // own "as of" stamp would just duplicate the header's.
  const times = entries.map((e) => e.reading && e.reading.updatedAt).filter(Boolean);
  const newest = times.length ? Math.max(...times) : null;

  // Sections, in the order main sent them.
  const seen = new Set();
  for (const entry of entries) {
    syncProvider(entry, newest);
    seen.add(entry.id);
  }
  for (const section of [...els.providers.querySelectorAll('.provider')]) {
    if (!seen.has(section.dataset.id)) section.remove();
  }

  if (!entries.length) {
    els.updated.textContent = '';
    els.footNote.textContent = 'No AI CLI signed in';
    return;
  }

  const allStale = entries.every((e) => e.status !== 'ok');
  els.updated.textContent = newest ? `${allStale ? 'as of' : 'Updated'} ${clockTime(newest)}` : '';

  // Footer: the refresh hint of whichever provider needs attention.
  const needy = entries.find((e) => e.status === 'stale' || e.status === 'expired' || e.status === 'not_found');
  els.footNote.textContent = needy
    ? needy.status === 'not_found' ? needy.signInHint : needy.refreshHint
    : '';
}

// Re-tick the countdowns every 30s without needing a new fetch.
setInterval(() => { if (latest) render(latest); }, 30000);

els.refreshBtn.addEventListener('click', async () => {
  els.refreshBtn.disabled = true;
  try { render(await window.api.refresh()); } finally {
    setTimeout(() => { els.refreshBtn.disabled = false; }, 1200);
  }
});
els.quitBtn.addEventListener('click', () => window.api.quit());

window.api.onUsage(render);
