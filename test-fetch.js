'use strict';

// Headless smoke test for the data path — no Electron, no GUI.
// Verifies: credentials read OK, usage endpoint returns 200, response normalizes.
// Prints usage percentages only (never the token).

const credentials = require('./lib/credentials');
const usage = require('./lib/usage');
const fmt = require('./lib/format');

(async () => {
  let cred;
  try {
    cred = credentials.getAccessToken();
    console.log(`[creds] ok — expired=${cred.expired}, expiresAt=${new Date(cred.expiresAt).toISOString()}`);
  } catch (err) {
    console.error(`[creds] FAIL (${err.status}): ${err.message}`);
    process.exit(1);
  }

  if (cred.expired) {
    console.log('[creds] token is expired — open Claude Code to refresh, then re-run.');
    process.exit(0);
  }

  try {
    const raw = await usage.fetchRaw(cred.token);
    console.log('[usage] HTTP 200. Raw keys:', Object.keys(raw).join(', '));
    console.log('[usage] raw response:\n', JSON.stringify(raw, null, 2));
    const n = usage.normalize(raw);
    console.log('\n[normalized]');
    for (const k of ['session', 'week']) {
      if (n[k]) console.log(`  ${k}: ${fmt.roundPct(n[k].pct)}%  resets in ${fmt.resetsIn(n[k].resetsAt)}`);
      else console.log(`  ${k}: (none)`);
    }
    if (n.scoped.length) {
      for (const s of n.scoped) {
        console.log(`  scoped[${s.label}]: ${fmt.roundPct(s.pct)}%  resets in ${fmt.resetsIn(s.resetsAt)}`);
      }
    } else {
      console.log('  scoped: (none)');
    }
  } catch (err) {
    console.error(`[usage] FAIL: status=${err.status || '?'} ${err.message}`);
    if (err.body) console.error('[usage] body:', String(err.body).slice(0, 400));
    process.exit(1);
  }
})();
