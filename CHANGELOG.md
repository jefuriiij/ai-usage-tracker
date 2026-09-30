# Changelog

All notable changes to **AI Usage Tracker** (formerly Claude Usage Tracker) are
recorded here. Each released version ships a matching
`releases/AI Usage Tracker Setup <version>.exe`.

## [1.2.0] — 2026-10-01

### Added
- **Linux support.** The app now runs as a tray widget on Linux
  (StatusNotifierItem / AppIndicator), alongside Windows.
- `lib/autostart.js`: a platform-aware "Start at login". On Linux, Electron's
  `app.setLoginItemSettings()` does nothing (it never throws, and
  `getLoginItemSettings()` always reports `openAtLogin: false`), so the menu
  checkbox could never stick. The Linux path writes an XDG autostart entry to
  `~/.config/autostart/ai-usage-tracker.desktop` instead, and the checkbox shows
  the state that actually landed on disk.
- Linux `electron-builder` packaging: an AppImage target (`npm run dist:linux`),
  plus `npm run dist:rpm` and `npm run dist:win`. `build.linux.icon` points at a
  new sized icon set in `build/icons/`.
- On Linux the tray menu now starts with one row per provider
  (`Claude: 6% (2h 37m) · wk 58%`). Linux tray backends show no hover tooltip,
  so without this the numbers would only exist inside the panel. Clicking a
  row opens the panel.
- On Linux, **Start at login** is drawn as a checkbox icon in the icon column.
  KDE draws a real checkbox item outside that column, so the row sat out of
  line with every other item.

### Fixed
- The usage panel no longer opens in the wrong corner on Linux.
  `tray.getBounds()` returns all zeros there, which pinned the panel to the
  bottom-left. When bounds are missing, the panel now anchors to the screen edge
  the desktop panel occupies, worked out from the work-area inset.

### Changed
- `buildTooltip()` was split into `summaryLines()` (one line per provider) plus
  a thin tooltip wrapper, so the tooltip and the Linux menu rows share one
  source.

## [1.1.2] — 2026-09-30

### Fixed
- **Double polling.** Startup armed a second 180s timer that was never cleared,
  so both endpoints were hit twice per interval and the 429 backoff only slowed
  one of the two loops. There is now exactly one poll timer.
- **Overlapping polls.** A poll requested while another is in flight now joins
  it instead of firing a second round of requests.
- **Tray click reopening the panel.** Clicking the tray icon while the panel was
  open blurred it (hiding it) and the click then reopened it. The click now
  closes it.
- Codex header no longer shows `null credits` when the API reports credits
  without a balance.
- A Claude **403** is now treated as a rejected token (as 401 already was, and
  as Codex does), instead of a generic error.
- Panel height no longer reserves 24px for the "waiting" placeholder in a
  section where the error banner replaces it. `dev-preview.js` mirrors the fix.

## [1.1.1] — 2026-09-19

### Added
- **"Tray icon shows" submenu** in the tray right-click menu: choose whether the
  badge number follows *Highest usage* (whichever provider is closest to its
  limit) or is pinned to Claude or Codex. The choice persists across restarts in
  `%APPDATA%\ai-usage-tracker\settings.json` via a new `lib/settings.js`. The
  submenu only appears when more than one provider is signed in.
- **Provider accent stripe on the tray badge** — a 4px coloured bar along the
  bottom edge (Claude coral / Codex green) identifying whose percentage the
  number is. Drawn only when more than one provider is signed in; the number is
  nudged up and slightly resized so it stays optically centred. Verified legible
  at 16px.
- The tray tooltip marks the provider the badge speaks for with a `●`.

### Changed
- `drawBadge(text, stale, accent)` takes an optional accent colour;
  `drawMenuGlyph` gained a `badge` glyph for the new submenu.
- `dev-preview.js` renders the accent-striped badge variants and puts them in
  `tray-sim.png` at real tray sizes.

### Fixed
- Pinning a provider that later signs out no longer leaves the badge stuck on
  `?` — it reverts to *Highest usage*. A pinned provider that is signed in but
  has no reading yet shows `?` rather than silently borrowing the other
  provider's number.

## [1.1.0] — 2026-09-19

### Added
- **Codex / ChatGPT usage tracking.** A second provider reads the Codex CLI's
  OAuth token from `~/.codex/auth.json` (honouring `$CODEX_HOME`) and polls
  `chatgpt.com/backend-api/wham/usage` for the 5-hour and 7-day windows, plus
  plan tier, credit balance and the code-review limit when present. Same
  read-only contract as Claude: the file is never written and the
  `refresh_token` is never used.
- **Provider registry** (`lib/providers/`). Each provider exports
  `{ id, label, accent, consoleUrl, signInHint, refreshHint, isAvailable, poll }`
  and normalizes to the shared `{ session, week, scoped[], updatedAt }` shape.
  Adding a third provider needs no changes to the tray, menu or panel.
- `npm test` runs the headless smoke test across every available provider
  (`node test-fetch.js [id] [--raw]`); `npm run preview` renders the panel, and
  `dev-preview.js --live` does it against your real accounts.

### Changed
- Renamed to **AI Usage Tracker** (`ai-usage-tracker`, appId `com.aiusage.tracker`).
- The panel now stacks one section per signed-in CLI, each with its own status
  dot, accent-coloured name (click it to open that provider's usage page),
  banner and rows. Window height is computed from the sections actually shown.
- Tray badge reports the **highest** current-session percentage across
  providers; the tooltip gives each provider one compact line.
- The right-click menu lists one "Open &lt;provider&gt; usage" item per signed-in
  provider instead of a single hardcoded claude.ai link.
- Providers poll concurrently and fail independently — an expired Codex token
  no longer affects the Claude section, and one 429 backs the loop off to 300s
  without blanking anything.
- Providers with no credentials on disk are skipped entirely, so a
  Claude-only machine sees the same single-section panel as before.
- The per-provider discovery log is now
  `%APPDATA%\ai-usage-tracker\last-usage-<id>.json`.

### Fixed
- Removed a duplicated "Files" table in the README.

## [1.0.7] — 2026-07-02

### Added
- Per-model weekly limits are now read from the API's new self-describing
  `limits` array and rendered dynamically with the label the API provides —
  so the new "Fable" weekly limit shows up in the popup ("This week (Fable)")
  and the tray tooltip ("Fable only: N%"), and future scoped limits will
  appear automatically without code changes.

### Changed
- `normalize()` prefers the `limits` array (kinds `session` / `weekly_all` /
  scoped) and falls back to the legacy flat fields (`five_hour`, `seven_day`,
  `seven_day_opus`, `seven_day_sonnet`) for older responses. The hardcoded
  Opus/Sonnet popup rows were replaced by dynamic scoped rows.

## [1.0.6] — 2026-06-07

### Added
- The tray right-click menu now shows a small icon before each item — a panel
  glyph for "Show usage panel", a circular arrow for "Refresh now", an
  open-link box for "Open claude.ai usage", and a power symbol for "Quit". The
  glyphs are theme-aware (light on dark menus, dark on light) and re-render if
  the OS theme changes. ("Start at login" stays a checkbox, so its checkmark is
  its indicator.)

## [1.0.5] — 2026-06-07

### Fixed
- Weekly/any usage at or below 1% was shown as 100%. `pickWindow()` had a
  heuristic that treated `utilization <= 1` as a 0–1 fraction and multiplied by
  100, so a genuine 1% reading became 100% (and showed a red bar). The endpoint
  always reports utilization on a 0–100 scale, so the rescaling was removed —
  values now pass through untouched and match the claude.ai panel.

## [1.0.4] — 2026-06-07

### Changed
- Installer no longer asks for an install folder. It installs to the default
  per-user location and, when an existing install is detected (same app GUID),
  updates in place instead of showing the folder page again — so reinstalls/
  upgrades flow straight through the wizard. (Removed
  `allowToChangeInstallationDirectory`; the folder page was shown on every run,
  making updates look like fresh installs.)

## [1.0.3] — 2026-06-07

### Changed
- Installer is now an assisted wizard (Welcome → choose folder → install → Finish)
  with Cancel/Back/Next buttons, a branded espresso-gradient sidebar, and a
  "launch on finish" checkbox — replacing the silent one-click installer. Still a
  per-user install (no admin/UAC prompt); an existing install updates in place.

## [1.0.2] — 2026-06-07

### Changed
- Tray tooltip is now multi-line with a `Claude Usage` header and one limit
  per line (Session / Week / Opus only / Sonnet only) instead of a single
  run-on sentence. Session line shows the full "resets in 1 hr 35 min" form.

## [1.0.1] — 2026-06-07

### Changed
- Redesigned the tray badge and the app/installer icon to a dark espresso
  gradient (`#120B05` → `#784921`) with a white number/gauge, replacing the
  flat Claude coral.

### Fixed
- `render()` crash (`ReferenceError: CLAUDE_ORANGE is not defined`) left over
  from the badge refactor — the tray icon now updates without throwing.

## [1.0.0] — 2026-06-06

### Added
- Initial release: passive Windows system-tray widget showing Claude session
  usage, read-only from Claude Code's OAuth token. Tray badge shows session %;
  click opens a popup with all limits + live reset countdowns. Coral gauge icon.
