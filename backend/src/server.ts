import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { loadConfig } from './config.js';
import { buildAccountClients } from './azure.js';
import { checkAccount, todayStr, setEgressIp, friendlyError } from './checker.js';
import { listLatestFiles } from './files.js';
import { InfraStore } from './infra.js';
import type { AccountClient, CheckResponse, FilesResponse } from './types.js';

const cfg = loadConfig();
const REFRESH_MS = Number(process.env.REFRESH_MS ?? 60_000);
const SCAN_CONCURRENCY = Math.max(1, Number(process.env.SCAN_CONCURRENCY ?? 10));
/** How long a per-folder file listing is served from cache before re-listing. */
const FILES_CACHE_MS = Number(process.env.FILES_CACHE_MS ?? 120_000);
/** Listing a whole day folder fans out 16 requests; give it more room than a scan. */
const FILES_TIMEOUT_MS = Number(process.env.FILES_TIMEOUT_MS ?? 60_000);

/** Run fn over items with bounded concurrency, preserving input order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
  return results;
}

let clients: AccountClient[] = [];
let currentScan: Promise<void> | null = null;
let snapshot: CheckResponse | null = null;
let egressIp: string | null = null;

// Bot instances + SQL databases: nothing is scanned until the dashboard asks (see /api/bots, /api/databases).
const infra = new InfraStore(cfg);

const IP_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Best-effort public egress IP, trying several echo services with a timeout.
 * HTTP fallbacks are included so it still works behind a TLS-inspecting proxy
 * (which injects an untrusted cert on HTTPS); combined with `--use-system-ca`
 * on the node process, either path resolves.
 */
async function resolveEgressIp(): Promise<string | null> {
  const urls = [
    'https://api.ipify.org',
    'https://ifconfig.me/ip',
    'https://icanhazip.com',
    'http://ifconfig.me/ip',
    'http://icanhazip.com',
    'http://api.ipify.org',
  ];
  for (const url of urls) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) continue;
      const ip = (await res.text()).trim();
      if (IP_RE.test(ip)) return ip;
    } catch {
      /* try next endpoint */
    }
  }
  return null;
}

/** Resolve the egress IP once and remember it (retried on later scans if it failed). */
async function ensureEgressIp(): Promise<void> {
  if (egressIp) return;
  const ip = await resolveEgressIp();
  if (ip) {
    egressIp = ip;
    setEgressIp(ip);
    console.log(`Public egress IP: ${ip}`);
  }
}

/** Resolve the IP quickly at startup (retry every 10s for ~2 min), then let scans keep it fresh. */
async function startEgressResolver(): Promise<void> {
  for (let i = 0; i < 12 && !egressIp; i++) {
    await ensureEgressIp();
    if (egressIp) return;
    await new Promise((r) => setTimeout(r, 10_000));
  }
}

const app = express();
app.use(cors());

const STARTED_AT = new Date().toISOString();

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    accounts: clients.length,
    container: cfg.container,
    ready: !!snapshot,
    /** Process start time — changes after a restart, so the UI can tell the new process is up. */
    startedAt: STARTED_AT,
  });
});

// Restart the whole backend (API + UI) by re-running the "NTRX AppOps" scheduled task, whose launcher
// stops this process and starts a fresh one (new IP lookup, new account keys, new scan).
const RESTART_TASK = process.env.RESTART_TASK ?? 'NTRX AppOps';
const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
let restarting = false;
app.post('/api/restart', (req, res) => {
  // Browsers attach Origin to cross-site POSTs: only the local dashboard may trigger a restart.
  const origin = req.headers.origin;
  if (origin && !LOCAL_ORIGIN_RE.test(origin)) {
    res.status(403).json({ error: 'Restart is only allowed from the local dashboard.' });
    return;
  }
  if (process.platform !== 'win32') {
    res.status(501).json({ error: 'Restart uses the Windows scheduled task and is only available on Windows.' });
    return;
  }
  if (restarting) {
    res.status(409).json({ error: 'A restart is already in progress.' });
    return;
  }
  restarting = true;
  execFile('schtasks', ['/run', '/tn', RESTART_TASK], { windowsHide: true }, (err, _stdout, stderr) => {
    if (err) {
      restarting = false;
      const reason = (stderr || err.message).trim().split(/\r?\n/)[0];
      res.status(500).json({ error: `Could not start task "${RESTART_TASK}": ${reason}` });
      return;
    }
    res.status(202).json({ restarting: true, task: RESTART_TASK });
    // The task stops this process within a second or two; the flag stays set until it does.
    setTimeout(() => (restarting = false), 60_000).unref();
  });
});

// Served from cache (fast). `?fresh=1` forces a live re-scan first (manual Refresh).
app.get('/api/check', async (req, res) => {
  if (req.query.fresh === '1') await forceScan();
  if (snapshot) {
    res.json(snapshot);
    return;
  }
  res.json({
    today: cfg.checkDate ?? todayStr(),
    generatedAt: new Date().toISOString(),
    container: cfg.container,
    results: [],
    warming: true,
    egressIp,
    dateOverride: !!cfg.checkDate,
  });
});

// ---- Bot instances (cloud service role instances) -- on demand ----
// GET  /api/bots                         inventory + whatever has been checked so far (cheap)
// POST /api/bots/check[?customer=&env=]  check all bots, one customer(+env), or one bot (?service=)
// ---- SQL databases -- on demand ----
// GET  /api/databases                    inventory + whatever has been checked so far (cheap)
// POST /api/databases/check[?server=&db=] check all databases, one server, or one database
const SAFE_NAME_RE = /^[A-Za-z0-9._-]{1,128}$/;
const pick = (v: unknown): string | undefined => {
  const t = typeof v === 'string' ? v.trim() : '';
  return t || undefined;
};
const badName = (...vals: Array<string | undefined>) => vals.some((v) => v !== undefined && !SAFE_NAME_RE.test(v));

app.get('/api/bots', async (_req, res) => {
  try {
    res.json(await infra.getBots());
  } catch (err) {
    res.status(502).json({ error: friendlyError(err) });
  }
});

app.post('/api/bots/check', async (req, res) => {
  const scope = {
    customer: pick(req.query.customer),
    env: pick(req.query.env),
    service: pick(req.query.service),
    subscriptionId: pick(req.query.subscriptionId),
  };
  if (badName(scope.customer, scope.env, scope.service, scope.subscriptionId)) {
    res.status(400).json({ error: 'Invalid customer / env / service / subscriptionId.' });
    return;
  }
  try {
    res.json(await infra.checkBots(scope));
  } catch (err) {
    res.status(502).json({ error: friendlyError(err) });
  }
});

app.get('/api/databases', async (_req, res) => {
  try {
    res.json(await infra.getDatabases());
  } catch (err) {
    res.status(502).json({ error: friendlyError(err) });
  }
});

app.post('/api/databases/check', async (req, res) => {
  const scope = { server: pick(req.query.server), db: pick(req.query.db), subscriptionId: pick(req.query.subscriptionId) };
  if (badName(scope.server, scope.db, scope.subscriptionId)) {
    res.status(400).json({ error: 'Invalid server / db / subscriptionId.' });
    return;
  }
  try {
    res.json(await infra.checkDatabases(scope));
  } catch (err) {
    res.status(502).json({ error: friendlyError(err) });
  }
});

// Latest files inside archive/{capture}/{date}/ for one account (on demand, cached).
// GET /api/files?account=<name>&capture=<folder>[&date=YYYY-MM-DD][&fresh=1]
const filesCache = new Map<string, { at: number; data: FilesResponse }>();
const filesInflight = new Map<string, Promise<FilesResponse>>();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_SEGMENT_RE = /^[^/\\]+$/;

app.get('/api/files', async (req, res) => {
  const account = String(req.query.account ?? '');
  const capture = String(req.query.capture ?? '');
  const date = String(req.query.date ?? (cfg.checkDate ?? todayStr()));
  if (!account || !SAFE_SEGMENT_RE.test(capture) || capture === '..' || !DATE_RE.test(date)) {
    res.status(400).json({ error: 'Expected account, capture (single folder name) and optional date=YYYY-MM-DD.' });
    return;
  }
  const client = clients.find((c) => c.accountName === account);
  if (!client) {
    res.status(404).json({ error: `Unknown account "${account}".` });
    return;
  }

  const key = `${account}|${capture}|${date}`;
  const hit = filesCache.get(key);
  if (hit && req.query.fresh !== '1' && Date.now() - hit.at < FILES_CACHE_MS) {
    res.json({ ...hit.data, cached: true });
    return;
  }

  let job = filesInflight.get(key);
  if (!job) {
    job = (async () => {
      const signal = AbortSignal.timeout(FILES_TIMEOUT_MS);
      const latest = await listLatestFiles(client.getArchiveContainer(), capture, date, signal);
      const data: FilesResponse = {
        accountName: account,
        capture,
        date,
        generatedAt: new Date().toISOString(),
        cached: false,
        ...latest,
      };
      filesCache.set(key, { at: Date.now(), data });
      return data;
    })().finally(() => filesInflight.delete(key));
    filesInflight.set(key, job);
  }

  try {
    res.json(await job);
  } catch (err) {
    res.status(502).json({ error: friendlyError(err) });
  }
});

// Serve the built frontend if present, so one process serves API + UI.
const frontendDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  // SPA fallback for any non-/api route.
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(frontendDist, 'index.html')));
}

/** Run one scan; concurrent callers share the same in-flight scan. */
function scanOnce(): Promise<void> {
  if (currentScan) return currentScan;
  currentScan = (async () => {
    if (clients.length === 0) return;
    await ensureEgressIp();
    const today = cfg.checkDate ?? todayStr();
    const bot = cfg.botPrefix
      ? {
          cache: new Map(),
          options: {
            container: cfg.botContainer,
            stuckMs: cfg.botStuckMinutes * 60_000,
            windowMs: cfg.botWindowDays * 86_400_000,
            stuckMinutes: cfg.botStuckMinutes,
            windowDays: cfg.botWindowDays,
            timeoutMs: cfg.botTimeoutMs,
          },
        }
      : undefined;
    const results = await mapLimit(clients, SCAN_CONCURRENCY, (c) => checkAccount(c, today, cfg.checkTimeoutMs, bot));
    snapshot = {
      today,
      generatedAt: new Date().toISOString(),
      container: cfg.container,
      results,
      egressIp,
      dateOverride: !!cfg.checkDate,
    };
  })()
    .catch((err) => console.error('Scan failed:', err))
    .finally(() => {
      currentScan = null;
    });
  return currentScan;
}

/** Force a fresh scan that STARTS after this call (used by manual Refresh). */
async function forceScan(): Promise<void> {
  if (currentScan) {
    try {
      await currentScan;
    } catch {
      /* ignore */
    }
  }
  await scanOnce();
}

async function start() {
  // Listen immediately so the UI can show a "warming up" state.
  app.listen(cfg.port, () => console.log(`SRD archive monitor API on http://localhost:${cfg.port}`));

  // Resolve egress IP fast (doesn't block startup).
  void startEgressResolver();


  clients = await buildAccountClients(cfg);
  const byAuth = clients.reduce<Record<string, number>>((a, c) => ((a[c.auth] = (a[c.auth] ?? 0) + 1), a), {});
  console.log(
    `Discovered ${clients.length} account(s) for container "${cfg.container}" ` +
      `(${Object.entries(byAuth).map(([k, v]) => `${v} ${k}`).join(', ')}); scanning every ${REFRESH_MS / 1000}s`,
  );

  await scanOnce(); // first snapshot
  const loop = async () => {
    await scanOnce();
    setTimeout(loop, REFRESH_MS);
  };
  setTimeout(loop, REFRESH_MS);
}

start().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
