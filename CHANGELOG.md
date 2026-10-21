# Changelog

All notable changes to **NTR-X Azure Dashboard** (NTRX AppOps).
Newest first. Each entry is one push to `main`; the short hash lets you open the exact commit.
The format follows [Keep a Changelog](https://keepachangelog.com/).

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
