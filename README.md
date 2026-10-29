# monitoring-dashboard
This is a professional proactive monitoring Dashboard by X-Factors

See [CHANGELOG.md](./CHANGELOG.md) for what changed in each release.

---

# Godzilla Health Monitor (NTRX AppOps)

One dashboard for the health of every customer deployment across your Azure subscriptions:

- **Archive:** has today's archive folder been written on each SRD storage account?
- **Cloud Instances:** are the bot (cloud service) role instances running?
- **Databases:** is each SQL database online, backed up, and within its storage and DTU limits?
- **Bot storage:** is anything left stuck in a bot storage account?

Everything is read with your own `az login` identity. Nothing is stored on disk.

## The four tabs

| Tab | What it shows |
|---|---|
| **Customers** | One row per subscription (customer): archive status (`1/1 today`), bots (`114/114 up`), databases (`3/3 db ok`), the last-checked time, and a **▸ check** / click-to-re-check on the bots and database cells. Click a row to list its SRD accounts. |
| **Archive** | Every `*srd01` storage account. Stat cards (Accounts, Healthy, Missing today, Errors, No SRD), a 7-day coverage chart, a **Health today** gauge, a **PRD at risk** box that jumps to the at-risk accounts, and the account table. Click an account for its drawer (capture folders, latest files, bot-storage leftovers). |
| **Cloud Instances** | Bot role-instance states grouped by customer and environment (`DB · PRD — 316/316`), expandable to each bot and instance, plus a table of everything that is not started. The stat cards filter the whole tab. |
| **Databases** | Status, latest long-term-retention backup, storage used vs. limit, and current DTU utilization. The cards and filter buttons narrow to critical storage, watch, DTU above the limit, no backup, offline, or not checked. |

Archive status meanings:

| Status | Meaning |
|---|---|
| **Healthy** | At least one capture folder has today's date folder |
| **Missing Today** | Capture folders exist, but none has today's folder |
| **No Data** | No capture folders at all |
| **Error** | Couldn't read the account (firewall, auth, network) |

Instance states: **Started** is green; **Stopped** and **Unresponsive** are red (only these count on the tab badge and raise alerts); **Starting** and any other state (Aborted, Unknown, Created…) are yellow.
Database thresholds: storage **watch above 60 %** and **critical above 75 %** (fixed); DTU **above 90 %** (`DTU_THRESHOLD`; the latest one-minute reading, DTU-model databases only).

## Features

- **Concurrent Calls tab (on demand):** a full page of charts, filters and a bot table for the bots' concurrent calls, read from their Application Insights only when you press *Load* (nothing is loaded at start-up). A quick version also lives in each customer's details panel. See the changelog.
- **Daily checklist + Teams reminders:** saved groups (e.g. *Daily HC*) become a checklist to tick off each day; unticked members are sent to you in a Teams chat at 12 AM, 3 AM and 6 AM (editable). Connect it on the Checklist tab with a Teams *Workflows* webhook address (no server settings needed). The computer running the backend must be on at those times. Reminder times can be filled in with *Every N hours*, and *Keep reminding until everything is ticked* repeats them. Email reminders exist in the code (SMTP settings in `.env.example`) but are hidden for now.

- **Flat or 3D charts:** charts are flat by default; turn on *3D charts* in Settings (or the 3D chip on the Visual insights bar) for an exploded 3D pie with labelled callouts, raised bars and a ribbon line.

**Bots and databases are on demand.** Nothing is scanned at start-up. Opening a tab lists the inventory (cheap); the real checks run when you press **Check all**, a per-customer / per-bot / per-database **Check**, or click a result chip. After the first full check, the tab re-checks everything automatically **every 15 minutes while the page is open**.

**Shared search and Groups** (same on every tab)
- Customers are matched by their code, not by substring: `adc` is ADC only; `db` does not pull in `dbs`.
- Type a letter and the page filters live to every customer starting with it; a dropdown lists matches.
- With chips or a group active, typing **narrows within them**. The dropdown separates *In this filter* (click to focus on one; a trailing space, `nas `, means exactly that customer) from *Add to filter*.
- **★ Save group** stores a named set of customers; **Groups** recalls it.
- A **PROD / UAT / DEV** filter applies on top (DEV includes TST).

**Alerts.** A bell with an unread count and a pop-up toast appear when a bot instance newly goes Stopped or Unresponsive; recoveries are noted. A soft chime plays (switchable, with a preview) and optional desktop notifications work while the tab is in the background. Browsers allow sound only after the first click on the page.

**Needs IP.** Lists, as comma-separated copyable text, the SRD accounts and bot storage accounts blocked by their firewall, ready to paste into the helper scripts below.

**On-demand charts.** On Customers, Cloud Instances and Databases, **📊 Show charts** reveals animated donuts and bars (archive, instances, storage levels, fullest databases, busiest DTU…). They follow the active filters and are drawn only when asked.

**Look and feel.** Light theme (white cards on lavender, gradient stat cards) and a true-black AMOLED dark theme, animated charts and counters (respects "reduce motion"), glass side-panels for all pop-ups, responsive down to phone width, and a **Fullscreen** button. The normal layout is a centred column; in fullscreen (button or F11) it switches to edge to edge.

**Restart backend.** A header button restarts the whole backend (it re-runs the `NTRX AppOps` scheduled task). Bot and database results start empty again afterwards.

## Security model

- **No secret stored on disk (default).** The app discovers accounts and, at start-up, reads each account's key at runtime with your identity's management-plane `listKeys` call: the same thing the Azure Portal does for "Access key". Keys live only in memory.
- **No data-plane RBAC role required** for the storage checks; management access (Owner / Contributor) is enough.
- **Identity:** locally your `az login` session; in a deployment set `USE_MANAGED_IDENTITY=true`.
- **Nothing sensitive in the repo.** `.env` is gitignored; only `.env.example` is tracked.
- `STORAGE_CONN_1..N` connection strings still work as a fallback but store keys on disk — discouraged.
- **Local only by default:** the server listens on `127.0.0.1`, answers only to `localhost` names (blocks DNS rebinding), sends **no CORS** headers, requires a CSRF header on every POST, rate-limits the API and sends a strict Content-Security-Policy. See [SECURITY.md](SECURITY.md) for the full checklist, what applies to this tool and what does not.
- The restart endpoint is POST-only, CSRF-protected, limited to 3 per minute and only accepts requests from the local dashboard.

> If a key rotates, restart the backend so it re-reads the new key.

## Prerequisites

- Node.js 18+ and npm
- Azure CLI, logged in: `az login`
- Read access to the subscriptions (Resource Graph, Azure Monitor metrics, SQL long-term-retention backups, Cloud Services) and permission to list storage account keys. Owner or Contributor covers all of it.
- Network access to the storage accounts: their firewalls must allow the machine's public IP (see *Firewall and your IP*).

## Run it

Development (two terminals):

```powershell
# Backend
cd backend
copy .env.example .env      # then review it
npm install
npm run dev                 # http://localhost:3001

# Frontend
cd frontend
npm install
npm run dev                 # http://localhost:3000
```

Always-on on Windows: **one process** serves both the API and the built UI on http://localhost:3001.

```powershell
powershell -ExecutionPolicy Bypass -File .\install-autostart.ps1
```

This builds the frontend and backend and registers a scheduled task named **NTRX AppOps**: it runs at start-up and at logon and repeats every 15 minutes. Each run (`start-appops.ps1 -Restart`) replaces the backend with a fresh process, so keys, the public IP and errors are re-read. It runs as you and needs your `az login` session. After changing code, rebuild (`npm run build` in `backend` and `frontend`) and run the task again.

## Configure (`backend/.env`)

All values are optional except how to find accounts (`STORAGE_DISCOVER` or `STORAGE_ACCOUNTS`).

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | Backend / UI port |
| `ARCHIVE_CONTAINER` | `archive` | Container checked on each SRD account |
| `CHECK_TIMEOUT_MS` | `15000` | Per-account timeout before it is marked errored |
| `STORAGE_DISCOVER` | `false` (`true` in `.env.example`) | Auto-discover accounts by name suffix |
| `DISCOVER_SUFFIX` | `srd01` | Suffix to match when discovering |
| `SUBSCRIPTIONS` | all you can see | Comma-separated subscription IDs to limit every query |
| `STORAGE_ACCOUNTS` | – | Explicit account names instead of discovery |
| `STORAGE_CONN_1..N` | – | Connection-string fallback (contains keys) |
| `USE_MANAGED_IDENTITY` | – | `true` = managed identity instead of `az login` |
| `REFRESH_MS` | `60000` | Background archive re-scan interval (the launcher sets `900000`) |
| `SCAN_CONCURRENCY` | `20` | Accounts scanned in parallel (the archive phase) |
| `BOT_CONCURRENCY` | `4` | Bot-storage accounts listed at once in the background phase (kept low so the server stays responsive) |
| `CACHE_DIR` | `backend/.cache` | Where the last results are kept so a restart shows them instantly |
| `KEY_CONCURRENCY` | `32` | Account keys fetched in parallel at start-up |
| `INFRA_CONCURRENCY` | `40` | Parallel Azure calls for bot / database checks |
| `BOT_CONTAINER` | `audio-video` | Container checked in bot storage |
| `BOT_ACCOUNT_PREFIX` | `botstorage` | Bot storage account name prefix (empty disables the check) |
| `BOT_STUCK_MINUTES` | `60` | An interaction untouched this long counts as stuck |
| `BOT_WINDOW_DAYS` | `3` | Only stuck interactions from the last N days are listed |
| `BOT_TIMEOUT_MS` | `60000` | Time allowed per bot storage account |
| `DTU_THRESHOLD` | `90` | DTU % above which a database is flagged |
| `DTU_LOOKBACK_MINUTES` | `15` | How far back to find the latest DTU reading |
| `FILES_CACHE_MS` / `FILES_TIMEOUT_MS` | `120000` / `60000` | Latest-files listing cache and timeout |
| `RESTART_TASK` | `NTRX AppOps` | Scheduled task the Restart button runs |
| `CHECK_DATE` | – | `YYYY-MM-DD` to test against a historical day |

## Firewall and your IP

Most storage accounts only allow listed public IPs, and your IP changes with the network or VPN. A blocked account shows *"Blocked by the storage account's firewall"* with the IP Azure actually sees (re-read on every scan). The **Needs IP** panel gives you the lists; two scripts then add the IP:

```powershell
powershell -ExecutionPolicy Bypass -File .\add-ip-to-srd.ps1          # SRD storage accounts
powershell -ExecutionPolicy Bypass -File .\add-ip-to-botstorage.ps1   # the matching bot storage accounts
```

Both ask for account names (one, or comma-separated) and your IP (Enter accepts the detected one), then show a **preview** of what happens on **Y**, let you **skip accounts by number**, and finish with a report (added / already present / ignored / not found / failed). They only append one IP to an existing allow list: they never open an account to all networks, change public access, or remove rules, and they skip private-endpoint-only accounts (private endpoints and no IP rules). Use `-DryRun` to preview only, `-Skip 4,7` and `-Yes` for non-interactive runs. Needs write access on the accounts.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Liveness, account count, process start time |
| `GET /api/check` | Cached archive scan (`?fresh=1` forces a live re-scan) |
| `GET /api/files?account=&capture=&date=` | Latest 5 chat + 5 media files in `archive/{capture}/{date}/` (cached 2 min; `?fresh=1` bypasses) |
| `GET /api/bots` | Cloud service inventory plus whatever has been checked |
| `POST /api/bots/check` | Check bots: no params = all; `customer=&env=` one customer; `service=` one bot; `subscriptionId=` one subscription |
| `GET /api/databases` | Database inventory plus whatever has been checked |
| `POST /api/databases/check` | Check databases: no params = all; `server=`, `server=&db=`, or `subscriptionId=` |
| `POST /api/restart` | Restart the backend via the scheduled task (Windows, local dashboard only) |

## Performance

What was measured (this machine, real Azure data) and what changed:

| | Before | After |
|---|---|---|
| First page load: bytes sent | 1,118 KB | **~235 KB** (Brotli/gzip compression) |
| Page visible (first paint / customers table) | 4.2 s / 4.2 s | **0.3 s / 0.5 s** |
| Repeat visit | files re-checked every time | hashed files cached for a year, no download |
| After a backend restart (scheduled every 15 min) | no data for 1-4 min | **data in ~6 s** (last results are kept on disk and refreshed in the background) |
| Check all bots | 61 s (about 1,300 Azure calls) | **~20 s** (about 160 calls: one `$expand=instanceView` per cloud service) |
| Check all databases | 42 s | ~37 s (storage and DTU read side by side) |
| Archive refresh (the button) | 57-109 s | **~20 s** (the slow bot-storage listing now runs in the background and merges in afterwards) |
| `localhost` request latency | ~2 s per connection (IPv6 fallback) | **~3 ms** (listens on both loopback addresses) |

How it stays fast: other tabs, panels and charts are separate chunks fetched when the browser is idle; the page's data requests start
before the app code has finished loading; only the first screenful of table rows animates. `npm run e2e` includes
`perf.spec.ts`, which fails if the page gets heavier or slower than agreed budgets.

## Latest files per folder

Opening an account's drawer lists, for each capture folder, the newest 5 **chat** files (`.chat`) and the newest 5 **media** files (`.mp3`, plus other audio/video) in today's date folder (or the newest folder if today is missing). `.json` metadata files are only counted. A day folder can hold ~25k blobs and Azure lists only in name order, so the backend runs 16 parallel listings by the leading hex digit of the GUID file name and keeps the newest N by last-modified.

## Tests

```powershell
cd backend
npm test            # pure-logic unit tests (no Azure needed)
npm run typecheck
cd ../frontend
npm run typecheck
```

### End-to-end UI tests

63 browser tests drive the real dashboard (every tab, filters, search and groups, the details panel, charts, settings and
themes, the sidebar modes, alerts with their tune, phone and tablet layouts). They run against the **running** backend,
in the Edge or Chrome you already have installed (nothing to download):

```powershell
cd frontend
npm run build         # the backend serves frontend/dist
npm run e2e           # headless; E2E_BROWSER=chrome to use Chrome, E2E_URL=http://host:3001 for another address
npm run e2e:headed    # watch the browser work
npm run e2e:report    # open the HTML report (it also holds a screenshot of every theme on every tab)
```

Alert tests fake instance states through the browser, so nothing in Azure is touched and the Restart backend button is
never really pressed.

## Layout

```
backend/src/
  config.ts       # env parsing
  azure.ts        # discovery, subscription names, runtime keys, bot-storage matching
  checker.ts      # archive check + friendly error mapping
  bot.ts          # bot storage: interactions stuck in audio-video
  infra.ts        # on-demand bot-instance and database checks (Resource Graph + ARM REST)
  files.ts        # latest chat/media files in a date folder
  server.ts       # Express API (also serves the built UI)
  types.ts, checker.test.ts
frontend/src/
  App.tsx         # header, tabs, shared search, filters, fullscreen, alerts wiring
  components/     # CustomersView, AccountTable, BotsView, BotGroups, DatabasesView, DetailDrawer,
                  # WatchlistSearch, Notifications, SidePanel, NeedsIpPanel, panels, charts, viewCharts
  lib/            # api client, matching (watchMatch), on-demand hook, alerts + chime, fullscreen,
                  # customer / bot grouping, count-up and theme helpers
install-autostart.ps1   # one-time build + scheduled-task registration
start-appops.ps1        # launcher the task runs (-Restart replaces the running backend)
add-ip-to-srd.ps1, add-ip-to-botstorage.ps1
CHANGELOG.md
```

`SETUP.md` is the original step-by-step setup walkthrough; where it differs from this file, this file is current.
