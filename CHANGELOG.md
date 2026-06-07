# Changelog

All notable changes to **Claude Usage Tracker** are recorded here.
Each released version ships a matching `releases/Claude Usage Tracker Setup <version>.exe`.

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
