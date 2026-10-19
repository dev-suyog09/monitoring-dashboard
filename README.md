# monitoring-dashboard
This is a professional proactive monitoring Dashboard by X-Factors

---

# SRD Archive Monitor

A focused dashboard that answers one question per SRD storage account:

> **Has today's date folder been created under the `archive/` container?**

For each account it walks `archive/{capture}/{YYYY-MM-DD}/` and reports:

| Status | Meaning |
|---|---|
| **Healthy** | At least one capture folder has today's date folder |
| **Missing Today** | Capture folders exist, but none has today's folder |
| **No Data** | No capture folders at all |
| **Error** | Couldn't read the account (auth / network / missing container) |

## Security model

- **No secret stored on disk (default).** You list account *names* in
  `STORAGE_ACCOUNTS`. At startup the app reads each account's key at runtime via
  your identity's management-plane `listKeys` call — the same thing the Azure
  Portal does when it shows blobs via "Access key". The key lives only in memory.
- **No data-plane RBAC role required.** Because it uses management access (which
  Owner/Contributor already have) rather than Entra data access, you don't need
  `Storage Blob Data Reader` granted on each account.
- **Identity:** locally it's your `az login` session; in a deployment set
  `USE_MANAGED_IDENTITY=true` to use the app's managed identity.
- **No secrets in the repo.** `.env` is gitignored; only `.env.example` is tracked.
- Connection strings (`STORAGE_CONN_1..N`) still work as a fallback but store
  keys on disk — discouraged.

> If a key rotates, restart the backend so it re-reads the new key.

## Prerequisites

- Node.js 18+
- Azure CLI, logged in: `az login`
- Storage Blob Data Reader on the target accounts (for keyless mode)

## Run it

```powershell
# Backend
cd backend
copy .env.example .env      # then set STORAGE_ACCOUNTS
npm install
npm run dev                 # http://localhost:3001

# Frontend (second terminal)
cd frontend
npm install
npm run dev                 # http://localhost:3000
```

## Configure (`backend/.env`)

```
PORT=3001
ARCHIVE_CONTAINER=archive

# Keyless (preferred): comma-separated account names
STORAGE_ACCOUNTS=mseprdukssasrd01,tsiprduse2sasrd01,enxprdfrcsasrd01

# Fallback only (contains keys):
# STORAGE_CONN_1=DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...
```

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Liveness + how many accounts are configured |
| `GET /api/check` | Cached result of the latest background scan (`?fresh=1` forces a live re-scan) |
| `GET /api/files?account=&capture=&date=` | Latest 5 chat + 5 media files inside `archive/{capture}/{date}/` (date defaults to today; `?fresh=1` bypasses the 2-minute cache) |

## Latest files per folder

Opening an account in the detail drawer lists, for each capture folder, the
newest 5 **chat** files (`.chat`) and the newest 5 **media** files (`.mp3`, plus
other audio/video) in today's date folder. The sibling `.json` files are
metadata and are only counted, not listed (or the newest folder if
today is missing). A day folder can hold ~25k blobs and Azure only lists in name
order, so the backend fans out 16 parallel listings by leading hex digit of the
GUID file name, then keeps the newest N by last-modified. Results are cached for
`FILES_CACHE_MS` (default 120000) and bounded by `FILES_TIMEOUT_MS` (default 60000).

## Tests

```powershell
cd backend
npm test        # unit tests for the pure check logic (no Azure needed)
```

## Layout

```
backend/
  src/
    config.ts     # env parsing (accounts, container, port)
    azure.ts      # builds clients (identity preferred, conn-string fallback)
    checker.ts    # pure today-folder logic + friendly error mapping
    files.ts      # latest chat/media files inside a date folder
    server.ts     # Express API
    checker.test.ts
frontend/
  src/
    App.tsx           # header, filters, auto-refresh, theme
    components/       # SummaryBar, AccountCard, Badges
    lib/              # api client + status/env styling helpers
```
