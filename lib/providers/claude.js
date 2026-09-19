'use strict';

/**
 * Claude provider — wraps the original read-only Claude Code data path
 * (lib/credentials.js + lib/usage.js) in the shared provider interface.
 *
 * Read-only contract is unchanged: Claude Code owns and refreshes
 * ~/.claude/.credentials.json; we only ever read whatever it last wrote.
 */

const fs = require('fs');

const credentials = require('../credentials');
const usage = require('../usage');

const id = 'claude';
const label = 'Claude';
const accent = '#d97757'; // claude coral
const consoleUrl = 'https://claude.ai/settings/usage';
const signInHint = 'Sign in via Claude Code';
const refreshHint = 'Open Claude Code to refresh';

/** True when Claude Code has written a credentials file we can read. */
function isAvailable() {
  try {
    return fs.existsSync(credentials.CREDENTIALS_PATH);
  } catch {
    return false;
  }
}

/**
 * Poll the Claude usage endpoint.
 *
 * @returns {Promise<{ok: true, reading: object} | {ok: false, code: string, message: string}>}
 *   code is one of: not_found | malformed | expired | auth | rate_limited | error
 */
async function poll() {
  let cred;
  try {
    cred = credentials.getAccessToken();
  } catch (err) {
    const code = err.status === credentials.CredStatus.NOT_FOUND ? 'not_found' : 'malformed';
    return { ok: false, code, message: err.message };
  }

  if (cred.expired) {
    // READ-ONLY: we never refresh. Caller keeps showing the last good reading.
    return { ok: false, code: 'expired', message: 'Token expired — open Claude Code to refresh.' };
  }

  try {
    const raw = await usage.fetchRaw(cred.token);
    return { ok: true, reading: usage.normalize(raw), raw };
  } catch (err) {
    if (err instanceof usage.UsageHttpError && err.status === 429) {
      return { ok: false, code: 'rate_limited', message: 'Rate limited — backing off.' };
    }
    if (err instanceof usage.UsageHttpError && err.status === 401) {
      return { ok: false, code: 'auth', message: 'Token rejected — open Claude Code to refresh.' };
    }
    return { ok: false, code: 'error', message: err.message || 'Network error.' };
  }
}

module.exports = { id, label, accent, consoleUrl, signInHint, refreshHint, isAvailable, poll };
