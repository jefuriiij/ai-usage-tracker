# AI Usage Tracker

A passive Windows system-tray widget that shows your **Claude** and
**Codex / ChatGPT** usage — the same figures as each provider's own "usage
limits" page — without opening a browser.

- **Tray icon** shows a session percentage at a glance (green → amber → red).
  With two providers signed in, a coloured stripe along the bottom of the badge
  says whose number it is, and you choose the source from the right-click menu:
  **Tray icon shows → Highest usage / Claude / Codex**. The choice persists.
- **Click the icon** for a panel with one section per signed-in CLI: Current
  session (5-hour), This week, and any per-model or scoped limits, each with a
  live reset countdown.
- **No login.** It reads the OAuth tokens the CLIs already store on your machine.
- **Only shows what you have.** A provider with no credentials on disk is
  skipped entirely — install without the Codex CLI and it looks exactly like
  the single-provider version.

## Providers

| | Claude | Codex / ChatGPT |
|---|---|---|
| Credential file | `~/.claude/.credentials.json` | `~/.codex/auth.json` (honours `$CODEX_HOME`) |
| Written by | Claude Code | Codex CLI (`codex login`) |
| Endpoint | `api.anthropic.com/api/oauth/usage` | `chatgpt.com/backend-api/wham/usage` |
| Session window | 5 hours | 5 hours |
| Weekly window | 7 days | 7 days |
| Extra rows | per-model weekly limits (e.g. Fable) | code review, plan, credit balance |

> The Codex usage endpoint is **undocumented and reverse-engineered**. It can
> change or disappear without notice; when it does, that section shows an error
> banner and the Claude section keeps working.

Codex authenticated with an **API key** instead of ChatGPT sign-in has no
subscription usage to report — that section says so rather than showing zeros.

## How it works (and why it's safe)

- It reads both credential files **read-only** — it never writes to them, never
  refreshes a token, and never touches a `refresh_token`. Each CLI stays the
  sole owner of its own login.
- Each token is only ever sent to that provider's own server
  (`api.anthropic.com`, `chatgpt.com`). No new secret is created or stored.
- It polls every 180 seconds (the endpoints are rate-limit sensitive), backing
  off to 300s if any provider returns a 429.

### Freshness

The tokens are valid while you're using the CLIs. If a CLI has been **fully
closed for a while**, its token expires — and because this app **never refreshes
it**, that section switches to a *stale* view: the last reading stays visible
(dimmed) alongside the still-accurate reset countdown, labeled "as of HH:MM".
Open the CLI again and the next poll goes live. Providers go stale
independently; one expired token never blanks the other section.

## Run

```sh
npm install
npm start
```

The app lives in the tray (no taskbar button). Right-click the tray icon for:
**Show usage panel · Refresh now · Tray icon shows ▸ · Start at login ·
Open &lt;provider&gt; usage · Quit**.

**Tray icon shows** picks which provider the badge number belongs to —
*Highest usage* (follows whichever is closest to its limit), or a specific
provider pinned. It only appears when more than one provider is signed in, and
the choice is saved to `%APPDATA%\ai-usage-tracker\settings.json`. Pin a
provider that later signs out and the badge quietly reverts to *Highest usage*.

There's one "Open … usage" item per signed-in provider. In the panel, clicking a
provider's name opens the same page.

To launch automatically on sign-in, toggle **Start at login** in that menu.

### Check the data path without the GUI

```sh
npm test               # every provider with credentials on disk
node test-fetch.js codex --raw
```

Prints percentages only — never a token.

### Preview the UI without a tray

```sh
npm run preview                       # fixed two-provider sample
npx electron dev-preview.js --live    # your real signed-in providers
```

Writes `popup-preview.png`, badge PNGs and `tray-sim.png`.

## Build a Windows installer

```sh
npm run icon    # regenerate build/icon.ico (only if you change the icon)
npm run dist    # build the NSIS installer with electron-builder
```

The installer is written to `dist\AI Usage Tracker Setup <version>.exe`. It's a
**per-user** NSIS installer (no admin required) that installs to
`%LOCALAPPDATA%\Programs`, adds Start-Menu and desktop shortcuts, and registers an
uninstaller in *Add/Remove Programs*.

> The installer is **unsigned**, so Windows SmartScreen shows an "Unknown publisher"
> prompt on first run — choose *More info → Run anyway*. To remove that warning you'd
> need a code-signing certificate (configure `win.certificateFile`/`certificatePassword`
> in `package.json` → `build`).

## Files

| File | Role |
|------|------|
| `main.js` | App lifecycle, tray, 180s poll loop, popup window, menu, IPC |
| `lib/providers/index.js` | Provider registry — polls every available provider concurrently |
| `lib/providers/claude.js` | Claude provider (wraps `credentials.js` + `usage.js`) |
| `lib/providers/codex.js` | Codex provider — **read-only** `~/.codex/auth.json` + ChatGPT usage endpoint |
| `lib/credentials.js` | **Read-only** reader for `~/.claude/.credentials.json` |
| `lib/usage.js` | Calls `/api/oauth/usage`, normalizes the response |
| `lib/format.js` | Percent rounding, status colors, "resets in" formatting |
| `lib/settings.js` | Tiny JSON preference store in `userData` (tray-badge choice) |
| `icon.html` | Hidden canvas renderer that paints the tray badge number |
| `preload.js` | Locked-down IPC bridge for the popup |
| `popup.html` / `popup.js` | The usage panel UI |
| `build-icon.js` | Dev tool — regenerates `build/icon.ico` / `build/icon.png` |
| `test-fetch.js` | Headless smoke test for the data path |
| `dev-preview.js` | Dev tool — renders the panel and badges to PNGs |

### Adding another provider

Drop a module in `lib/providers/` exporting
`{ id, label, accent, consoleUrl, signInHint, refreshHint, isAvailable(), poll() }`,
where `poll()` resolves to `{ ok: true, reading, raw }` or
`{ ok: false, code, message }` and `reading` uses the shared
`{ session, week, scoped[], updatedAt }` shape. Register it in
`lib/providers/index.js`. The tray, tooltip, menu and panel pick it up with no
further changes.

On the first successful fetch per provider, the raw response is written once to
`%APPDATA%\ai-usage-tracker\last-usage-<id>.json` so the exact field names can be
verified for your account type.

## Not included (possible follow-ups)

- **Code signing** the installer (removes the SmartScreen "Unknown publisher" prompt).
- Auto-updates (electron-updater) — the NSIS target is already update-ready.
- Threshold notifications / historical graphs.
- More providers (Gemini CLI, Copilot) — the registry is ready for them.
