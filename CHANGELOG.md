# Changelog

All notable changes to **Godzilla Health Monitor** (NTRX AppOps).
Newest first. Each entry is one push to `main`; the short hash lets you open the exact commit.
The format follows [Keep a Changelog](https://keepachangelog.com/).

## Unreleased · Daily checklist with Teams reminders

### Added
- **Checklist tab:** every saved group (for example *Daily HC*) becomes a daily checklist. Tick each customer once it has been
  checked, or *Mark all done*; the ring and counts show how far you are. It starts unticked every day.
- **Teams reminders:** connect a Teams chat once (Checklist → Teams reminders: create a *Workflows → “Post to a chat when a
  webhook request is received”* flow, paste its address). If anything on a tracked list is still unticked at your reminder
  times (default **12 AM, 3 AM and 6 AM**, editable) you get one Teams message listing what is missing; nothing is sent once
  everything is ticked. Pick which lists to be reminded about, switch reminders off, or send a test message. The webhook
  address is a secret: kept on the server only, never sent back to the browser, and only Microsoft hosts (webhook.office.com,
  logic.azure.com, powerplatform.com) are accepted, so the server cannot be pointed elsewhere.
- **Quick schedule:** *Every N hours starting at …* fills in the reminder times for you (up to 24 a day), and **Keep reminding
  until everything is ticked** repeats the reminder every 15 min to 4 h, from the first reminder time each day until the list is
  ticked or midnight. If the backend was down and several reminders were due, only the newest is sent.
- **Email reminders are built but hidden for now** (backend + form; `SHOW_EMAIL` in `ChecklistView.tsx`). Email and Teams keep
  separate “already sent” records, so one failing never repeats the other.
- A reminder missed because the backend was down is still sent if it is under an hour late, and is never sent twice.
- Backend: `/api/checklist` endpoints, a one-minute reminder timer (independent of the Azure scans), SMTP mailer
  (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` in `backend/.env`); the lists, ticks and email are
  kept in the git-ignored `backend/.cache` so they survive restarts. Inputs are validated (email header injection, sizes) and
  mail content is HTML-escaped.

## Unreleased · 3D charts (optional)

### Added
- **3D charts switch** (Settings → Appearance → *3D charts*, and a quick **3D** chip on every Visual insights bar). **Off by
  default**, so the dashboard looks exactly as before until you turn it on.
- With it on: donuts become a solid **exploded 3D pie** on a platform, with a callout per slice showing its share, name and
  count (hover pulls a slice out; click still filters the tab); bars look raised; the coverage line becomes a ribbon with
  sphere markers; the health gauge is a tilted disc. The setting is saved per browser and mirrored on `<html data-charts>`.

## 2026-10-21 · macOS themes and a wallpaper fix

### Added
- **Five macOS-inspired themes:** *macOS* (light), *macOS Dark* (graphite), *macOS AMOLED* (true black), *macOS Glass* (frosted
  glass on a bright wallpaper), *macOS Glass Dark* and *macOS Glass AMOLED* (glass over faint colour glows on true black): Apple
  system colours, window traffic lights on the sidebar, frosted sidebar and panels, rounded-rectangle controls and the system
  font stack. There are now 12 themes (Settings → Appearance, or the 🎨 button).

### Fixed
- **Theme wallpapers covered only the first screen:** the page background sat on an element exactly one viewport tall, so a
  fixed gradient stopped there and a plain colour showed while scrolling (Glass, Calm, Aurora, Emerald, Sunset, macOS). It now
  covers the whole page; `wallpaper.spec.ts` guards it.

## 2026-10-21 · Performance (branch `Dev-Suyog`)

### Changed
- **Page load:** responses are compressed (about 1.1 MB became about 235 KB on a first load); built files are cached for a year
  and the page itself is revalidated. Other tabs, panels and charts are separate chunks loaded in idle time, the page's data
  requests start before the app code finishes loading, the unused 300 font weight is gone, and only the first screenful of
  table rows animates. First paint went from about 4.2 s to about 0.3 s.
- **Instant data after a restart:** the last archive snapshot and bot / database results are kept in `backend/.cache` and served
  at once while the real scan refreshes in the background (previously 1-4 minutes of "warming up"). Restored results are
  refreshed soon if they are older than the Settings interval.
- **Faster checks:** bot check 61 s to about 20 s (one call per cloud service instead of one per instance); database storage
  and DTU are read side by side; the archive scan is split in two phases so the archive numbers publish in about 20 s while the
  slow bot-storage listing (~70 s) finishes in the background and merges in.
- **Server responsiveness:** `localhost` no longer waits about 2 s per connection for the IPv6 attempt to fail (listens on
  127.0.0.1 and ::1); bot-storage listing runs 4 accounts at a time so the server keeps answering during a scan.

### Added
- `perf.spec.ts` (page weight, compression, first paint, caching, tab switches, row animation) and `cache.test.ts`.

## 2026-10-21 · Security hardening (branch `Dev-Suyog`)

The older version of the dashboard is kept on the `Legacy-Monitoring-Version` branch (the state of `main` before this release).

### Security
- **Local only by default:** the server listens on `127.0.0.1` and answers only to `localhost` names (blocks DNS rebinding);
  `HOST` / `ALLOWED_HOSTS` opt in to sharing it.
- **No CORS** (the dashboard is served by the same process); **CSRF protection** on every POST (custom header, same-origin,
  no cross-site fetches); **rate limiting** (restart 3/min, checks 40/min, files 300/min, API 900/min).
- **Strict Content-Security-Policy** (no inline script; the theme preload moved to `/boot.js`), plus no-framing, no-sniffing,
  no-referrer and no-store headers on API answers; unknown file-like paths (e.g. source maps) return 404.
- Resource Graph queries escape configured values and validate name fragments; raw SDK errors are no longer logged.
- **Dependencies:** `npm audit` is at 0 for backend (was 1 critical + 7 moderate; `@azure/arm-resourcegraph` 5.x) and frontend; the
  unused `cors` package was removed.
- `SECURITY.md` (checklist: what applies to this tool and what does not), Dependabot config for weekly dependency updates.

### Added
- `security.test.ts` (backend) and `security.spec.ts` (browser, 16 tests): CORS, CSRF, Host guard, injection and traversal
  inputs, CSP, XSS rendering, source maps, secrets in responses and storage, rate limiting.

## 2026-10-21 · Side column on Cloud Instances and Databases (branch `Dev-Suyog`)

### Changed
- **Cloud Instances** and **Databases** now match Customers: the table / bot groups sit in the wide left column, and
  **Needs attention** plus **Instance health** / **Storage health** sit in a sticky, scrolling side column on the right
  (below about 1180px wide it drops under the table). Attention rows are one slim line each, with long names cut by an
  ellipsis and shown in full on hover; the mouse wheel still scrolls the page over the column.

### Added
- Tests for the side-by-side layout, the side column content, wheel scrolling and the filters on both tabs.

## 2026-10-21 · Last health check and metric numbers (branch `Dev-Suyog`)

### Fixed
- **"Last health check"** now shows when the data on screen was actually gathered (the newest of what the page fetched and
  the times the backend stamped on the results), so it moves on every refresh and also shows for data that was checked
  before the page was opened. The Customers tab uses the newest of archive, bots and databases; an older day shows its date.
- Large metric numbers (such as `1125/1132`) no longer run under the progress ring beside them in narrow cards.

### Added
- Tests that the time changes after refreshing Cloud Instances, Databases and Customers.

## 2026-10-21 · Same story on every tab (branch `Dev-Suyog`)

### Fixed
- **Customers vs Archive tab disagreement** (reported for CAC):
  - A customer that exists in two environments (CAC in UAT and PRD) is two rows on the Customers tab; both were labelled
    just "CAC". Every row, attention item and details title now carries an environment tag.
  - An account counts as Healthy when at least one capture folder has today's data, yet the row said "4/4 today" and the
    details panel showed an amber percentage next to a "Healthy" badge. Rows now add a `⚠ N folders empty` pill, the
    details tile reads `x/y folders`, and a note explains why the account is still Healthy.
  - While the backend re-scans after its 15-minute restart, the Customers tab showed "—", "0 accts" and "all archived".
    It now says the archive scan is warming up (banner, `scanning…` chips, "scanning archive…" on the metric card).
- Auto re-check: the archive and bot-storage scan is now a live re-scan on the Settings interval (it used to re-read the
  backend's cached copy), alongside the bot and database re-checks.

### Added
- `consistency.spec.ts`: end-to-end tests that compare every Customers row, the details panel and the Archive tab with
  what the backend reports, so the tabs cannot silently drift apart again.
- `refresh.spec.ts`: tests for the automatic re-check on the chosen interval.

## 2026-10-21 · New look, settings and end-to-end tests (branch `Dev-Suyog`)

### Added
- **New layout:** floating icon sidebar, a "Good morning, <name>!" header with a profile chip (the name comes from the
  signed-in Azure identity via the new `/api/me`), and card-based pages.
- **Settings panel** (⚙️): six themes (AMOLED, Calm, Aurora, Emerald, Light, Sunset), accent colour, density, reduce
  motion, greeting, sidebar mode (always show / on hover / hide, pushing the page instead of covering it), default tab,
  auto re-check interval, open charts automatically, alert sound, desktop notifications, keyboard shortcuts and account info.
- **Alert tunes:** nine synthesised tunes with a volume slider, previewed on selection.
- **Metrics strip, Needs attention list and health donut** on Customers, Cloud Instances and Databases; on Customers the
  attention list and Overall health sit in a scrolling side column beside the table.
- **Visual insights bar** (the whole bar is the button) opening full-width, sideways charts; slices, legend rows and bars
  filter the tab, and Overall health slices open the matching customers.
- **Customer details panel:** double-click a customer (or "open details", or an attention item) for archive, bot storage,
  bots with every instance and databases, with per-customer Check buttons and a switch between SRD accounts.
- **End-to-end UI tests** (`frontend/e2e`, Playwright using the installed Edge/Chrome): `npm run e2e`.

### Changed
- Alerts now cover every state other than Started (red for Stopped/Unresponsive, amber for the rest); a fresh browser
  treats what is already wrong as a quiet baseline instead of raising a flood of alerts.
- Tab and theme changes cross-fade (View Transitions); controls share one easing and give press and focus feedback;
  loading shows shimmer placeholders.
- Coverage chart and sparklines are smooth curves; chart text is larger and ring labels stay inside the ring.

### Fixed
- **Auto re-check** of bots and databases starts by itself and follows the interval chosen in Settings (it used to wait for
  a first manual check and stop for good after a failed run); the on-screen wording follows the interval.
- Settings (tune, theme) changed in one open tab now apply in other tabs.
- A closed sidebar no longer leaves a shadow on the screen edge or flashes on page load; the side column no longer traps the
  mouse wheel; a database attention item opens one server instead of every database with the same name.

## 2026-10-21 · Customer details side panel (branch `Dev-Suyog`)

### Added
- **Customers → open details** now opens a wide side panel (half the screen width) with a summary strip (archive %,
  bot storage, instances up, databases ok), the bot-storage status, the archive capture folders with latest files,
  and the customer's **Bots** (every instance, coloured by state) and **Databases (DSM)** (status, storage bar,
  DTU, latest backup, tier, issues), each with its own Check / Re-check button.

## 2026-10-21 · Notification panel wording

### Fixed
- The 🔔 panel's subtitle and empty-state text still said "Stopped or Unresponsive"; they now say an instance leaving
  the Started state, matching the alert rule.

## 2026-10-21 · Alerts for every non-Started state

### Changed
- **Alerts now cover every state other than Started** (Stopped, Unresponsive, Starting, Stopping, Aborted, Unknown, …),
  not only the red ones. A change from one non-Started state to another alerts again; returning to Started adds a
  "Recovered" entry. Red states get a red pop-up, yellow states an amber one; the tab badge still counts only red.
- Background alerts: the tab title blinks "(N down) …" and the desktop notification (if enabled) fires whenever the
  dashboard window is not focused, not only when the tab is hidden.

### Fixed
- **Alert tune:** the audio unlock stays registered, so any later click re-wakes an audio context the browser
  suspended, and the chime wakes a suspended context itself instead of failing silently.

## 2026-10-19 · Clickable charts, reliable auto re-check

### Added
- **Clickable charts** on all three tabs. Clicking a donut slice, legend row or coloured bar applies the same filter as
  the stat cards above, with a "Showing only…" bar and a way to clear it.
  - Cloud Instances: green = started, yellow = starting / other, red = stopped / unresponsive.
  - Databases: OK, Watch, Critical and N/A slices; storage bars filter to their level and red DTU bars to DTU over the
    limit. New **OK** filter pill.
  - Customers: archive, bot and database slices (and the "needing attention" segments) filter the customer table.

### Fixed
- **Auto re-check every 15 minutes** on Cloud Instances and Databases: a failed run (e.g. while the backend restarts)
  used to end the schedule for good. It now retries after a minute; any successful check starts the schedule, and a
  15-second watchdog keeps it working through laptop sleep and background-tab throttling.

## 2026-10-19 · Documentation

### Changed
- **README** rewritten for the four tabs and all current features: on-demand checks, shared search and Groups, alerts,
  Needs IP, charts, themes, Fullscreen, Restart backend, security model, configuration table, firewall helper scripts,
  API routes and repo layout.
- `backend/.env.example` updated with the bot-storage, database, speed and subscription settings.

## 2026-10-19 · On-demand charts

### Added
- **📊 Show charts** on the **Customers**, **Cloud Instances** and **Databases** tabs. The button is the only thing
  drawn until it is pressed, so the tabs stay light; opening it replays the animations.
  - Customers: donuts for archive-today, bot instances and databases, plus a stacked "needing attention" bar for the
    top 8 customers.
  - Cloud Instances: instance-state donut, a stacked bar per environment, and the 8 biggest bots.
  - Databases: storage-level donut, fullest databases (with the 75 % limit marked) and busiest DTU readings (with the
    90 % limit marked).
- Shared chart pieces (`Donut`, `HBars`, `StackBars`, `ChartsSection`): slices sweep in, bars grow from zero, centre
  numbers count up, hovering a slice or legend row highlights it.
- The charts follow the active filters (search, Groups, PROD/UAT/DEV and the stat-card filters).
- This changelog.

## 2026-10-19 · `6e8bcce` · Fullscreen

### Added
- **Fullscreen button** in the header (Esc to exit). Where a browser or embedded view blocks it, a hint says to press F11.

### Changed
- The normal view is unchanged (centred, 1640 px maximum). Only while in fullscreen, via the button **or F11**, the
  layout switches to edge to edge with a wider gutter.
- One `--gutter` value drives the page padding and the header's edge-to-edge bleed, so they always line up, also at
  phone width.
- F11 is detected from the window's outer size, so browser zoom cannot trigger the full-width layout by mistake.

## 2026-10-19 · `159727b` · Purple light theme, search inside a group

### Changed
- **Light theme** rebuilt after the "Purple" admin reference: white cards on a light lavender page, purple primary,
  gradient stat cards with soft translucent circles.
- Punchy status colours in light mode: a true red (no pink), vivid green, amber and blue; the "at risk" box is a solid
  red (green when nothing is at risk).
- **Search inside a group:** with a group or chips active, typing now narrows *within* it instead of adding to it. The
  dropdown separates **In this filter** (click to focus on one customer) from **Add to filter**; a trailing space
  (`nas `) means exactly that customer.

### Fixed
- Long card values such as `1078/1092` no longer clip; card numbers scale with the screen width.

## 2026-10-19 · `74adb9c` · Alerts, motion and pop-ups

### Added
- **Notifications:** a bell with an unread count and pop-up toasts when a bot instance newly goes **Stopped** or
  **Unresponsive**, a "recovered" note when it comes back, and optional desktop notifications.
- **Alert chime:** a soft, synthesised three-note tone (switchable, with a preview button). Browsers only allow sound
  after the first click on the page.
- **Animation:** animated Archive coverage chart and Health gauge (line draws itself, arc sweeps, counters count up,
  hover tooltip), staggered entry motion, and respect for "reduce motion".
- One glass **side-panel** style for every pop-up (notifications, restart confirmation, save group, needs-IP),
  replacing the browser's `confirm` / `prompt` boxes.
- Bots and databases **auto re-check every 15 minutes** once a first full check has been run.

### Changed
- Light theme first reworked as a muted "Slate Pearl" palette; AMOLED dark mode kept pure black.
- The public IP is re-read on every scan, so firewall errors quote the address Azure actually sees.

### Fixed
- The Groups menu and search suggestions are no longer hidden behind the stat cards (stacking order).
- Phone-width layout: the tab bar scrolls sideways and keeps the selected tab in view, the header is no longer sticky,
  and stat cards no longer clip.
- Alert pop-ups moved to the bottom right so they never cover header controls.

## 2026-10-19 · `d1451c5` · Initial upload

### Added
- **Archive monitoring:** for every `*srd01` storage account, whether today's `archive/{capture}/{date}` folder exists;
  grouped PROD / UAT / DEV, with an "at risk" count and the account drawer (latest chat and media files).
- **Customers tab:** one row per subscription showing archive, bots and databases side by side, with per-customer
  checks and expandable SRD accounts.
- **Cloud Instances tab:** bot (cloud service) role-instance states, grouped by customer and environment, with a
  per-group and per-bot check. Stopped / Unresponsive are red; Starting and other states are yellow.
- **Databases tab:** SQL status, latest long-term-retention backup, storage used vs. limit, and current DTU
  utilization (flagged above 90 %).
- **Bot storage check:** flags interactions left behind in the `audio-video` container (last 3 days, newest first).
- **On-demand design:** bot and database checks run only when asked (everything or one customer / bot / database),
  so start-up stays fast.
- **Shared search and Groups** across all tabs (exact customer matching: `adc`, `atd`, prefixes like `n*`), a
  PROD / UAT / DEV filter, and a "Needs IP" list of accounts blocked by their firewall.
- **Restart backend** button, a scheduled task that restarts the backend every 15 minutes, and the
  `add-ip-to-srd.ps1` / `add-ip-to-botstorage.ps1` helper scripts (preview, skip by number, report).
- Light and AMOLED dark themes.

## 2026-10-19 · `e8a4b82` · Initial commit
- Repository created.
