# Development

Notes for working on AI Usage Tracker itself. If you just want to use the app,
see the [README](../README.md).

## Run from source

```sh
npm install
npm start
```

The app lives in the system tray with no taskbar button. If an installed copy
is already running, quit it first: both share a single-instance lock, so
`npm start` would just surface the installed copy.

## Check the data path without the GUI

```sh
npm test                        # every provider with credentials on disk
node test-fetch.js codex        # one provider
node test-fetch.js codex --raw  # also dump the raw JSON response
```

This calls the live usage endpoints with your real tokens. It prints
percentages only, never a token. `--raw` output can include your account email
and ID, so don't paste it anywhere public.

## Preview the UI without a tray

```sh
npm run preview                       # fixed two-provider sample
npx electron dev-preview.js --live    # your real signed-in providers
```

Writes `popup-preview.png`, the badge PNGs and `tray-sim.png` to the project
root. They are gitignored.

## Build the installer

```sh
npm run icon    # regenerate build/icon.ico (only if you change the icon)
npm run dist    # build the NSIS installer with electron-builder
```

The installer lands in `dist/AI Usage Tracker Setup <version>.exe`. It's a
per-user NSIS installer: no admin rights, installs to
`%LOCALAPPDATA%\Programs`, adds Start menu and desktop shortcuts, and
registers an uninstaller in Add/Remove Programs.

The installer is unsigned. Signing it needs a code-signing certificate
(`win.certificateFile` / `certificatePassword` under `build` in
`package.json`).

If the build fails with `app.asar: The process cannot access the file`, a
previous build's output is still locked. Build to a fresh folder instead:

```sh
npx electron-builder -c.directories.output=dist2
```

## Project layout

| File | Role |
|------|------|
| `main.js` | App lifecycle, tray, poll loop, popup window, menu, IPC |
| `lib/providers/index.js` | Provider registry; polls every available provider concurrently |
| `lib/providers/claude.js` | Claude provider (wraps `credentials.js` + `usage.js`) |
| `lib/providers/codex.js` | Codex provider: reads `~/.codex/auth.json`, calls the ChatGPT usage endpoint |
| `lib/credentials.js` | Read-only reader for `~/.claude/.credentials.json` |
| `lib/usage.js` | Calls Anthropic's `/api/oauth/usage` and normalizes the response |
| `lib/format.js` | Percent rounding, status colours, "resets in" formatting |
| `lib/settings.js` | Small JSON preference store in `userData` (tray badge choice) |
| `icon.html` | Hidden canvas renderer that paints the tray badge and menu glyphs |
| `preload.js` | Locked-down IPC bridge for the popup |
| `popup.html` / `popup.js` | The usage panel |
| `build-icon.js` | Regenerates `build/icon.ico` and `build/icon.png` |
| `test-fetch.js` | Headless smoke test for the data path |
| `dev-preview.js` | Renders the panel and badges to PNGs |

## Endpoints

| | Claude | Codex / ChatGPT |
|---|---|---|
| Credential file | `~/.claude/.credentials.json` | `~/.codex/auth.json` (honours `$CODEX_HOME`) |
| Endpoint | `api.anthropic.com/api/oauth/usage` | `chatgpt.com/backend-api/wham/usage` |
| Session window | 5 hours | 5 hours |
| Weekly window | 7 days | 7 days |
| Extra rows | per-model weekly limits | code review, plan, credit balance |

Neither endpoint is a documented public API. Expect either to change.

Polling runs every 180 seconds and backs off to 300 seconds after any 429.
Manual refreshes closer than 30 seconds to the last poll are ignored.

## Adding another provider

Add a module in `lib/providers/` that exports:

```js
{ id, label, accent, consoleUrl, signInHint, refreshHint, isAvailable(), poll() }
```

`poll()` resolves to `{ ok: true, reading, raw }` or
`{ ok: false, code, message }`, where `code` is one of `not_found`,
`malformed`, `expired`, `auth`, `rate_limited` or `error`. `reading` uses the
shared shape:

```js
{ session, week, scoped: [{ label, pct, resetsAt }], updatedAt }
```

Register it in `lib/providers/index.js`. The tray, tooltip, menu and panel pick
it up with no other changes.

Keep the read-only rule: never write the CLI's credential file and never use its
refresh token.

## Local files the app writes

Both live in `%APPDATA%\ai-usage-tracker\`:

- `settings.json`: the tray badge choice.
- `last-usage-<id>.json`: the first successful raw response per provider,
  written once so field names can be checked for your account type. It can
  contain your account email and ID.

## Ideas not built yet

- Code signing, to remove the SmartScreen prompt.
- Auto-updates via electron-updater. The NSIS target already supports it.
- Notifications when a limit crosses a threshold.
- Usage history graphs.
- More providers, such as Gemini CLI or Copilot.
