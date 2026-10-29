# NTRX AppOps — SRD Archive Monitor — Setup Guide

A dashboard that checks, for every `*srd01` storage account across your Azure
subscriptions, whether **today's archive date-folder** exists
(`archive/{capture}/{YYYY-MM-DD}/`). It groups locations by **PROD / UAT / DEV**,
flags **PRD at risk**, and shows a **No SRD** category for locations with no
archive container.

It reads each account's key **at runtime via your Azure login** — the same thing
the Azure Portal does — so **no secrets are stored on disk** and **no data-plane
RBAC role is required**.

> **Fastest way (Windows):** clone the repository and run **`.\setup.cmd`**. It does steps 1 to 4 below for you (prerequisites,
> Azure sign-in, build, silent scheduled task, start). If Node.js is missing it downloads a private copy for your user only. The manual steps stay here for other systems and for understanding what it does.

---

## 1. Prerequisites

| Requirement | Why | Check |
|---|---|---|
| **Node.js 22.15+** (tested on 24 LTS) | Runs backend + frontend (the launcher uses `--use-system-ca`, which older versions lack) | `node --version` |
| **npm 9+** (ships with Node) | Installs dependencies | `npm --version` |
| **Azure CLI** | Provides the login the app authenticates with | `az --version` |
| **An Azure account** with management access (Owner/Contributor) to the target subscriptions | Lets the app list accounts and read their keys | `az account show` |

### Installing Node.js

- **Windows:** `winget install OpenJS.NodeJS.LTS`
  *(then open a NEW terminal so `node`/`npm` are on PATH)*
- **macOS:** `brew install node` (or `nvm install --lts`)
- **Linux:** `nvm install --lts` (recommended) or your distro's package manager

### Installing Azure CLI

- **Windows:** `winget install Microsoft.AzureCLI`
- **macOS:** `brew install azure-cli`
- **Linux:** `curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash` (Debian/Ubuntu)

---

## 2. One-time login to Azure

```bash
az login
```

A browser opens; sign in with the account that can see the subscriptions.
Verify it worked:

```bash
az account show
```

> The app uses this session automatically (`AzureCliCredential`). No secrets,
> tenant IDs, or keys need to go into any file.

---

## 3. Get the code

Copy the `srd-archive-monitor` folder to the machine (git clone, zip, or copy).
Its layout:

```
srd-archive-monitor/
├── backend/     # TypeScript API (Express) — discovers accounts, checks archives
├── frontend/    # React + Vite dashboard
├── README.md
└── SETUP.md     # this file
```

---

## 4. Backend setup

Open a terminal in `srd-archive-monitor/backend`.

```bash
cd srd-archive-monitor/backend

# 1. create your config from the template
cp .env.example .env        # macOS/Linux
copy .env.example .env      # Windows (cmd/powershell)

# 2. install dependencies
npm install

# 3. run it
npm run dev                 # starts on http://localhost:3001
```

The default `.env` is already set to **auto-discover** every `*srd01` account:

```ini
PORT=3001
ARCHIVE_CONTAINER=archive
CHECK_TIMEOUT_MS=15000

# Auto-discover all "*srd01" accounts your login can see (keys read at runtime)
STORAGE_DISCOVER=true
DISCOVER_SUFFIX=srd01

# Optional: restrict discovery to specific subscription IDs (comma-separated)
# SUBSCRIPTIONS=

# In a deployment (no interactive login), use a managed identity instead:
# USE_MANAGED_IDENTITY=true
```

> **First start takes ~1 minute** — it discovers ~96 accounts and fetches each
> key. After that it scans on a background timer and serves the UI instantly.

When it's ready you'll see:

```
SRD archive monitor API on http://localhost:3001
Public egress IP: <your-ip>
Discovered N account(s) for container "archive" (N runtime-key); scanning every 60s
```

### Backend commands

| Command | What it does |
|---|---|
| `npm run dev` | Run with auto-reload (development) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled build (`node dist/server.js`) — for production |
| `npm run typecheck` | Type-check without emitting |
| `npm test` | Run the pure-logic unit tests (no Azure needed) |

---

## 5. Frontend setup

Open a **second terminal** in `srd-archive-monitor/frontend`.

```bash
cd srd-archive-monitor/frontend

npm install
npm run dev                 # opens http://localhost:3000
```

Then open **http://localhost:3000** in a browser.

The frontend proxies `/api/*` to the backend on port 3001 (configured in
`vite.config.ts`), so both must be running.

### Frontend commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload (port 3000) |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | Type-check only |

---

## 6. Quick start (copy-paste)

**Terminal 1 — backend**
```bash
az login
cd srd-archive-monitor/backend
cp .env.example .env
npm install
npm run dev
```

**Terminal 2 — frontend**
```bash
cd srd-archive-monitor/frontend
npm install
npm run dev
```

Open **http://localhost:3000**.

---

## 7. Using the dashboard

- **Category pills:** All / Healthy / Missing / Errors / No SRD / PROD / UAT / DEV.
- **Search box:** type any part of an account name (e.g. `db`) — matches that
  **start with** it rank first, then matches that **contain** it.
- **Click any card** → a side drawer shows that location's capture folders and
  recent dates.
- **Theme:** sun/moon toggle (light/dark); the choice is remembered.
- **Refresh:** manual refresh button; the page also auto-refreshes.

---

## 8. Configuration reference (`backend/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | Backend port |
| `ARCHIVE_CONTAINER` | `archive` | Container name checked on each account |
| `CHECK_TIMEOUT_MS` | `15000` | Max time per account before it's marked errored |
| `STORAGE_DISCOVER` | `true` | Auto-discover accounts by name suffix |
| `DISCOVER_SUFFIX` | `srd01` | Suffix to match when discovering |
| `SUBSCRIPTIONS` | *(all)* | Comma-separated subscription IDs to limit discovery |
| `REFRESH_MS` | `60000` | Background re-scan interval (ms) |
| `USE_MANAGED_IDENTITY` | *(unset)* | `true` = use the app's managed identity instead of `az login` |
| `STORAGE_ACCOUNTS` | *(empty)* | Explicit account names instead of discovery (comma-separated) |
| `STORAGE_CONN_1..N` | *(empty)* | Connection-string fallback (contains keys; discouraged) |

---

## 9. Production / deployment notes

- **Run it inside Azure** (Container App, App Service, or a VM in the VNet) and
  set `USE_MANAGED_IDENTITY=true`. Assign the identity management read + the
  ability to list keys on the target subscriptions. No `az login` needed.
- **Build for production:**
  ```bash
  cd backend && npm run build && npm start
  cd frontend && npm run build      # serve dist/ from any static host / reverse proxy
  ```
- Keep `.env` out of source control — it's already covered by `.gitignore`.

---

## 9b. Run automatically at logon (Windows) — single-process mode

For always-on use, the backend can **serve the built frontend too**, so one
`node` process hosts both the API and the UI on **http://localhost:3001** (no dev
servers, no port 3000).

**Build once:**
```powershell
cd srd-archive-monitor\frontend ; npm run build
cd ..\backend ; npm run build
```

**Launcher:** [`start-appops.ps1`](./start-appops.ps1) (in the project root) starts
`node dist/server.js` hidden, adds Node + Azure CLI to PATH, and skips if it's
already running.

**Registered task:** a Scheduled Task named **"NTRX AppOps"** runs the launcher
at every logon. It was created with:

```powershell
$launcher = "C:\Users\suyogku\Downloads\health-check\srd-archive-monitor\start-appops.ps1"
$action  = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName "NTRX AppOps" -Action $action -Trigger $trigger -Settings $settings -Force
```

**Manage it:**
| Action | Command |
|---|---|
| Start now | `Start-ScheduledTask -TaskName "NTRX AppOps"` |
| Stop the app | `Get-CimInstance Win32_Process -Filter "Name='node.exe'" \| ? { $_.CommandLine -match 'dist\\server\.js' } \| % { Stop-Process -Id $_.ProcessId -Force }` |
| Disable autostart | `Disable-ScheduledTask -TaskName "NTRX AppOps"` |
| Remove autostart | `Unregister-ScheduledTask -TaskName "NTRX AppOps" -Confirm:$false` |
| View it | `Get-ScheduledTask -TaskName "NTRX AppOps"` |

> After changing code, re-run the two `npm run build` commands so the autostart
> picks up the new version. Keep your `az login` session valid — if it expires,
> the app shows auth errors until you run `az login` again.

Open **http://localhost:3001** after logon.

---

## 10. Troubleshooting

| Symptom | Cause / Fix |
|---|---|
| `node`/`npm` "not recognized" | Node not installed or terminal opened before install — open a new terminal, re-check `node --version`. |
| Cards show **"Blocked by the storage account's firewall — IP … isn't allowlisted"** | The storage account's firewall doesn't allow this machine's IP. **Run the monitor on the corporate VPN or inside Azure** (recommended), or have an admin add the shown IP under the account's Networking settings. |
| Cards show **"Signed in, but no data access … Storage Blob Data Reader"** | Rare — only when using pure keyless mode without the data role. Default runtime-key mode avoids this. |
| **"No 'archive' container"** → shows as **No SRD** | Expected: that account has no archive container yet. |
| Page says **"Warming up"** for ~1 min | Normal on first start (discovering + fetching ~96 keys). It fills in and stays fast after. |
| Frontend loads but shows **"make sure the backend is running"** | Backend (port 3001) isn't up, or `az login` expired — restart the backend / re-run `az login`. |
| Startup is slow | Expected with many accounts (one-time key fetch). Narrow scope with `SUBSCRIPTIONS=` if you only need some. |

---

## 11. How it works (one paragraph)

On start the backend uses your Azure login to run a Resource Graph query for
every `*srd01` storage account, reads each account key at runtime via the
management API (`listKeys`), and lists `archive/{capture}/{date}/` on each. It
caches the result and re-scans every 60s, so the UI is always fast. The frontend
(React + Vite) renders the cached snapshot, categorizes by name (PROD/UAT/DEV),
and lets you search and drill into any location.
```
