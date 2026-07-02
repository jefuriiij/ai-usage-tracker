'use strict';

/**
 * Fetches Claude usage from Anthropic's OAuth usage endpoint and normalizes it.
 *
 * Endpoint (confirmed via prior art):
 *   GET https://api.anthropic.com/api/oauth/usage
 * Auth: the OAuth access token Claude Code stores in ~/.claude/.credentials.json.
 *
 * No token refresh logic lives here — this is part of the read-only design.
 */

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const OAUTH_BETA = 'oauth-2025-04-20';
const TIMEOUT_MS = 10_000;

// The User-Agent MUST look like Claude Code or the endpoint hands back aggressive
// 429s. Keep this in the claude-code/<version> shape.
const USER_AGENT = 'claude-code/1.0.0';

/** Thrown for non-2xx responses so the caller can branch on HTTP status. */
class UsageHttpError extends Error {
  constructor(status, body) {
    super(`Usage request failed with HTTP ${status}`);
    this.name = 'UsageHttpError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Call the usage endpoint.
 * @param {string} token OAuth access token
 * @returns {Promise<object>} raw parsed JSON response
 * @throws {UsageHttpError} on non-2xx
 */
async function fetchRaw(token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(USAGE_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': OAUTH_BETA,
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    const text = await res.text();
    if (!res.ok) {
      throw new UsageHttpError(res.status, text);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new UsageHttpError(res.status, `Non-JSON response: ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pull a single {pct, resetsAt} window out of the response, tolerating absence
 * and either 0–100 or 0–1 scaling.
 */
function pickWindow(node) {
  if (!node || typeof node !== 'object') return null;
  const pct = node.utilization;
  if (pct === null || pct === undefined || typeof pct !== 'number') return null;
  // The endpoint returns utilization already on a 0–100 scale (e.g. 1 == 1%,
  // 17 == 17%). Do NOT rescale: an earlier "treat <=1 as a 0–1 fraction"
  // heuristic turned a genuine 1% reading into 100%. Whole-number percents are
  // exactly what the API sends, so pass the value through untouched.
  const resetsAt = typeof node.resets_at === 'string' ? node.resets_at : null;
  return { pct, resetsAt };
}

/**
 * Normalize the raw response into the shape the UI consumes.
 *
 * Preferred source is the self-describing `limits` array (added to the API
 * ~2026-07): kind "session" and "weekly_all" map to fixed rows, and every
 * other entry (e.g. kind "weekly_scoped" with scope.model.display_name
 * "Fable") becomes a `scoped` row labeled by the API — so new per-model
 * limits show up without code changes. Older responses without `limits`
 * fall back to the legacy flat fields.
 *
 * @param {object} raw
 * @returns {{ session: object|null, week: object|null,
 *             scoped: Array<{label: string, pct: number, resetsAt: string|null}>,
 *             updatedAt: number }}
 */
function normalize(raw, now = Date.now()) {
  const out = { session: null, week: null, scoped: [], updatedAt: now };

  const limits = raw && Array.isArray(raw.limits) ? raw.limits : null;
  if (limits && limits.length) {
    for (const l of limits) {
      if (!l || typeof l.percent !== 'number') continue;
      const win = { pct: l.percent, resetsAt: typeof l.resets_at === 'string' ? l.resets_at : null };
      if (l.kind === 'session') {
        out.session = win;
      } else if (l.kind === 'weekly_all') {
        out.week = win;
      } else {
        const scope = l.scope || {};
        const label =
          (scope.model && scope.model.display_name) ||
          (scope.surface && scope.surface.display_name) ||
          l.kind;
        out.scoped.push({ label, ...win });
      }
    }
    return out;
  }

  // Legacy flat fields (responses that predate the `limits` array).
  out.session = pickWindow(raw && raw.five_hour);
  out.week = pickWindow(raw && raw.seven_day);
  const opus = pickWindow(raw && raw.seven_day_opus);
  if (opus) out.scoped.push({ label: 'Opus', ...opus });
  const sonnet = pickWindow(raw && raw.seven_day_sonnet);
  if (sonnet) out.scoped.push({ label: 'Sonnet', ...sonnet });
  return out;
}

module.exports = { fetchRaw, normalize, UsageHttpError, USAGE_URL, USER_AGENT };
