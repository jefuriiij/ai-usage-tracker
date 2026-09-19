'use strict';

/**
 * Provider registry + orchestrator.
 *
 * Each provider exposes the same tiny interface:
 *   { id, label, accent, consoleUrl, signInHint, refreshHint, isAvailable(), poll() }
 *
 * poll() resolves to either
 *   { ok: true,  reading, raw }
 *   { ok: false, code, message }   code: not_found|malformed|expired|auth|rate_limited|error
 *
 * Providers whose credentials are absent from disk are skipped entirely and
 * never appear in the UI — installing this app without the Codex CLI should
 * look exactly like the single-provider version did.
 */

const claude = require('./claude');
const codex = require('./codex');

const ALL = [claude, codex];

/** Every registered provider, in display order. */
function all() {
  return ALL;
}

/** Providers that have credentials on disk right now. */
function available() {
  return ALL.filter((p) => {
    try {
      return p.isAvailable();
    } catch {
      return false;
    }
  });
}

function byId(id) {
  return ALL.find((p) => p.id === id) || null;
}

/**
 * Poll every available provider concurrently.
 *
 * A provider that throws outright still yields a result row — one broken
 * provider must never take the whole panel down.
 *
 * @returns {Promise<Array<{id, label, accent, consoleUrl, signInHint, refreshHint, result}>>}
 */
async function pollAll() {
  const providers = available();
  const settled = await Promise.all(
    providers.map(async (p) => {
      try {
        return await p.poll();
      } catch (err) {
        return { ok: false, code: 'error', message: err.message || 'Provider failed.' };
      }
    })
  );
  return providers.map((p, i) => ({
    id: p.id,
    label: p.label,
    accent: p.accent,
    consoleUrl: p.consoleUrl,
    signInHint: p.signInHint,
    refreshHint: p.refreshHint,
    result: settled[i],
  }));
}

module.exports = { all, available, byId, pollAll };
