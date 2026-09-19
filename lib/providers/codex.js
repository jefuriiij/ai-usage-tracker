'use strict';

/**
 * Codex / ChatGPT provider — READ-ONLY reader for the Codex CLI's OAuth
 * credentials plus the ChatGPT usage endpoint.
 *
 * Mirrors the Claude provider's security stance exactly: we only ever READ
 * ~/.codex/auth.json (or $CODEX_HOME/auth.json). The Codex CLI remains the
 * sole owner and refresher of that file — we never write it and never use the
 * refresh_token. If the access token goes stale, we show the last-known
 * reading until Codex refreshes the file itself.
 *
 * Endpoint:
 *   GET https://chatgpt.com/backend-api/wham/usage
 *   Authorization: Bearer <tokens.access_token>
 *   ChatGPT-Account-Id: <tokens.account_id>
 *
 * This endpoint is undocumented and reverse-engineered — it can change or
 * disappear without notice, so every field read here is optional and the
 * provider degrades to an error row rather than throwing.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const id = 'codex';
const label = 'Codex';
const accent = '#10a37f'; // openai green
const consoleUrl = 'https://chatgpt.com/codex/settings/usage';
const signInHint = 'Sign in via Codex CLI';
const refreshHint = 'Open Codex CLI to refresh';

const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const USER_AGENT = 'codex-cli';
const TIMEOUT_MS = 10_000;

/** Codex honours $CODEX_HOME; fall back to ~/.codex. */
function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

function authPath() {
  return path.join(codexHome(), 'auth.json');
}

/** Thrown for non-2xx responses so poll() can branch on HTTP status. */
class UsageHttpError extends Error {
  constructor(status, body) {
    super(`Codex usage request failed with HTTP ${status}`);
    this.name = 'UsageHttpError';
    this.status = status;
    this.body = body;
  }
}

/** True when the Codex CLI has written an auth file we can read. */
function isAvailable() {
  try {
    return fs.existsSync(authPath());
  } catch {
    return false;
  }
}

/**
 * Best-effort expiry read from the access token's JWT payload. We only decode
 * the claims (no signature check — we are not validating the token, just
 * avoiding a request we know will 401).
 *
 * @returns {number} unix ms, or 0 when the token is not a decodable JWT
 */
function tokenExpiry(jwt) {
  try {
    const part = String(jwt).split('.')[1];
    if (!part) return 0;
    const json = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return Number(json.exp) > 0 ? Number(json.exp) * 1000 : 0;
  } catch {
    return 0;
  }
}

/**
 * Read and parse the Codex auth file fresh from disk.
 * @returns {{ token: string, accountId: string|null, expiresAt: number, expired: boolean }}
 * @throws {Error} with .code = not_found | malformed
 */
function readAuth(now = Date.now()) {
  let raw;
  try {
    raw = fs.readFileSync(authPath(), 'utf8');
  } catch (err) {
    const e = new Error(
      err.code === 'ENOENT'
        ? 'Codex credentials not found. Open the Codex CLI and sign in.'
        : `Could not read Codex auth file: ${err.message}`
    );
    e.code = err.code === 'ENOENT' ? 'not_found' : 'malformed';
    throw e;
  }

  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    const e = new Error('Codex auth file is not valid JSON.');
    e.code = 'malformed';
    throw e;
  }

  const tokens = json && json.tokens;
  const token = tokens && typeof tokens.access_token === 'string' ? tokens.access_token : '';
  if (!token) {
    // API-key-only auth (OPENAI_API_KEY set, no ChatGPT sign-in) lands here:
    // there is no subscription usage to report for that path.
    const e = new Error(
      json && json.OPENAI_API_KEY
        ? 'Codex is using an API key — subscription usage is only tracked for ChatGPT sign-in.'
        : 'No OAuth access token in the Codex auth file.'
    );
    e.code = 'malformed';
    throw e;
  }

  const accountId = tokens && typeof tokens.account_id === 'string' ? tokens.account_id : null;
  const expiresAt = tokenExpiry(token);
  // 30s safety buffer so we don't fire a request that races the clock.
  const expired = expiresAt > 0 ? now >= expiresAt - 30_000 : false;
  return { token, accountId, expiresAt, expired };
}

/**
 * Call the ChatGPT usage endpoint.
 * @returns {Promise<object>} raw parsed JSON response
 * @throws {UsageHttpError} on non-2xx
 */
async function fetchRaw(token, accountId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers = {
      Authorization: `Bearer ${token}`,
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json',
    };
    if (accountId) headers['ChatGPT-Account-Id'] = accountId;

    const res = await fetch(USAGE_URL, { method: 'GET', headers, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) throw new UsageHttpError(res.status, text);
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
 * Convert a window node into the shared {pct, resetsAt} shape.
 *
 * The endpoint reports `used_percent` on a 0–100 scale and `reset_at` as unix
 * SECONDS (unlike Anthropic's ISO-8601 string), so we convert to ISO here and
 * lib/format.js keeps working unchanged.
 */
function pickWindow(node) {
  if (!node || typeof node !== 'object') return null;
  const pct = node.used_percent;
  if (typeof pct !== 'number' || Number.isNaN(pct)) return null;

  let resetsAt = null;
  if (typeof node.reset_at === 'number' && node.reset_at > 0) {
    resetsAt = new Date(node.reset_at * 1000).toISOString();
  } else if (typeof node.reset_after_seconds === 'number' && node.reset_after_seconds >= 0) {
    resetsAt = new Date(Date.now() + node.reset_after_seconds * 1000).toISOString();
  }
  return { pct, resetsAt };
}

/**
 * Normalize the raw response into the shape the UI consumes — the same
 * { session, week, scoped[], updatedAt } contract the Claude provider returns.
 *
 *   primary_window   (18000s  = 5h) -> session
 *   secondary_window (604800s = 7d) -> week
 *   code_review_rate_limit / additional_rate_limits -> scoped rows
 *
 * `plan` and `credits` ride along as extras for the panel header.
 */
function normalize(raw, now = Date.now()) {
  const out = { session: null, week: null, scoped: [], updatedAt: now, plan: null, credits: null };
  if (!raw || typeof raw !== 'object') return out;

  const rl = raw.rate_limit || {};
  out.session = pickWindow(rl.primary_window);
  out.week = pickWindow(rl.secondary_window);

  const review = raw.code_review_rate_limit && raw.code_review_rate_limit.primary_window;
  const reviewWin = pickWindow(review);
  if (reviewWin) out.scoped.push({ label: 'Code review', ...reviewWin });

  // Forward-compat: the API may grow per-model windows here. Anything with a
  // readable used_percent becomes a row labeled by whatever name it carries.
  const extra = raw.additional_rate_limits;
  if (extra && typeof extra === 'object') {
    const entries = Array.isArray(extra) ? extra.map((v, i) => [String(i), v]) : Object.entries(extra);
    for (const [key, node] of entries) {
      const win = pickWindow(node && node.primary_window ? node.primary_window : node);
      if (!win) continue;
      const name = (node && (node.display_name || node.name)) || key;
      out.scoped.push({ label: String(name), ...win });
    }
  }

  if (typeof raw.plan_type === 'string') out.plan = raw.plan_type;

  const c = raw.credits;
  if (c && typeof c === 'object' && c.has_credits) {
    out.credits = {
      unlimited: !!c.unlimited,
      balance: typeof c.balance === 'number' ? c.balance : null,
    };
  }
  return out;
}

/**
 * Poll the Codex usage endpoint.
 *
 * @returns {Promise<{ok: true, reading: object, raw: object} | {ok: false, code: string, message: string}>}
 *   code is one of: not_found | malformed | expired | auth | rate_limited | error
 */
async function poll() {
  let auth;
  try {
    auth = readAuth();
  } catch (err) {
    return { ok: false, code: err.code || 'error', message: err.message };
  }

  if (auth.expired) {
    // READ-ONLY: we never use the refresh_token. Codex owns that.
    return { ok: false, code: 'expired', message: 'Token expired — open the Codex CLI to refresh.' };
  }

  try {
    const raw = await fetchRaw(auth.token, auth.accountId);
    return { ok: true, reading: normalize(raw), raw };
  } catch (err) {
    if (err instanceof UsageHttpError && err.status === 429) {
      return { ok: false, code: 'rate_limited', message: 'Rate limited — backing off.' };
    }
    if (err instanceof UsageHttpError && (err.status === 401 || err.status === 403)) {
      return { ok: false, code: 'auth', message: 'Token rejected — open the Codex CLI to refresh.' };
    }
    return { ok: false, code: 'error', message: err.message || 'Network error.' };
  }
}

module.exports = {
  id,
  label,
  accent,
  consoleUrl,
  signInHint,
  refreshHint,
  isAvailable,
  poll,
  // exported for tests / the headless smoke test
  readAuth,
  fetchRaw,
  normalize,
  UsageHttpError,
  USAGE_URL,
  authPath,
};
