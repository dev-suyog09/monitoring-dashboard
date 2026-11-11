# Changelog

All notable changes to **Godzilla Health Monitor** (NTRX AppOps).
Newest first. Each entry is one push to `main`; the short hash lets you open the exact commit.
The format follows [Keep a Changelog](https://keepachangelog.com/).

## Unreleased · VPN-proof scans, hard restart, Archive details panel

### Added
- **Archive tab: double-click a row** opens the same full details panel as on Customers (archive today, bot storage, bots, databases and the
  on-demand **Concurrent calls** section). One click still opens the quick drawer (it now waits about 0.2 s so a double-click does not flash it).

### Fixed
- **A slow account no longer shows as an error.** An account that only timed out (e.g. one with many capture folders, under the load of a full
  scan) is tried once more with three times the time before it is called an error; firewall blocks are not retried.
- **Stale errors after a VPN drop.** A scan in which a quarter or more of the accounts fail is treated as a network problem: it is not saved,
  a restart never shows failures from an earlier scan, the scan is repeated every minute (up to 10 times) and accounts that could not be set up
  are set up again without a restart. The page shows a banner ("many locations could not be reached ... probably the VPN") instead of a wall of errors.
- **"Restart backend" is a hard reset.** The new process ignores its saved scan, and the bell entries, pop-ups and "red" memory of the
  alerts are cleared once it is back (what is wrong afterwards is a quiet new baseline, not a flood of new alerts).

## Unreleased · Archive scan no longer times out when DNS is slow

### Fixed
- **Every account showed "Timed out" when the network's DNS was slow.** Name lookups run on Node's 4-thread pool, so the ~200 storage
  names of a scan queued behind each other and each account hit its 15 s limit (102 lookups took 73 s). `start-appops.ps1` now starts
  the backend with `UV_THREADPOOL_SIZE=64` (the same lookups take about 4 s). Start the backend some other way and set it yourself.

## Unreleased · On shift / off shift switch for Teams reminders

### Added
- **On shift / Off shift switch** in the Checklist header: one click pauses every Teams reminder (and resumes them). It is the same
  setting as *Send reminders* in the Reminders panel, now one click away.

### Fixed
- Switching reminders back on no longer sends a reminder that came due while they were off (it used to, within the one-hour grace
  period); those are skipped and the next scheduled one arrives as normal.

## Unreleased · Restart that really restarts

### Fixed
- **A restart now runs the code on disk.** `start-appops.ps1 -Restart` (also what the 15-minute task runs) rebuilds the backend and the
  frontend first when their source is newer than the build; before, it started the old `dist` build, so edits only took effect after a manual
  `npm run build`. A failed build keeps the previous one and is logged in `backend/appops.build.log`.

### Added
- **`start-appops.ps1 -Fresh`**, a hard restart: as above, plus it ignores the saved scan (`FRESH_START=1`) and waits until the first real
  scan is done, so the page never shows old results. The scheduled task does not use it (it would show "warming up" every 15 minutes).

## Unreleased · Archive check also reads classic file shares

### Fixed
- **Archive check missed calls archived on a classic Azure file share.** It only looked in the blob container `archive`, so an
  account such as `fbpprdukssasrd01` (calls land in the `archive` file share, the blob container is empty) showed *No data*.
  Each account is now read in both places (`{capture}/{yyyy-mm-dd}/…`), the results are merged, and a capture folder shows a
  **file share** badge when it lives there. A missing container or share is not an error; if one place cannot be read
  (firewall, permissions) and the other has nothing for today, the account shows the error instead of a false "missing today".
- **Latest files** also works for file-share days (`HH_MM` time folders, newest 60 read; the totals are marked "at least" when the
  day is larger).

### Added
- `ARCHIVE_SHARE` setting (defaults to the container name; empty turns the file-share check off) and the
  `@azure/storage-file-share` dependency.
- `backend/src/archive-share.test.ts` (10 tests).

## Security review of the new features

### Fixed
- **Dependencies:** applied the compatible fixes for two high-severity advisories (`body-parser` denial of service, which started
  to matter once the checklist read request bodies, and an `msal-node` auth-code-flow issue this app does not use).
- **Rate limit** on `/api/calls/series` (40 a minute): it was only under the general limit, so a script could have made the
  backend query Application Insights hundreds of times a minute.
- **Oversized or malformed request bodies** now answer 413 / 400 instead of a generic 500.
- **CSV export** neutralises spreadsheet formulas in names that start with `=`, `+`, `-` or `@`.
- `SECURITY.md` documents the new endpoints, the Teams secret handling and the remaining risks.

## Unreleased · Side panels cover the sidebar

### Fixed
- **The sidebar was drawn on top of every side panel** (customer details, an Archive account, Settings, notifications) and of
  their dimmed backdrop, so with the bar on the right it covered the panel's content and its close button. Layers are now
  page, sidebar, dimmed backdrop and panels, then toasts, so a panel always covers the bar. Tests check, for each side, that the
  sidebar sits under the panel and that nothing is on top of the close button.

## Unreleased · Sidebar opening pushes the page on every side

### Fixed
- **Opening the sidebar (Hide / On hover) now slides the page away from it on every side.** With the bar on the right the page
  only narrowed from its right edge (cards and title stayed put), and with the bar at the bottom nothing moved at all, so the bar
  covered the content. The page now slides left for a right-hand bar, up for a bottom bar, down for a top bar and right for a
  left bar. A strip of the page at the far edge is pushed out of view while the bar is open, which is what a push-menu does.
- **Esc, or a click on the page, closes a bar opened with the menu button** (on the right the button itself slides out of view).
- Tests: 8 new cases check that the cards move away from the bar by about its thickness, never sit under it, and come back.

## Unreleased · Sidebar position

### Added
- **Settings → Navigation → Sidebar position:** put the sidebar on the **left** (default), **right**, **top** or **bottom** of the
  screen. Top and bottom turn it into a horizontal bar (logo, tabs with their labels beside the icons, Settings and the live dot);
  left and right keep the floating vertical card. It works with all three sidebar modes (always show, on hover, hide: the bar
  slides in from its own edge, and the hover strip sits on that edge), with every theme (the macOS window dots are dropped on a
  horizontal bar), and the change cross-fades. Phones (860 px and narrower) always keep the bottom bar. *Reset* puts it back on the left.
- Tests: `sidebar-side.spec.ts` covers every side in every mode.

## Unreleased · One-command setup for teammates

### Added
- **`setup.cmd` / `setup.ps1`:** one command sets up a new Windows PC the way it runs on the author's laptop: installs Node.js
  LTS and Azure CLI with winget if missing, signs in to Azure and checks which `*srd01` accounts the login can see, creates
  `backend\.env`, installs and builds the backend and frontend, runs the backend self-test, registers the silent *NTRX AppOps*
  scheduled task (logon / start-up, every 15 minutes, no console window), starts it, waits for it and opens the dashboard.
  Re-runnable; `-Update`, `-Uninstall`, `-NoBrowser`, `-SkipTests`, `-NoAutostart`, `-TenantId`, `-DryRun`.
- `.gitattributes` keeps `.cmd` / `.ps1` files on Windows line endings after a checkout.

- **No Node.js on the PC? No problem:** setup downloads a private Node.js 24 LTS for that user only (no administrator rights, no
  installer, nothing global; the download is verified against nodejs.org's published SHA-256 checksum) and the scheduled task
  uses it. Node.js older than 22.15 is treated the same way, because the launcher's `--use-system-ca` flag needs 22.15+.
  `-PrivateNode` forces it.

### Changed
- **The scheduled task no longer flashes a console window** every 15 minutes (it now starts PowerShell through
  `conhost --headless`); `install-autostart.ps1` registers it the same way.
- **Page-load weight:** the 3D pie, the Calls tab and the Checklist tab load only when used, rarely used panels load a few
  seconds after the page, and bot-storage answers list at most the latest 50 stuck interactions per account (the count stays
  exact), which took one customer's 1.3 MB answer down to a few kilobytes.

## Unreleased · Premium customer details panel

### Changed
- **The customer details panel is much wider and redesigned:** it now takes about 84% of the screen (it used half), with a
  gradient header and customer avatar, four headline cards (archive folders, bot storage, instances, databases) with icons and
  progress bars, and a two-column body (archive and bot storage on the left, bots and databases on the right) that falls back to
  one column on narrow screens. Softer rounded cards, plain-sentence headings and more spacing throughout.
- **Concurrent calls in the panel:** one clear "Not loaded" call-to-action, a segmented period picker, four stat cards (calls
  now, peak, busiest bot load, bots reporting), a smooth chart with a line per recording group, and a card per group with a bot
  table (the six busiest bots, "show all" for the rest).

### Fixed
- **Concurrent calls were slow (6 to 9 seconds per request).** Measured: the queries took under a second; the time went on a
  fresh Azure sign-in token (about 4 s) fetched on *every* request, because each request built a new credential. The backend now
  shares one credential, and remembers which bot Application Insights a customer has for 10 minutes. Requests now take about
  0.5 to 1 second; asking the same thing again within 30 seconds is instant. (Right after a backend restart, while it runs its
  start-up scan, the first call can still be slower.)
- The quick Concurrent calls trend no longer drops to zero at the right edge (the newest, still-filling time slot is left out),
  and it now averages each bot per time slot instead of adding up each bot's busiest moment, so *Peak* and *Calls now* agree.

## Unreleased · Concurrent Calls tab

### Added
- **Concurrent calls** tab in the sidebar: a full page for the bots' concurrent-call numbers, read from their Application
  Insights **only when you press Load** (opening the tab, picking customers or changing a control before the first Load reads
  nothing; after a Load, changing the metric, aggregation or range re-reads, and an optional live refresh can be switched on).
- **Settings like a metrics explorer:** customers (up to 4 at once), metric (concurrent calls, gross, stream load %, audio /
  video / screen-share / file streams, recorded participants, discarded calls, call-setup and join time, media in local
  storage), aggregation (Avg / Max / Min; Avg is the default because Max adds up each bot's busiest moment and overstates the
  total), time range (1 h, 6 h, 24 h, 3 d, 7 d) and split by (none, recording group, bot instance).
- **Filters on what is loaded** (no new request): switch recording groups on or off, bot-name search, only bots that reported in
  the last 10 minutes, hide bots with no activity.
- **Calm, easy-on-the-eyes design:** soft rounded cards, quiet dotted grid, thin smooth curves in muted colours, plain-sentence
  headings with a short description under each, generous spacing, and a big "now" number. A **What stands out** card says in
  words what the numbers mean (rising or falling against 30 minutes ago, the busiest moment and how far above average, which
  recording group carries the load, whether any bot has gone quiet). The chart marks the peak and draws the average as a dashed
  line; the heatmap has a colour scale.
- **Polished charts:** headline numbers (now, peak and when, average, lowest, bots reporting, last reading), a time-series chart
  with a hover guide, tooltip and clickable legend, recording-group and busiest-bot bars (click to focus), a heatmap of every
  bot over time, a sortable bot table with trend lines and a quiet-bot warning, and **CSV export**.
- *Full view ↗* in a customer's details panel opens this tab with that customer chosen (still needs Load).
- Backend: `POST /api/calls/series` (subscription, range, metric key and aggregation are validated against allow-lists; the
  metric name in the query comes from a fixed catalogue; 30 s answer cache).

## Unreleased · "Archive missing" card on the Customers tab

### Added
- **Archive missing** card next to *Archive complete* on the Customers tab: the number of customers that are not fully
  archived today (some SRD account has nothing archived, or could not be read), with how many of them have errors. Click it to
  list just those customers; click again to clear. *Archive complete* + *Archive missing* = customers with an SRD account.

## Unreleased · Concurrent calls per bot (on demand)

### Added
- **Concurrent calls** section in the customer details panel (Customers tab → open details). Press **Check concurrent calls**
  to read, live from the bots' own Application Insights, how many calls each recording group handles at the same time:
  calls now, peak (the busiest moment of the whole group), stream load %, a trend line, and one row per bot instance with its
  last reading time (a bot that has gone quiet for 10+ minutes is flagged). Pick the last hour, 6 hours or 24 hours.
  Meant for the case where a call is missing from the archive and you want to see whether the bot was busy or silent.
- **On demand only:** nothing is requested when the dashboard starts, when a panel opens or on the auto re-check timer. The
  backend endpoint `POST /api/calls/check` takes one subscription (= one customer) and a period, validates both, keeps the
  answer for 30 s, and reads only the `botAppInsights*` resources of that subscription (read-only).

## Unreleased · Archive: environment filter now combines with the status cards

### Fixed
- **Archive tab: "PROD" then "Missing today" also listed UAT accounts.** The environment pills (PROD / UAT / DEV) and the status
  cards (Healthy / Missing today / Errors / No SRD) shared one filter, so choosing a card dropped the environment. They are now
  separate and apply together: PROD + Missing today lists and counts only PROD accounts that are missing, and the PROD pill
  stays selected. *Clear filter* resets both. A browser test (`infra-tabs.spec.ts`) covers it.

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
- **Task-app layout for the Checklist tab:** a menu on the left (All checks / Still to check / Checked, then each list with a
  colour and its remaining count, search, and Reminders), the customers to check in the middle (tick, or click a row), and on the
  right either that customer's details (list, status, *Open in Customers*, *Mark as checked*) or the reminder settings. It
  collapses to one column on phones.
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
