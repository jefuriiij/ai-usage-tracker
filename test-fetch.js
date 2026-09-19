'use strict';

// Headless smoke test for the data path — no Electron, no GUI.
// Walks every provider that has credentials on disk: reads them, hits the
// usage endpoint, and normalizes the response.
// Prints usage percentages only (never a token).
//
//   node test-fetch.js            # every available provider
//   node test-fetch.js codex      # one provider
//   node test-fetch.js --raw      # also dump the raw JSON responses

const providers = require('./lib/providers');
const fmt = require('./lib/format');

const args = process.argv.slice(2);
const showRaw = args.includes('--raw');
const only = args.filter((a) => !a.startsWith('-'));

(async () => {
  let targets = providers.all();
  if (only.length) {
    targets = targets.filter((p) => only.includes(p.id));
    if (!targets.length) {
      console.error(`Unknown provider(s): ${only.join(', ')}`);
      console.error(`Known: ${providers.all().map((p) => p.id).join(', ')}`);
      process.exit(1);
    }
  }

  let failures = 0;
  let reported = 0;

  for (const p of targets) {
    console.log(`\n=== ${p.label} (${p.id}) ===`);

    if (!p.isAvailable()) {
      console.log(`[skip] no credentials on disk — ${p.signInHint}`);
      continue;
    }

    const res = await p.poll();
    if (!res.ok) {
      const soft = res.code === 'not_found' || res.code === 'expired';
      console[soft ? 'log' : 'error'](`[${soft ? 'skip' : 'FAIL'}] ${res.code}: ${res.message}`);
      if (!soft) failures++;
      continue;
    }

    reported++;
    const n = res.reading;
    if (showRaw) console.log('[raw]\n', JSON.stringify(res.raw, null, 2));
    console.log('[usage] HTTP 200. Raw keys:', Object.keys(res.raw).join(', '));
    if (n.plan) console.log(`  plan: ${n.plan}`);
    if (n.credits) {
      console.log(`  credits: ${n.credits.unlimited ? 'unlimited' : n.credits.balance}`);
    }
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
  }

  console.log(`\n${reported} provider(s) reported, ${failures} failed.`);
  process.exit(failures ? 1 : 0);
})();
