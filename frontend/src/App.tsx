import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BotsResponse, CheckResponse, CheckResult, DatabasesResponse, Status } from './types';
import { fetchCheck, fetchHealth, restartBackend, fetchBots, checkBots, fetchDatabases, checkDatabases } from './lib/api';
import { findNeedsIp } from './lib/needsIp';
import { useOnDemand } from './lib/useOnDemand';
import { isDownState } from './lib/instanceState';
import { useAlerts } from './lib/useAlerts';
import { unlockAudio } from './lib/chime';
import { useFullscreen } from './lib/useFullscreen';
import { NotificationBell, Toasts } from './components/Notifications';
import SidePanel from './components/SidePanel';
import { detectEnv } from './lib/ui';
import { useTheme } from './lib/theme';
import { coverageSeries, isMonitorable } from './lib/history';
import { loadGroups, saveGroups, type WatchGroup } from './lib/watchlist';
import { Panel, StatPanel, CoverageChart, Gauge } from './components/panels';
import WatchlistSearch, { type CustomerSuggestion } from './components/WatchlistSearch';
import { subMatchesWatch, subMatchesFilter, scopeKey, envOf, type EnvName } from './lib/watchMatch';
import AccountTable from './components/AccountTable';
import DetailDrawer from './components/DetailDrawer';
import { Icon } from './components/navIcons';
import NeedsIpPanel from './components/NeedsIpPanel';
import BotsView from './components/BotsView';
import DatabasesView, { type DbScope } from './components/DatabasesView';
import CustomersView from './components/CustomersView';
import { buildCustomerRows } from './lib/customers';
import type { BotScope } from './components/BotGroups';

const REFRESH_MS = 900_000; // 15 min
const RESTART_WAIT_MS = 10 * 60_000;
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
type Filter = 'all' | Status | 'PRD' | 'UAT' | 'DEV';
type View = 'archive' | 'customers' | 'bots' | 'dbs';
// Scope of the automatic 15-minute re-check on the Cloud Instances / Databases tabs: everything.
const ALL_BOTS: BotScope = {};
const ALL_DBS: DbScope = {};

export default function App() {
  const [data, setData] = useState<CheckResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  // Set by clicking the "at risk" box: the accounts table then lists just the at-risk accounts (missing today or error).
  const [atRiskOnly, setAtRiskOnly] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);
  const [terms, setTerms] = useState<string[]>([]);
  // What is being typed right now: filters live (everything starting with it) before it becomes a chip.
  const [draft, setDraft] = useState('');
  const [groups, setGroups] = useState<WatchGroup[]>(() => loadGroups());
  const [selected, setSelected] = useState<string | null>(null);
  const { mode, toggleMode } = useTheme();
  const abortRef = useRef<AbortController | null>(null);
  const [restartMsg, setRestartMsg] = useState<string | null>(null);
  const [showNeeds, setShowNeeds] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [view, setView] = useState<View>('customers');
  // Environment filter shared by the Cloud Instances and Databases tabs.
  const [infraEnv, setInfraEnv] = useState<EnvName | 'all'>('all');
  // Bots + databases are on demand: nothing is fetched until their tab is opened / a check is run.
  const bots = useOnDemand<BotsResponse, BotScope>(fetchBots, checkBots, ALL_BOTS);
  const dbs = useOnDemand<DatabasesResponse, DbScope>(fetchDatabases, checkDatabases, ALL_DBS);
  const { reset: resetBots } = bots;
  // Bell + pop-ups: raised when a checked instance newly goes Stopped / Unresponsive.
  const alerts = useAlerts(bots.data);
  const fullscreen = useFullscreen();
  const { reset: resetDbs } = dbs;
  const restartingRef = useRef(false);

  const updateGroups = useCallback((g: WatchGroup[]) => {
    setGroups(g);
    saveGroups(g);
  }, []);

  const load = useCallback(async (force = false) => {
    if (restartingRef.current) return; // a backend restart is driving the data load
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchCheck(ac.signal, force);
      setData(res);
      setLastRefresh(new Date());
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  /** Restart the backend (new process: fresh IP lookup, account keys and scan), then load the new data. */
  const restart = useCallback(async () => {
    if (restartingRef.current) return;
    restartingRef.current = true;
    abortRef.current?.abort();
    setError(null);
    setRestartMsg('Restarting backend…');
    try {
      const before = await fetchHealth().catch(() => null);
      await restartBackend();
      const deadline = Date.now() + RESTART_WAIT_MS;

      // 1) wait for the new process (its start time differs from the old one's).
      let up = false;
      while (Date.now() < deadline) {
        await sleep(3000);
        const h = await fetchHealth().catch(() => null);
        if (h && (!before || h.startedAt !== before.startedAt)) {
          up = true;
          break;
        }
      }
      if (!up) throw new Error('The backend did not come back within 10 minutes.');

      // 2) wait for its first scan, then show the data.
      setRestartMsg('Backend restarted — running the first scan…');
      while (Date.now() < deadline) {
        const res = await fetchCheck(undefined, false).catch(() => null);
        if (res && !res.warming) {
          setData(res);
          setLastRefresh(new Date());
          resetBots(); // the backend restarted, so earlier bot / database checks are gone
          resetDbs();
          return;
        }
        await sleep(3000);
      }
      throw new Error('The first scan did not finish within 10 minutes.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      restartingRef.current = false;
      setRestartMsg(null);
    }
  }, [resetBots, resetDbs]);

  useEffect(() => {
    load();
    const id = setInterval(() => load(), REFRESH_MS);
    return () => {
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, [load]);

  // While the backend's first scan runs, poll quickly until data arrives.
  useEffect(() => {
    if (!data?.warming) return;
    const t = setTimeout(() => load(), 4000);
    return () => clearTimeout(t);
  }, [data, load]);

  // Browsers only allow sound after the user has touched the page: unlock audio on the first click / key press.
  useEffect(() => {
    const unlock = () => {
      unlockAudio();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // On narrow screens the tab row scrolls sideways: keep the selected tab in view.
  useEffect(() => {
    document.querySelector('.tab-on')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'auto' });
  }, [view]);

  const { open: openBots } = bots;
  const { open: openDbs } = dbs;
  useEffect(() => {
    if ((view === 'bots' || view === 'customers') && !bots.data && !bots.loading) void openBots();
    if ((view === 'dbs' || view === 'customers') && !dbs.data && !dbs.loading) void openDbs();
  }, [view, bots.data, bots.loading, dbs.data, dbs.loading, openBots, openDbs]);

  const results = data?.results ?? [];
  const today = data?.today ?? '';

  // Watchlist (union of terms) narrows the whole dashboard scope.
  // Chips are the group (OR); whatever is typed on top narrows WITHIN that group (AND).
  const filtering = terms.length > 0 || draft.trim() !== '';

  const watched = useMemo(() => {
    if (!filtering) return results;
    return results.filter((r) => subMatchesFilter(scopeKey(r.subscription, r.accountName), terms, draft));
  }, [results, terms, draft, filtering]);

  // PROD / UAT / DEV selected -> the stat cards, Health today and the coverage chart describe just that
  // environment (no environment selected = every account in the watchlist).
  const envScope = filter === 'PRD' || filter === 'UAT' || filter === 'DEV' ? filter : null;
  const scoped = useMemo(
    () => (envScope ? watched.filter((r) => detectEnv(r.accountName) === envScope) : watched),
    [watched, envScope],
  );

  const counts = useMemo(() => {
    const by = (s: Status) => scoped.filter((r) => r.status === s).length;
    const monitorable = scoped.filter(isMonitorable).length;
    const healthy = by('healthy');
    return {
      all: scoped.length,
      healthy,
      missing_today: by('missing_today'),
      error: by('error'),
      no_data: by('no_data'),
      monitorable,
      pct: monitorable > 0 ? Math.round((healthy / monitorable) * 100) : 0,
      // At-risk accounts: the selected environment, or PRD when no environment is selected.
      prdAtRisk: scoped.filter(
        (r) =>
          (envScope ? true : /prd|prod/i.test(r.accountName)) && (r.status === 'missing_today' || r.status === 'error'),
      ).length,
    };
  }, [scoped, envScope]);

  // Accounts counted by the "at risk" box: the selected environment, or PRD when none is selected.
  const atRiskList = useMemo(
    () =>
      scoped.filter(
        (r) =>
          (envScope ? true : /prd|prod/i.test(r.accountName)) && (r.status === 'missing_today' || r.status === 'error'),
      ),
    [scoped, envScope],
  );
  const showAtRisk = () => {
    if (atRiskList.length === 0) return;
    setAtRiskOnly(true);
    setFilter((f) => (f === 'PRD' || f === 'UAT' || f === 'DEV' ? f : 'all')); // keep an environment filter, drop a status one
    setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };

  // The same watchlist / groups narrow the Cloud Instances and Databases tabs (matched on customer, see watchMatch.ts).
  const botsWatched = useMemo<BotsResponse | null>(() => {
    if (!bots.data || !filtering) return bots.data;
    return {
      ...bots.data,
      cloudServices: bots.data.cloudServices.filter((c) => subMatchesFilter(scopeKey(c.subscription, c.name), terms, draft)),
      instances: bots.data.instances.filter((i) => subMatchesFilter(scopeKey(i.subscription, i.cloudService), terms, draft)),
    };
  }, [bots.data, terms, draft, filtering]);
  const dbsWatched = useMemo<DatabasesResponse | null>(() => {
    if (!dbs.data || !filtering) return dbs.data;
    return { ...dbs.data, databases: dbs.data.databases.filter((d) => subMatchesFilter(scopeKey(d.subscription, d.server), terms, draft)) };
  }, [dbs.data, terms, draft, filtering]);

  // Every customer we know about (from accounts, bots and databases), for the search suggestions.
  const suggestions = useMemo<CustomerSuggestion[]>(() => {
    const m = new Map<string, { srd: number; bots: number; dbs: Set<string>; inGroup: boolean }>();
    const at = (sub: string | undefined, name: string) => {
      const code = scopeKey(sub, name);
      let e = m.get(code);
      if (!e) m.set(code, (e = { srd: 0, bots: 0, dbs: new Set(), inGroup: false }));
      if (terms.length > 0 && subMatchesWatch(code, terms)) e.inGroup = true;
      return e;
    };
    for (const r of results) at(r.subscription, r.accountName).srd++;
    for (const c of bots.data?.cloudServices ?? []) at(c.subscription, c.name).bots++;
    for (const d of dbs.data?.databases ?? []) at(d.subscription, d.server).dbs.add(d.server);
    return [...m.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, e]) => ({
        code,
        inFilter: terms.length === 0 || e.inGroup,
        detail: [
          e.srd ? `${e.srd} SRD` : '',
          e.bots ? `${e.bots} bot${e.bots === 1 ? '' : 's'}` : '',
          e.dbs.size ? `${e.dbs.size} db server${e.dbs.size === 1 ? '' : 's'}` : '',
        ]
          .filter(Boolean)
          .join(' · '),
      }));
  }, [results, bots.data, dbs.data, terms]);

  // ...then the environment filter (PROD / UAT / DEV) on top of the watchlist.
  const botsShown = useMemo<BotsResponse | null>(() => {
    if (!botsWatched || infraEnv === 'all') return botsWatched;
    return {
      ...botsWatched,
      cloudServices: botsWatched.cloudServices.filter((c) => envOf(c.name) === infraEnv),
      instances: botsWatched.instances.filter((i) => envOf(i.cloudService) === infraEnv),
    };
  }, [botsWatched, infraEnv]);
  const dbsShown = useMemo<DatabasesResponse | null>(() => {
    if (!dbsWatched || infraEnv === 'all') return dbsWatched;
    return { ...dbsWatched, databases: dbsWatched.databases.filter((d) => envOf(d.server) === infraEnv) };
  }, [dbsWatched, infraEnv]);
  // Customers tab: one row per subscription (watchlist applied), then the environment filter.
  const customerRowsAll = useMemo(() => buildCustomerRows(watched, botsWatched, dbsWatched), [watched, botsWatched, dbsWatched]);
  const customerRows = useMemo(
    () => (infraEnv === 'all' ? customerRowsAll : customerRowsAll.filter((r) => r.env === infraEnv)),
    [customerRowsAll, infraEnv],
  );
  const envCounts = useMemo(() => {
    const n: Record<EnvName, number> = { PRD: 0, UAT: 0, DEV: 0, OTHER: 0 };
    if (view === 'customers') {
      for (const row of customerRowsAll) n[row.env]++;
      return n;
    }
    const names =
      view === 'bots'
        ? (botsWatched?.cloudServices ?? []).map((c) => c.name)
        : (dbsWatched?.databases ?? []).map((d) => d.server);
    for (const name of names) n[envOf(name)]++;
    return n;
  }, [view, botsWatched, dbsWatched, customerRowsAll]);

  const botIssues = useMemo(
    // red only: Stopped / Unresponsive (Starting and other states are yellow and not counted)
    () => (botsShown?.instances ?? []).filter((i) => isDownState(i.status)).length,
    [botsShown],
  );
  const dbIssues = useMemo(() => {
    const crit = dbsShown?.storageThreshold ?? 75;
    const dtuCrit = dbsShown?.dtuThreshold ?? 90;
    return (dbsShown?.databases ?? []).filter(
      (d) =>
        d.checkedAt !== null &&
        ((d.usedPct !== null && d.usedPct > crit) || (d.dtuPct !== null && d.dtuPct > dtuCrit)),
    ).length;
  }, [dbsShown]);
  const shownRefresh =
    view === 'archive'
      ? lastRefresh
      : view === 'bots'
        ? bots.lastCheck
        : view === 'dbs'
          ? dbs.lastCheck
          : [bots.lastCheck, dbs.lastCheck].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  const needsIp = useMemo(() => findNeedsIp(results), [results]);
  const needsIpCount = needsIp.srd.length + needsIp.bot.length;

  const series = useMemo(() => coverageSeries(scoped, today || new Date().toISOString().slice(0, 10)), [scoped, today]);

  // Table rows: watchlist scope, then the active status/env filter.
  const rows = useMemo(() => {
    if (atRiskOnly) return atRiskList;
    switch (filter) {
      case 'healthy':
      case 'missing_today':
      case 'no_data':
      case 'error':
        return watched.filter((r) => r.status === filter);
      case 'PRD':
      case 'UAT':
      case 'DEV':
        return watched.filter((r) => detectEnv(r.accountName) === filter);
      default:
        return watched;
    }
  }, [watched, filter, atRiskOnly, atRiskList]);

  const selectedAccount: CheckResult | null = selected
    ? (results.find((r) => r.accountName === selected) ?? null)
    : null;

  const STAT_FILTERS: { key: Filter; label: string; value: number; scope?: string; spark?: number[]; sparkColor?: string }[] = [
    { key: 'all', label: 'Accounts', value: counts.all, spark: series.map((d) => d.covered), sparkColor: 'var(--accent-2)' },
    { key: 'healthy', label: 'Healthy', value: counts.healthy, scope: 'st-ok', spark: series.map((d) => d.covered) },
    { key: 'missing_today', label: 'Missing today', value: counts.missing_today, scope: 'st-warn', spark: series.map((d) => d.missing) },
    { key: 'error', label: 'Errors', value: counts.error, scope: 'st-err' },
    { key: 'no_data', label: 'No SRD', value: counts.no_data, scope: 'st-idle' },
  ];

  const issueCount = counts.error + counts.missing_today + botIssues + dbIssues;
  const VIEW_TITLE: Record<View, [string, string]> = {
    customers: ['Customers', 'Archive, bots and databases per subscription'],
    archive: ['SRD Archive', "Today's archive date-folder on every *srd01 account"],
    bots: ['Cloud Instances', 'Bot instances across your cloud services'],
    dbs: ['Databases', 'SQL databases: status, storage and DTU'],
  };

  return (
    <div className="app">
        <aside className="side">
          <div className="side-brand">
            <span className="brand-mark" aria-hidden>
              <Icon name="pulse" size={20} />
            </span>
            <span className="brand-text">
              <span className="brand-title">NTR-X Azure Dashboard</span>
              <span className="brand-sub">NTRX AppOps</span>
            </span>
          </div>
          <nav className="side-nav">
            {([
              ['customers', 'Customers', 'customers', 0],
              ['archive', 'Archive', 'archive', 0],
              ['bots', 'Cloud Instances', 'bots', botIssues],
              ['dbs', 'Databases', 'dbs', dbIssues],
            ] as const).map(([key, label, icon, badge]) => (
              <button key={key} className={`side-item ${view === key ? 'side-on' : ''}`} onClick={() => setView(key)}>
                <Icon name={icon} />
                <span>{label}</span>
                {badge > 0 && <span className="tab-badge">{badge}</span>}
              </button>
            ))}
          </nav>
          <div className="side-foot">
            <span className="dot pulse" style={{ background: 'var(--ok)', width: 8, height: 8 }} />
            <span className="side-foot-text">
              <strong>Live monitoring</strong>
              <span className="mono">{data?.egressIp ? `src ${data.egressIp}` : 'connecting…'}</span>
            </span>
          </div>
        </aside>

        <div className="main">
        <header className="topbar">
          {/* ── Shared search + groups (same on every tab) ── */}
        <WatchlistSearch
          terms={terms}
          setTerms={setTerms}
          groups={groups}
          setGroups={updateGroups}
          suggestions={suggestions}
          onDraft={setDraft}
          matchCount={
            view === 'archive'
              ? counts.all
              : view === 'customers'
                ? customerRows.length
                : view === 'bots'
                  ? (botsShown?.cloudServices.length ?? 0)
                  : (dbsShown?.databases.length ?? 0)
          }
          />
          <span className={`sys-pill ${issueCount === 0 ? 'sys-ok' : 'sys-warn'}`}>
            <span className="dot" style={{ background: 'var(--c)' }} />
            {issueCount === 0 ? 'All systems healthy' : `${issueCount} need attention`}
            <span className="sys-pct mono">{counts.pct}%</span>
          </span>
          <div className="topbar-tools">
            <NotificationBell
                items={alerts.items}
                unread={alerts.unread}
                onOpenItem={(item) => {
                  alerts.markRead(item.id);
                  setView('bots');
                }}
                onMarkAllRead={alerts.markAllRead}
                onClear={alerts.clear}
                desktop={alerts.desktop}
                desktopSupported={alerts.desktopSupported}
                onEnableDesktop={() => void alerts.enableDesktop()}
                onDisableDesktop={alerts.disableDesktop}
                sound={alerts.sound}
                onToggleSound={alerts.toggleSound}
                onPreviewSound={alerts.previewSound}
              />
            <button className="icirc" onClick={toggleMode} title="Toggle light / dark" aria-label="Toggle theme">
                {mode === 'dark' ? '☀️' : '🌙'}
              </button>
            {fullscreen.supported && (
                <span className="fs-wrap">
                <button
                  className="icirc"
                  onClick={() => void fullscreen.toggle()}
                  title={fullscreen.active ? 'Exit full screen (Esc)' : 'Full screen'}
                  aria-label={fullscreen.active ? 'Exit full screen' : 'Enter full screen'}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    {fullscreen.active ? (
                      <path d="M6 1.5V6H1.5M10 14.5V10h4.5M10 1.5V6h4.5M6 14.5V10H1.5" />
                    ) : (
                      <path d="M1.5 6V1.5H6M14.5 6V1.5H10M1.5 10v4.5H6M14.5 10v4.5H10" />
                    )}
                  </svg>
                </button>
                {fullscreen.blocked && <span className="fs-hint">Your browser blocked full screen here — press F11</span>}
                </span>
              )}
          </div>
        </header>

      <div className="dash">
        {/* ── Header: brand left, date + last health check at the extreme right ── */}
        <div className="page-head">
          <div>
            <h1 className="page-title">{VIEW_TITLE[view][0]}</h1>
            <p className="page-sub">
              {VIEW_TITLE[view][1]} · {today ? new Date(`${today}T00:00:00`).toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) : '…'} · last check{' '}
              <span className="mono">{shownRefresh ? shownRefresh.toLocaleTimeString() : 'not yet'}</span>
            </p>
          </div>
          <div className="hdr-actions">
            <button
              className={`pill ${needsIpCount > 0 ? 'pill-on' : ''}`}
              onClick={() => setShowNeeds(true)}
              title="Comma-separated, copyable lists of SRD and bot storage accounts blocked by their firewall"
            >
              🔑 Needs IP {needsIpCount > 0 ? `(${needsIp.srd.length} SRD · ${needsIp.bot.length} bot)` : '(0)'}
            </button>
            <button
              className="pill"
              onClick={() => setConfirmRestart(true)}
              disabled={!!restartMsg}
              title="Restart the backend and fetch fresh data (takes 1-4 minutes)"
            >
              {restartMsg ? '↻ Restarting…' : '↻ Restart backend'}
            </button>
            <button
              className="btn-accent"
              onClick={() => {
                if (view === 'archive') void load(true);
                else if (view === 'bots') void bots.check('all', {});
                else if (view === 'dbs') void dbs.check('all', {});
                else {
                  void load(true); // archive
                  void bots.check('all', {});
                  void dbs.check('all', {});
                }
              }}
              disabled={
                !!restartMsg ||
                (view === 'archive'
                  ? loading
                  : view === 'bots'
                    ? bots.checking !== null || bots.loading
                    : view === 'dbs'
                      ? dbs.checking !== null || dbs.loading
                      : loading || bots.checking !== null || dbs.checking !== null || bots.loading || dbs.loading)
              }
              title={
                view === 'archive'
                  ? 'Run a fresh live scan now'
                  : 'Check everything on this tab now (nothing is checked until you ask)'
              }
            >
              {view === 'archive'
                ? loading
                  ? '⟳ Scanning…'
                  : '⟳ Refresh'
                : view === 'bots'
                  ? bots.checking === 'all'
                    ? '⟳ Checking…'
                    : '⟳ Check all bots'
                  : view === 'dbs'
                    ? dbs.checking === 'all'
                      ? '⟳ Checking…'
                      : '⟳ Check all databases'
                    : bots.checking === 'all' || dbs.checking === 'all'
                      ? '⟳ Checking…'
                      : '⟳ Check everything'}
            </button>
            </div>
        </div>

        {restartMsg && (
          <div className="banner banner-warm">
            ↻ {restartMsg} This takes 1-4 minutes — the dashboard updates automatically.
          </div>
        )}

        {view !== 'archive' && (
          <div className="flex flex-wrap items-center gap-2">
            {(['PRD', 'UAT', 'DEV'] as const).map((e) => (
              <button
                key={e}
                className={`pill ${infraEnv === e ? 'pill-on' : ''}`}
                onClick={() => setInfraEnv((cur) => (cur === e ? 'all' : e))}
                title={`Show only ${e === 'PRD' ? 'PROD' : e} ${view === 'customers' ? 'customers' : view === 'bots' ? 'bots' : 'databases'}`}
              >
                {e === 'PRD' ? 'PROD' : e} {envCounts[e]}
              </button>
            ))}
            {infraEnv !== 'all' && (
              <button className="pill" onClick={() => setInfraEnv('all')}>
                ✕ Clear filter
              </button>
            )}
          </div>
        )}

        {view === 'customers' && (
          <CustomersView
            rows={customerRows}
            loading={bots.loading || dbs.loading}
            botsChecking={bots.checking}
            dbsChecking={dbs.checking}
            onCheckBots={(id) => void bots.check(`sub:${id}`, { subscriptionId: id })}
            onCheckDbs={(id) => void dbs.check(`sub:${id}`, { subscriptionId: id })}
            today={today}
            egressIp={data?.egressIp}
            thresholds={{ storage: dbs.data?.storageThreshold ?? 75, dtu: dbs.data?.dtuThreshold ?? 90 }}
            archiveBusy={loading}
            onRefreshArchive={() => void load(true)}
          />
        )}

        {view === 'bots' && (
          <BotsView
            data={botsShown}
            loading={bots.loading}
            error={bots.error}
            checking={bots.checking}
            onCheck={bots.check}
            autoNext={bots.nextAuto}
          />
        )}
        {view === 'dbs' && (
          <DatabasesView
            data={dbsShown}
            loading={dbs.loading}
            error={dbs.error}
            checking={dbs.checking}
            onCheck={dbs.check}
            autoNext={dbs.nextAuto}
          />
        )}

        {view === 'archive' && (
          <>
        {error && (
          <div className="banner banner-err">
            <strong>Error:</strong> {error} — make sure the backend is running.
          </div>
        )}
        {data?.dateOverride && (
          <div className="banner banner-accent">
            🕒 Test mode — showing archive status for <span className="mono">{today}</span> (historical date). Remove{' '}
            <span className="mono">CHECK_DATE</span> from <span className="mono">backend/.env</span> to return to today.
          </div>
        )}
        {data?.warming && (
          <div className="banner banner-warm">
            ⏳ Warming up — running the first scan across all locations. The dashboard fills in automatically.
          </div>
        )}

        {/* ── Stat panel row (click a panel to filter the table) ── */}
        <div className="stat-row">
          {STAT_FILTERS.map((s) => (
            <StatPanel
              key={s.key}
              label={s.label}
              value={s.value}
              scope={s.scope}
              spark={s.spark}
              sparkColor={s.sparkColor}
              active={filter === s.key}
              onClick={() => {
                setAtRiskOnly(false);
                setFilter((f) => (f === s.key ? 'all' : s.key));
              }}
            />
          ))}
        </div>

        {/* ── Charts row ── */}
        <div className="chart-row">
          <Panel
            title={`Archive coverage · last 7 days${envScope ? ` · ${envScope === 'PRD' ? 'PROD' : envScope}` : ''}`}
            right={<span className="panel-legend">— archived · - - - monitorable ({counts.monitorable})</span>}
          >
            {counts.monitorable === 0 ? (
              <p className="panel-empty">No monitorable accounts in scope.</p>
            ) : (
              <CoverageChart series={series} monitorable={counts.monitorable} />
            )}
          </Panel>

          <Panel title={`Health today${envScope ? ` · ${envScope === 'PRD' ? 'PROD' : envScope}` : ''}`}>
            <Gauge pct={counts.pct} sub={`${counts.healthy} of ${counts.monitorable} with SRD`} />
            <button
              type="button"
              className={`prd-callout prd-click ${counts.prdAtRisk > 0 ? 'prd-bad' : 'prd-ok'} ${atRiskOnly ? 'prd-active' : ''}`}
              onClick={atRiskOnly ? () => setAtRiskOnly(false) : showAtRisk}
              disabled={counts.prdAtRisk === 0 && !atRiskOnly}
              title={
                atRiskOnly
                  ? 'Showing only the at-risk accounts — click to show all again'
                  : counts.prdAtRisk > 0
                    ? 'Show the accounts at risk (missing today or in error)'
                    : 'Nothing is at risk'
              }
            >
              <span className="prd-val mono">{counts.prdAtRisk > 0 ? counts.prdAtRisk : '✓'}</span>
              <span className="prd-label">{envScope === 'PRD' || !envScope ? 'PRD' : envScope} at risk</span>
              {(counts.prdAtRisk > 0 || atRiskOnly) && <span className="prd-go">{atRiskOnly ? '✕ clear' : 'view →'}</span>}
            </button>
          </Panel>
        </div>

        {/* ── Env filter pills ── */}
        <div className="flex flex-wrap items-center gap-2">
          {(['PRD', 'UAT', 'DEV'] as const).map((e) => {
            const c = watched.filter((r) => detectEnv(r.accountName) === e).length;
            return (
              <button
                key={e}
                className={`pill ${filter === e ? 'pill-on' : ''}`}
                onClick={() => setFilter((f) => (f === e ? 'all' : e))}
              >
                {e === 'PRD' ? 'PROD' : e} {c}
              </button>
            );
          })}
          {atRiskOnly && (
            <button className="pill pill-on" onClick={() => setAtRiskOnly(false)} title="Show all accounts again">
              ⚠ At risk only ✕
            </button>
          )}
          {filter !== 'all' && (
            <button
              className="pill"
              onClick={() => {
                setFilter('all');
                setAtRiskOnly(false);
              }}
            >
              ✕ Clear filter
            </button>
          )}
          <span className="ml-auto text-xs" style={{ color: 'var(--text-3)' }}>
            {loading && results.length === 0 ? 'Loading…' : `${rows.length} shown`}
          </span>
        </div>

        {/* ── Accounts table ── */}
        <div ref={tableRef} style={{ scrollMarginTop: 150 }}>
        <Panel
          title={`Accounts${atRiskOnly ? ' · at risk' : ''}${terms.length ? ` · watchlist (${terms.length})` : ''}`}
          bodyClass="panel-bd-flush"
        >
          {loading && results.length === 0 ? (
            <p className="panel-empty">Loading storage accounts…</p>
          ) : rows.length === 0 ? (
            <p className="panel-empty">
              {terms.length ? 'No accounts match this watchlist and filter.' : 'No accounts match this filter.'}
            </p>
          ) : (
            <AccountTable results={rows} onSelect={(r) => setSelected(r.accountName)} />
          )}
        </Panel>
        </div>
          </>
        )}
        <footer className="dash-foot">
          NTR-X Azure Dashboard · NTRX AppOps · bots and databases re-check every 15 min while this page is open
        </footer>
      </div>
        </div>

      {confirmRestart && (
        <SidePanel
          title="Restart backend?"
          subtitle="Fetch fresh data from Azure"
          width={400}
          onClose={() => setConfirmRestart(false)}
          footer={
            <div className="sheet-buttons">
              <button className="pill" onClick={() => setConfirmRestart(false)}>
                Cancel
              </button>
              <button
                className="btn-accent"
                onClick={() => {
                  setConfirmRestart(false);
                  void restart();
                }}
              >
                ↻ Restart now
              </button>
            </div>
          }
        >
          <div className="sheet-empty" style={{ paddingTop: 8 }}>
            <div className="sheet-empty-ico">↻</div>
            <p>This restarts the whole backend and re-reads everything.</p>
            <p className="sheet-empty-sub">
              The dashboard shows “warming up” for about <strong>1–4 minutes</strong> and then fills in by itself. Bot and
              database checks start empty again after a restart.
            </p>
          </div>
        </SidePanel>
      )}

      <Toasts toasts={alerts.toasts} onClose={alerts.dismissToast} onOpen={() => setView('bots')} />

      {showNeeds && <NeedsIpPanel needs={needsIp} egressIp={data?.egressIp} onClose={() => setShowNeeds(false)} />}

      {selectedAccount && (
        <DetailDrawer account={selectedAccount} today={today} egressIp={data?.egressIp} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
