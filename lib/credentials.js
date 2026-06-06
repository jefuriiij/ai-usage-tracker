'use strict';

/**
 * READ-ONLY reader for Claude Code's OAuth credentials.
 *
 * This module ONLY reads ~/.claude/.credentials.json. It never writes to it and
 * never refreshes the token. Claude Code remains the sole owner/refresher of that
 * file — we simply piggyback on whatever fresh token it last wrote. This is the
 * security-first design: no new secret is created and the token is only ever sent
 * to api.anthropic.com (by lib/usage.js).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const CREDENTIALS_PATH = path.join(os.homedir(), '.claude', '.credentials.json');

/** Error codes surfaced to the caller so the UI can pick the right message. */
const CredStatus = {
  OK: 'ok',
  NOT_FOUND: 'not_found', // file missing — Claude Code not installed / never logged in
  MALFORMED: 'malformed', // file exists but unreadable / wrong shape
  EXPIRED: 'expired', // token present but past its expiry (Claude Code closed a while)
};

class CredentialsError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'CredentialsError';
    this.status = status;
  }
}

/**
 * Read and parse the credentials file fresh from disk.
 * @returns {{ accessToken: string, expiresAt: number }}
 * @throws {CredentialsError} NOT_FOUND | MALFORMED
 */
function read() {
  let raw;
  try {
    raw = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new CredentialsError(
        CredStatus.NOT_FOUND,
        'Claude Code credentials not found. Open Claude Code and sign in.'
      );
    }
    throw new CredentialsError(CredStatus.MALFORMED, `Could not read credentials file: ${err.message}`);
  }

  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new CredentialsError(CredStatus.MALFORMED, 'Credentials file is not valid JSON.');
  }

  const oauth = json && json.claudeAiOauth;
  if (!oauth || typeof oauth.accessToken !== 'string' || !oauth.accessToken) {
    throw new CredentialsError(CredStatus.MALFORMED, 'No OAuth access token in credentials file.');
  }

  const expiresAt = Number(oauth.expiresAt) || 0; // unix ms
  return { accessToken: oauth.accessToken, expiresAt };
}

/**
 * Get the current access token plus whether it is already expired.
 * NEVER refreshes or writes — if expired, the caller keeps showing the last-known
 * reading with a "stale" indicator until Claude Code refreshes the file itself.
 *
 * @param {number} [now] override for testing (unix ms)
 * @returns {{ token: string, expiresAt: number, expired: boolean }}
 * @throws {CredentialsError} NOT_FOUND | MALFORMED
 */
function getAccessToken(now = Date.now()) {
  const { accessToken, expiresAt } = read();
  // Small safety buffer: treat a token within 30s of expiry as expired so we don't
  // fire a request that races the clock.
  const expired = expiresAt > 0 ? now >= expiresAt - 30_000 : false;
  return { token: accessToken, expiresAt, expired };
}

module.exports = { getAccessToken, read, CredStatus, CredentialsError, CREDENTIALS_PATH };
