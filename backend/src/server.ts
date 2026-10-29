import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import express from 'express';
import compression from 'compression';
import { loadConfig } from './config.js';
import { buildAccountClients, mgmtCredential } from './azure.js';
import { checkAccount, todayStr, setEgressIp, friendlyError } from './checker.js';
import { checkBotStorage } from './bot.js';
import { AGGS, checkCalls, checkSeries, HOUR_CHOICES, isGuid, METRIC_NAMES, RANGE_HOURS, type Agg, type CallsResponse, type SeriesResponse } from './calls.js';
import { listLatestFiles } from './files.js';
import { InfraStore } from './infra.js';
import { csrfGuard, hostGuard, rateLimiter, securityHeaders } from './security.js';
import { readCache, writeCacheSoon } from './cache.js';
import {
  BadInput,
  buildMail,
  buildTeams,
  hasChannel,
  isTeamsUrl,
  teamsTestCard,
  cleanLists,
  doneFor,
  takeDue,
  emptyState,
  isEmail,
  mark as markChecklist,
  markSent,
  nextReminder,
  pending,
  setLists,
  setProfile,
  slotLabel,
  trackedLists,
  type ChecklistState,
} from './checklist.js';
import { mailConfigured, mailFrom, sendMail } from './mailer.js';
import { sendTeams } from './teams.js';
import type { AccountClient, BotStorageResult, CheckResponse, FilesResponse } from './types.js';

const cfg = loadConfig();
const REFRESH_MS = Number(process.env.REFRESH_MS ?? 60_000);
const SCAN_CONCURRENCY = Math.max(1, Number(process.env.SCAN_CONCURRENCY ?? 20));
/** Bot-storage accounts listed at the same time in the background phase of a scan. */
const BOT_CONCURRENCY = Math.max(1, Number(process.env.BOT_CONCURRENCY ?? 4));
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

/**
 * After a restart, serve the previous scan (if it is from today) straight away instead of "warming up" for 1-4 minutes;
 * the real scan runs in the background and replaces it. Its generatedAt stays the time it was really gathered.
 */
function restoreSnapshot(): void {
  const saved = readCache<CheckResponse>('snapshot');
  if (saved && Array.isArray(saved.results) && saved.results.length > 0 && saved.today === (cfg.checkDate ?? todayStr())) {
    snapshot = saved;
    console.log(`[startup] restored the previous scan from ${saved.generatedAt} (${saved.results.length} accounts); refreshing in the background`);
  }
}
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

/** Re-read the public IP (it changes with VPN / network), so firewall errors quote the address Azure actually sees. */
async function refreshEgressIp(): Promise<void> {
  const ip = await Promise.race([resolveEgressIp(), new Promise<null>((res) => setTimeout(() => res(null), 6000))]);
  if (ip && ip !== egressIp) {
    console.log(`Public egress IP changed: ${egressIp ?? 'unknown'} -> ${ip}`);
    egressIp = ip;
    setEgressIp(ip);
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
app.disable('x-powered-by');

// ---- Security guards (see security.ts) ----
// No CORS on purpose: the dashboard is served by this same process, so no other website may read these answers.
// Bind to this machine only unless HOST says otherwise, and only answer to our own host names (blocks DNS rebinding).
const HOST = process.env.HOST ?? '127.0.0.1';
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(hostGuard(ALLOWED_HOSTS));
app.use(securityHeaders());
app.use(compression()); // JSON, JS and CSS shrink to roughly a fifth on the wire
const isPost = (req: express.Request) => req.method === 'POST';
app.use(
  '/api',
  rateLimiter([
    { match: (req) => isPost(req) && req.originalUrl.startsWith('/api/restart'), windowMs: 60_000, max: 3 },
    { match: (req) => isPost(req) && /\/api\/[a-z]+\/check/.test(req.originalUrl), windowMs: 60_000, max: 40 },
    // every distinct request reads Application Insights: allow normal use, stop hammering
    { match: (req) => isPost(req) && req.originalUrl.startsWith('/api/calls/series'), windowMs: 60_000, max: 40 },
    { match: (req) => req.originalUrl.startsWith('/api/files'), windowMs: 60_000, max: 300 },
    { match: () => true, windowMs: 60_000, max: 900 },
  ]),
);
app.use('/api', csrfGuard(ALLOWED_HOSTS));

const STARTED_AT = new Date().toISOString();

// Who the backend is signed in as (the `az login` identity), read from the token's claims; nothing is sent anywhere.
let me: { email: string | null; name: string | null } | null = null;
app.get('/api/me', async (_req, res) => {
  if (!me) {
    try {
      const t = await mgmtCredential().getToken('https://management.azure.com/.default');
      if (!t) throw new Error('no token');
      const claims = JSON.parse(Buffer.from(t.token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, string>;
      me = {
        email: claims.upn ?? claims.preferred_username ?? claims.unique_name ?? claims.email ?? null,
        name: claims.given_name ?? null,
      };
    } catch {
      return res.json({ email: null, name: null }); // not cached: try again next time
    }
  }
  res.json(me);
});

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


// ---- Daily health-check checklist + email reminders (see checklist.ts) ----
// The lists come from the browser (the saved groups); ticks, the email address and the reminder times are kept in the cache
// folder so they survive the 15-minute restarts. Mutating calls are POST/PUT, so the CSRF guard above covers them.
let checklist: ChecklistState = { ...emptyState(), ...(readCache<Partial<ChecklistState>>('checklist') ?? {}) };
const saveChecklist = (next: ChecklistState, delay = 300) => {
  checklist = next;
  writeCacheSoon('checklist', checklist, delay);
};
const checklistJson = express.json({ limit: '128kb' });

function checklistView() {
  const today = cfg.checkDate ?? todayStr();
  const now = new Date();
  const next = nextReminder(checklist, now);
  return {
    today,
    email: checklist.email,
    enabled: checklist.enabled,
    times: checklist.times,
    repeat: checklist.repeat,
    repeatMinutes: checklist.repeatMinutes,
    tracked: checklist.tracked,
    lists: checklist.lists.map((l) => ({ name: l.name, members: l.members, done: doneFor(checklist, today, l.name) })),
    smtp: { configured: mailConfigured(), from: mailFrom() ? mailFrom().replace(/^.*</, '').replace(/>.*$/, '') : '' },
    lastMail: checklist.lastMail,
    // the webhook address is a secret: the browser only learns that one is saved
    teams: { configured: isTeamsUrl(checklist.teamsUrl) },
    lastTeams: checklist.lastTeams,
    nextReminder: next ? next.toISOString() : null,
  };
}

const checklistFail = (res: express.Response, err: unknown) => {
  if (err instanceof BadInput) return res.status(400).json({ error: err.message });
  console.error(`Checklist request failed: ${err instanceof Error ? err.message : String(err)}`);
  return res.status(500).json({ error: 'Something went wrong on the server.' });
};

app.get('/api/checklist', (_req, res) => res.json(checklistView()));

app.put('/api/checklist/lists', checklistJson, (req, res) => {
  try {
    saveChecklist(setLists(checklist, cleanLists((req.body as { lists?: unknown } | undefined)?.lists)));
    res.json(checklistView());
  } catch (err) {
    checklistFail(res, err);
  }
});

app.put('/api/checklist/settings', checklistJson, (req, res) => {
  try {
    saveChecklist(setProfile(checklist, (req.body ?? {}) as Record<string, unknown>, cfg.checkDate ?? todayStr()));
    res.json(checklistView());
  } catch (err) {
    checklistFail(res, err);
  }
});

app.post('/api/checklist/mark', checklistJson, (req, res) => {
  const b = (req.body ?? {}) as { list?: unknown; member?: unknown; done?: unknown };
  if (typeof b.list !== 'string' || typeof b.done !== 'boolean' || (b.member !== undefined && b.member !== null && typeof b.member !== 'string')) {
    res.status(400).json({ error: 'Invalid request.' });
    return;
  }
  try {
    saveChecklist(markChecklist(checklist, cfg.checkDate ?? todayStr(), b.list, typeof b.member === 'string' ? b.member : null, b.done));
    res.json(checklistView());
  } catch (err) {
    checklistFail(res, err);
  }
});

app.post('/api/checklist/test-mail', async (_req, res) => {
  if (!isEmail(checklist.email)) {
    res.status(400).json({ error: 'Enter and save your email address first.' });
    return;
  }
  try {
    await sendMail(checklist.email, {
      subject: 'Health check reminders are working',
      text: `This is a test from the Godzilla Health Monitor. Reminders will be sent to this address at ${checklist.times.map(slotLabel).join(', ')} while health checks are not ticked off.`,
      html: `<p>This is a test from the <b>Godzilla Health Monitor</b>. Reminders will be sent to this address at <b>${checklist.times.map(slotLabel).join(', ')}</b> while health checks are not ticked off.</p>`,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(`Test mail failed: ${friendlyError(err)}`);
    res.status(502).json({ error: 'The mail server did not accept the message. Check the SMTP settings in backend/.env.' });
  }
});

app.post('/api/checklist/test-teams', async (_req, res) => {
  if (!isTeamsUrl(checklist.teamsUrl)) {
    res.status(400).json({ error: 'Paste and save your Teams workflow address first.' });
    return;
  }
  try {
    await sendTeams(checklist.teamsUrl, teamsTestCard(checklist.times));
    res.json({ ok: true });
  } catch (err) {
    console.error(`Test Teams message failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    res.status(502).json({ error: 'Teams did not accept the message. Check that the workflow is still turned on and the address is complete.' });
  }
});

/**
 * Called every minute: for each channel (email, Teams) sends a reminder for every due slot that still has unticked members.
 * Each channel keeps its own "already sent" record, so a failing one is retried without repeating the other.
 */
let ticking = false;
async function checklistTick(now = new Date()): Promise<void> {
  if (ticking || !checklist.enabled || !hasChannel(checklist)) return;
  ticking = true;
  try {
    const date = cfg.checkDate ?? todayStr(now);
    const link = `http://localhost:${cfg.port}/`;
    const channels: { name: 'email' | 'teams'; on: boolean; send: (todo: ReturnType<typeof pending>, slot: string) => Promise<void> }[] = [
      { name: 'email', on: isEmail(checklist.email), send: (todo, slot) => sendMail(checklist.email, buildMail(todo, slot, date, link)) },
      { name: 'teams', on: isTeamsUrl(checklist.teamsUrl), send: (todo, slot) => sendTeams(checklist.teamsUrl, buildTeams(todo, slot, date, link)) },
    ];
    for (const ch of channels.filter((c) => c.on)) {
      const due = takeDue(checklist, date, now, ch.name);
      if (due.state !== checklist) saveChecklist(due.state, 50);
      for (const slot of due.slot ? [due.slot] : []) {
        const todo = pending(checklist, date);
        if (todo.length === 0) {
          saveChecklist(markSent(checklist, date, slot, ch.name), 50); // everything is ticked: nothing to remind about
          continue;
        }
        const key = ch.name === 'email' ? 'lastMail' : 'lastTeams';
        try {
          await ch.send(todo, slot);
          saveChecklist({ ...markSent(checklist, date, slot, ch.name), [key]: { at: new Date().toISOString(), ok: true, slot } }, 50);
          console.log(`[checklist] ${ch.name} reminder for ${slot} sent (${todo.reduce((n, t) => n + t.missing.length, 0)} unticked)`);
        } catch (err) {
          // not marked as sent: it is retried on the next tick until the grace period ends
          const msg = err instanceof Error && /not set up/.test(err.message) ? err.message : ch.name === 'email' ? 'The mail server did not accept the message.' : 'Teams did not accept the message.';
          console.error(`[checklist] ${ch.name} reminder for ${slot} failed: ${ch.name === 'email' ? friendlyError(err) : err instanceof Error ? err.message : 'unknown error'}`);
          saveChecklist({ ...checklist, [key]: { at: new Date().toISOString(), ok: false, slot, error: msg } }, 50);
        }
      }
    }
  } finally {
    ticking = false;
  }
}

// ---- Concurrent calls per bot (Application Insights): ON DEMAND ONLY ----
// Never called at start-up or on a timer: the dashboard asks for one customer (one subscription) when someone clicks. Answers are
// kept for 30 s so a double click or a second person asking about the same customer does not repeat the queries.
const callsCache = new Map<string, { at: number; data: CallsResponse }>();
const callsInflight = new Map<string, Promise<CallsResponse>>();

app.post('/api/calls/check', async (req, res) => {
  const sub = String(req.query.subscriptionId ?? '');
  const hours = Number(req.query.hours ?? 1);
  if (!isGuid(sub) || !HOUR_CHOICES.includes(hours)) {
    res.status(400).json({ error: 'Invalid subscriptionId or hours.' });
    return;
  }
  const key = `${sub}|${hours}`;
  const hit = callsCache.get(key);
  if (hit && Date.now() - hit.at < 30_000) {
    res.json(hit.data);
    return;
  }
  try {
    let job = callsInflight.get(key);
    if (!job) {
      job = checkCalls(mgmtCredential(), sub, hours).finally(() => callsInflight.delete(key));
      callsInflight.set(key, job);
    }
    const data = await job;
    callsCache.set(key, { at: Date.now(), data });
    res.json(data);
  } catch (err) {
    console.error(`Concurrent calls check failed: ${friendlyError(err)}`);
    res.status(502).json({ error: 'Could not read the concurrent calls right now.' });
  }
});

// The Concurrent Calls tab: one metric over time for one customer. Same rules: on demand only, one subscription per request.
const seriesCache = new Map<string, { at: number; data: SeriesResponse }>();
const seriesInflight = new Map<string, Promise<SeriesResponse>>();

app.post('/api/calls/series', async (req, res) => {
  const sub = String(req.query.subscriptionId ?? '');
  const hours = Number(req.query.hours ?? 1);
  const metric = String(req.query.metric ?? 'calls');
  const agg = String(req.query.agg ?? 'max') as Agg;
  if (!isGuid(sub) || !RANGE_HOURS.includes(hours) || !Object.hasOwn(METRIC_NAMES, metric) || !AGGS.includes(agg)) {
    res.status(400).json({ error: 'Invalid subscriptionId, hours, metric or agg.' });
    return;
  }
  const key = `${sub}|${hours}|${metric}|${agg}`;
  const hit = seriesCache.get(key);
  if (hit && Date.now() - hit.at < 30_000) {
    res.json(hit.data);
    return;
  }
  try {
    let job = seriesInflight.get(key);
    if (!job) {
      job = checkSeries(mgmtCredential(), sub, hours, metric, agg).finally(() => seriesInflight.delete(key));
      seriesInflight.set(key, job);
    }
    const data = await job;
    seriesCache.set(key, { at: Date.now(), data });
    res.json(data);
  } catch (err) {
    console.error(`Concurrent calls series failed: ${friendlyError(err)}`);
    res.status(502).json({ error: 'Could not read the concurrent calls right now.' });
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
  // Built files carry a content hash in their name, so they can be cached "forever"; the page itself is re-checked each visit.
  const NO_CACHE = { 'Cache-Control': 'no-cache' };
  app.use(
    express.static(frontendDist, {
      dotfiles: 'ignore',
      index: false,
      setHeaders(res, filePath) {
        res.setHeader('Cache-Control', /[\\/]assets[\\/]/.test(filePath) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    }),
  );
  app.get('/', (_req, res) => res.sendFile(path.join(frontendDist, 'index.html'), { headers: NO_CACHE }));
  // SPA fallback for page routes only (no file extension, not /api): a missing file such as a source map is a real 404.
  app.get(/^(?!\/api)[^.]*$/, (_req, res) => res.sendFile(path.join(frontendDist, 'index.html'), { headers: NO_CACHE }));
}

// Anything unexpected: a generic answer (details stay in the server log), never a stack trace.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // errors from reading a request body (too large, not JSON) are the caller's mistake, not ours
  const status = (err as { status?: number } | null)?.status;
  if (status === 413) return void res.status(413).json({ error: 'Request too large.' });
  if (status === 400) return void res.status(400).json({ error: 'Invalid request.' });
  console.error(`Request failed: ${err instanceof Error ? err.message : String(err)}`);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

/** Bot-storage options for a scan; the cache lets accounts that share a bot account list it once. */
function botScan() {
  return cfg.botPrefix
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
}

function publish(results: CheckResponse['results'], today: string): void {
  snapshot = {
    today,
    generatedAt: new Date().toISOString(),
    container: cfg.container,
    results,
    egressIp,
    dateOverride: !!cfg.checkDate,
  };
  writeCacheSoon('snapshot', snapshot); // so the next restart can show it straight away
}

// Bot storage ("anything stuck?") lists tens of thousands of files and takes ~45 s, while the archive check of every
// account takes ~10 s. They used to be one scan, so the archive numbers waited for the slow part. Now the archive result is
// published as soon as it is ready, and the bot-storage results are merged into the snapshot when the background phase ends.
let botPhase: Promise<void> | null = null;
let botPhaseAgain = false;

function startBotPhase(today: string): void {
  if (botPhase) {
    botPhaseAgain = true; // a newer scan finished while this was still running: go again right after
    return;
  }
  const bot = botScan();
  if (!bot) return;
  botPhase = (async () => {
    const t0 = Date.now();
    const found = new Map<string, BotStorageResult>();
    await mapLimit(
      clients.filter((c) => c.botTargets && c.botTargets.length > 0),
      BOT_CONCURRENCY,
      async (c) => {
        found.set(c.accountName, await checkBotStorage(c.botTargets!, bot.options, bot.cache));
      },
    );
    if (snapshot && snapshot.today === today) {
      snapshot = { ...snapshot, results: snapshot.results.map((r) => (found.has(r.accountName) ? { ...r, bot: found.get(r.accountName) } : r)) };
      writeCacheSoon('snapshot', snapshot);
    }
    console.log(`[scan] bot storage phase finished in ${((Date.now() - t0) / 1000).toFixed(0)}s (${found.size} accounts)`);
  })()
    .catch((err) => console.error(`Bot storage scan failed: ${friendlyError(err)}`))
    .finally(() => {
      botPhase = null;
      if (botPhaseAgain) {
        botPhaseAgain = false;
        startBotPhase(today);
      }
    });
}

/** Run one scan; concurrent callers share the same in-flight scan. Resolves when the archive phase is done (bot storage continues in the background). */
function scanOnce(): Promise<void> {
  if (currentScan) return currentScan;
  currentScan = (async () => {
    if (clients.length === 0) return;
    await refreshEgressIp();
    const today = cfg.checkDate ?? todayStr();
    // keep showing the last bot-storage answer for each account until the background phase replaces it
    const previousBot = new Map((snapshot?.results ?? []).map((r) => [r.accountName, r.bot]));
    const results = await mapLimit(clients, SCAN_CONCURRENCY, async (c) => {
      const r = await checkAccount(c, today, cfg.checkTimeoutMs);
      const prev = previousBot.get(r.accountName);
      if (prev) r.bot = prev;
      return r;
    });
    publish(results, today);
    startBotPhase(today);
  })()
    .catch((err) => console.error(`Scan failed: ${friendlyError(err)}`)) // not the raw error: SDK errors can carry request headers
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
  restoreSnapshot(); // yesterday's / the last scan, if it is from today: data on screen immediately
  // Listen immediately so the UI can show a "warming up" state.
  // "localhost" resolves to ::1 first on many machines; if nothing listens there every new connection waits for that attempt to
  // fail before falling back to 127.0.0.1 (hundreds of ms in a browser, 2 s in simple clients). So when the default
  // loopback binding is used we listen on both loopback addresses. Still this machine only.
  const hosts = HOST === '127.0.0.1' ? ['127.0.0.1', '::1'] : [HOST];
  for (const h of hosts) {
    const server = app.listen(cfg.port, h, () => console.log(`SRD archive monitor API on http://localhost:${cfg.port} (listening on ${h})`));
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (h === '::1') return console.log(`[startup] IPv6 loopback not available (${err.code}); using 127.0.0.1 only`);
      console.error(`Failed to listen on ${h}:${cfg.port}: ${err.message}`);
      process.exit(1);
    });
  }

  // Resolve egress IP fast (doesn't block startup).
  void startEgressResolver();

  // Checklist reminders run on their own timer, independent of the Azure scans.
  void checklistTick();
  setInterval(() => void checklistTick(), 60_000).unref();


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
  console.error(`Failed to start: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
