# Claude Usage Tracker

A passive Windows system-tray widget that shows your Claude **Current session**
usage — the same "37% used · Resets in 1 hr 35 min" figure as the claude.ai
"Your usage limits" panel — without opening a browser.

- **Tray icon** shows your current-session percentage at a glance (green → amber → red).
- **Click the icon** for a panel with Current session (5-hour), This week (all models),
  and This week (Opus), each with a live reset countdown.
- **No login.** It reads the OAuth token Claude Code already stores on your machine.

## How it works (and why it's safe)

- It reads `~/.claude/.credentials.json` **read-only** — it never writes to that file
  and never refreshes the token. Claude Code stays the sole owner of your login.
- The token is only ever sent to `https://api.anthropic.com/api/oauth/usage`
  (Anthropic's own server). No new secret is created or stored.
- It polls every 180 seconds (the endpoint is rate-limit sensitive).

### Freshness

The token Claude Code stores is valid while you're using Claude Code. If Claude Code
has been **fully closed for ~1 hour**, the token expires — and because this app
**never refreshes it**, the panel switches to a *stale* view: it keeps showing your
last reading (dimmed) plus the still-accurate reset countdown, labeled "as of HH:MM".
Open Claude Code again and the next poll goes live.

## Run

```sh
npm install
npm start
```

The app lives in the tray (no taskbar button). Right-click the tray icon for:
**Show usage panel · Refresh now · Start at login · Open claude.ai usage · Quit**.

To launch automatically on sign-in, toggle **Start at login** in that menu.

## Build a Windows installer

```sh
npm run icon    # regenerate build/icon.ico (only if you change the icon)
npm run dist    # build the NSIS installer with electron-builder
```

The installer is written to `dist\Claude Usage Tracker Setup <version>.exe`. It's a
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
| `lib/credentials.js` | **Read-only** reader for `~/.claude/.credentials.json` |
| `lib/usage.js` | Calls `/api/oauth/usage`, normalizes the response |
| `lib/format.js` | Percent rounding, status colors, "resets in" formatting |
| `icon.html` | Hidden canvas renderer that paints the tray badge number |
| `preload.js` | Locked-down IPC bridge for the popup |
| `popup.html` / `popup.js` | The usage panel UI |
| `build-icon.js` | Dev tool — regenerates `build/icon.ico` / `build/icon.png` |

| File | Role |
|------|------|
| `main.js` | App lifecycle, tray, 180s poll loop, popup window, menu, IPC |
| `lib/credentials.js` | **Read-only** reader for `~/.claude/.credentials.json` |
| `lib/usage.js` | Calls `/api/oauth/usage`, normalizes the response |
| `lib/format.js` | Percent rounding, status colors, "resets in" formatting |
| `icon.html` | Hidden canvas renderer that paints the tray badge number |
| `preload.js` | Locked-down IPC bridge for the popup |
| `popup.html` / `popup.js` | The usage panel UI |

On the first successful fetch, the raw response is written once to
`%APPDATA%\claude-usage-tracker\last-usage.json` so the exact field names can be
verified for your account type.

## Not included (possible follow-ups)

- **Code signing** the installer (removes the SmartScreen "Unknown publisher" prompt).
- Auto-updates (electron-updater) — the NSIS target is already update-ready.
- Threshold notifications / historical graphs.
