import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BotsResponse, CheckResponse, CheckResult, DatabasesResponse, Status } from './types';
import { fetchCheck, fetchHealth, restartBackend, fetchBots, checkBots, fetchDatabases, checkDatabases, fetchMe, firstName, type Me } from './lib/api';
import { findNeedsIp } from './lib/needsIp';
import { useOnDemand } from './lib/useOnDemand';
import { isDownState } from './lib/instanceState';
import { useAlerts } from './lib/useAlerts';
import { unlockAudio } from './lib/chime';
import { useFullscreen } from './lib/useFullscreen';
import { NotificationBell, Toasts } from './components/Notifications';
import SidePanel from './components/SidePanel';
import { detectEnv } from './lib/ui';
import { MODE_LABEL, useTheme } from './lib/theme';
import { coverageSeries, isMonitorable } from './lib/history';
import { loadGroups, saveGroups, type WatchGroup } from './lib/watchlist';
import { Panel, StatPanel, CoverageChart, Gauge } from './components/panels';
import WatchlistSearch, { type CustomerSuggestion } from './components/WatchlistSearch';
import { matchesWatch, matchesFilter, envOf, customerOf, type EnvName } from './lib/watchMatch';
import AccountTable from './components/AccountTable';
import DetailDrawer from './components/DetailDrawer';
import CustomerDetail from './components/CustomerDetail';
import SettingsPanel from './components/SettingsPanel';
import { everyLabel, getSettings, useApplySettings, useSettings } from './lib/settings';
import { smooth } from './lib/transition';
import NeedsIpPanel from './components/NeedsIpPanel';
import BotsView from './components/BotsView';
import DatabasesView, { type DbScope } from './components/DatabasesView';
import CustomersView from './components/CustomersView';
import { buildCustomerRows } from './lib/customers';
import type { BotScope } from './components/BotGroups';

const RESTART_WAIT_MS = 10 * 60_000;
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
type Filter = 'all' | Status | 'PRD' | 'UAT' | 'DEV';
type View = 'archive' | 'customers' | 'bots' | 'dbs';
// Scope of the automatic 15-minute re-check on the Cloud Instances / Databases tabs: everything.
const ALL_BOTS: BotScope = {};
const ALL_DBS: DbScope = {};

/** "Good morning" / "Good afternoon" / "Good evening" from the local time. */
function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

const VIEW_TITLE: Record<View, string> = { customers: 'Customers', archive: 'Archive', bots: 'Cloud Instances', dbs: 'Databases' };
const NAV: { view: View; label: string; short: string; icon: string }[] = [
  { view: 'customers', label: 'Customers', short: 'Customers', icon: 'M17 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 5 18.5V20M11 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19 20v-1.2a3 3 0 0 0-2.2-2.9M16 5.2a3.4 3.4 0 0 1 0 6.6' },
  { view: 'archive', label: 'Archive', short: 'Archive', icon: 'M3.5 7.5h17v3h-17zM5 10.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8.5M10 14h4' },
  { view: 'bots', label: 'Cloud Instances', short: 'Cloud', icon: 'M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4.25 4.25 0 0 1-.5 8.5Z' },
  { view: 'dbs', label: 'Databases', short: 'Data', icon: 'M12 10c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3ZM4 7v5c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12v5c0 1.7 3.6 3 8 3s8-1.3 8-3v-5' },
];

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
  const [customerDetail, setCustomerDetail] = useState<{ key: string; account: string | null } | null>(null); // customer opened from the Customers tab
  const { mode, next, setMode, toggleMode } = useTheme();
  const settings = useSettings();
  useApplySettings(settings);
  const [showSettings, setShowSettings] = useState(false);
  // switching tabs cross-fades and starts at the top of the new tab
  const goTo = (v: View) => {
    if (v === view) return;
    smooth(() => {
      setView(v);
      window.scrollTo(0, 0);
    });
  };
  const [sideOpen, setSideOpen] = useState(false);
  const [peek, setPeek] = useState(false); // sidebar "on hover" mode: slid out
  const peekTimer = useRef<number | undefined>(undefined);
  const peekOn = () => {
    window.clearTimeout(peekTimer.current);
    setPeek(true);
  };
  const peekOff = () => {
    window.clearTimeout(peekTimer.current);
    peekTimer.current = window.setTimeout(() => setPeek(false), 320); // small delay: crossing a gap never closes it
  };
  const [backendStarted, setBackendStarted] = useState<string | null>(null);
  useEffect(() => {
    fetchHealth()
      .then((h) => setBackendStarted(h.startedAt))
      .catch(() => undefined);
  }, []);
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    let stop = false;
    const tryLoad = (n: number) =>
      fetchMe()
        .then((m) => (m.email || m.name ? !stop && setMe(m) : n < 5 && !stop && setTimeout(() => tryLoad(n + 1), 5000)))
        .catch(() => n < 5 && !stop && setTimeout(() => tryLoad(n + 1), 5000));
    tryLoad(0);
    return () => {
      stop = true;
    };
  }, []);
  const who = firstName(me);
  const abortRef = useRef<AbortController | null>(null);
  const [restartMsg, setRestartMsg] = useState<string | null>(null);
  const [showNeeds, setShowNeeds] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [view, setView] = useState<View>(() => getSettings().defaultTab);
  // Environment filter shared by the Cloud Instances and Databases tabs.
  const [infraEnv, setInfraEnv] = useState<EnvName | 'all'>('all');
  // Bots + databases are on demand: nothing is fetched until their tab is opened / a check is run.
  const bots = useOnDemand<BotsResponse, BotScope>(fetchBots, checkBots, ALL_BOTS, settings.autoMinutes * 60_000);
  const dbs = useOnDemand<DatabasesResponse, DbScope>(fetchDatabases, checkDatabases, ALL_DBS, settings.autoMinutes * 60_000);
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
    return () => abortRef.current?.abort();
  }, [load]);

  // The archive / bot-storage scan repeats on the same schedule as the bot and database re-checks (Settings → Auto
  // re-check). It forces a live scan: a plain load would only re-read the backend's cached snapshot, which the backend
  // refreshes on its own (15 min) schedule, so a shorter interval would otherwise show the same data again.
  useEffect(() => {
    if (settings.autoMinutes <= 0) return;
    const id = setInterval(() => load(true), settings.autoMinutes * 60_000);
    return () => clearInterval(id);
  }, [load, settings.autoMinutes]);

  // While the backend's first scan runs, poll quickly until data arrives.
  useEffect(() => {
    if (!data?.warming) return;
    const t = setTimeout(() => load(), 4000);
    return () => clearTimeout(t);
  }, [data, load]);

  // Browsers only allow sound after the user has touched the page: unlock audio on the first click / key press.
  useEffect(() => {
    // stays registered: any later click also re-wakes an audio context the browser suspended
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // Ctrl/Cmd + K jumps to the search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('.wl input')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
    return results.filter((r) => matchesFilter(r.accountName, terms, draft));
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
      cloudServices: bots.data.cloudServices.filter((c) => matchesFilter(c.name, terms, draft)),
      instances: bots.data.instances.filter((i) => matchesFilter(i.cloudService, terms, draft)),
    };
  }, [bots.data, terms, draft, filtering]);
  const dbsWatched = useMemo<DatabasesResponse | null>(() => {
    if (!dbs.data || !filtering) return dbs.data;
    return { ...dbs.data, databases: dbs.data.databases.filter((d) => matchesFilter(d.server, terms, draft)) };
  }, [dbs.data, terms, draft, filtering]);

  // Every customer we know about (from accounts, bots and databases), for the search suggestions.
  const suggestions = useMemo<CustomerSuggestion[]>(() => {
    const m = new Map<string, { srd: number; bots: number; dbs: Set<string>; inGroup: boolean }>();
    const at = (name: string) => {
      const code = customerOf(name);
      let e = m.get(code);
      if (!e) m.set(code, (e = { srd: 0, bots: 0, dbs: new Set(), inGroup: false }));
      if (terms.length > 0 && matchesWatch(name, terms)) e.inGroup = true;
      return e;
    };
    for (const r of results) at(r.accountName).srd++;
    for (const c of bots.data?.cloudServices ?? []) at(c.name).bots++;
    for (const d of dbs.data?.databases ?? []) at(d.server).dbs.add(d.server);
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
  // "Last health check" = when the data on screen was actually gathered: the newest of what this page fetched itself and
  // the times the backend stamped on the results (so it moves on every refresh, and also shows for data that was already
  // checked before the page was opened). The Customers tab shows the newest of archive, bots and databases.
  const newest = (...times: (Date | string | null | undefined)[]): Date | null => {
    let best: Date | null = null;
    for (const t of times) {
      if (!t) continue;
      const d = t instanceof Date ? t : new Date(t);
      if (!Number.isNaN(d.getTime()) && (!best || d.getTime() > best.getTime())) best = d;
    }
    return best;
  };
  const archiveAt = newest(lastRefresh, data?.warming ? null : data?.generatedAt);
  const botsAt = newest(bots.lastCheck, ...(bots.data?.cloudServices.map((c) => c.checkedAt) ?? []));
  const dbsAt = newest(dbs.lastCheck, ...(dbs.data?.databases.map((d) => d.checkedAt) ?? []));
  const shownRefresh = view === 'archive' ? archiveAt : view === 'bots' ? botsAt : view === 'dbs' ? dbsAt : newest(archiveAt, botsAt, dbsAt);
  const refreshLabel = (d: Date | null): string => {
    if (!d) return 'not yet';
    const sameDay = d.toDateString() === new Date().toDateString();
    return sameDay ? d.toLocaleTimeString() : `${d.toLocaleDateString([], { day: '2-digit', month: 'short' })} ${d.toLocaleTimeString()}`;
  };

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

  const customerDetailRow = customerDetail ? (customerRows.find((r) => r.key === customerDetail.key) ?? null) : null;
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

  return (
    <div className={`page ${settings.sidebar !== 'pinned' && (peek || sideOpen) ? 'page-shift' : ''}`}>
      <div className={`side-zone ${peek ? 'zone-off' : ''}`} onMouseEnter={peekOn} onMouseLeave={peekOff} aria-hidden />
      <aside
        className={`side-nav ${sideOpen ? 'side-open' : ''} ${peek ? 'side-peek' : ''}`}
        onMouseEnter={peekOn}
        onMouseLeave={peekOff}
        aria-label="Sections"
      >
        <span className="brand-mark side-logo" title="Godzilla Health Monitor · NTRX AppOps" aria-hidden>
          <svg width="24" height="24" viewBox="0 0 64 64">
            <path d="M6 38 L18 38 L24 22 L31 48 L38 14 L45 42 L50 38 L58 38" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <nav className="side-items">
          {NAV.map((n) => (
            <button key={n.view} className={`side-item ${view === n.view ? 'side-on' : ''}`} onClick={() => { goTo(n.view); setSideOpen(false); setPeek(false); }} title={n.label} aria-label={n.label}>
              <span className="side-ico">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d={n.icon} />
                </svg>
                {n.view === 'bots' && botIssues > 0 && <span className="tab-badge side-badge">{botIssues}</span>}
                {n.view === 'dbs' && dbIssues > 0 && <span className="tab-badge side-badge">{dbIssues}</span>}
              </span>
              <span className="side-label">{n.short}</span>
            </button>
          ))}
        </nav>
        <button className="side-item side-gear" onClick={() => { setShowSettings(true); setSideOpen(false); setPeek(false); }} title="Settings" aria-label="Settings">
          <span className="side-ico">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.03Z" />
            </svg>
          </span>
          <span className="side-label">Settings</span>
        </button>
        <span className="side-live" title="NTRX AppOps · live">
          <span className="dot pulse" style={{ background: 'var(--ok)', width: 8, height: 8 }} />
          <span>live</span>
        </span>
      </aside>

      <div className="dash">
        {/* ── Header: brand left, date + last health check at the extreme right ── */}
        <header className="hdr">
          <div className="hdr-top">
            <button className="icirc hdr-burger" onClick={() => setSideOpen((o) => !o)} aria-label="Show or hide the menu" title="Show or hide the menu">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            <div className="page-title">
              {settings.greeting && <span className="page-eyebrow">{VIEW_TITLE[view]}</span>}
              <h1>
                {settings.greeting ? (
                  <>
                    {greeting()}
                    {who ? `, ${who}` : ''}! <span className="wave">👋</span>
                  </>
                ) : (
                  VIEW_TITLE[view]
                )}
              </h1>
              <p className="page-sub">
                <span className="mono">
                  {today ? new Date(`${today}T00:00:00`).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '…'}
                </span>
                <span className="page-sep">·</span>
                last health check{' '}
                <span className="mono" style={{ color: 'var(--text-2)', fontWeight: 700 }}>
                  {refreshLabel(shownRefresh)}
                </span>
                {data?.egressIp && (
                  <>
                    <span className="page-sep">·</span>src <span className="mono">{data.egressIp}</span>
                  </>
                )}
              </p>
            </div>

            <div className="hdr-meta">
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
              <span className="hdr-icons">
              <NotificationBell
                items={alerts.items}
                unread={alerts.unread}
                onOpenItem={(item) => {
                  alerts.markRead(item.id);
                  goTo('bots');
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
              <button className="icirc" onClick={toggleMode} title={`Theme: ${MODE_LABEL[mode]} — click for ${MODE_LABEL[next]} (more in Settings)`} aria-label="Switch theme">
                🎨
              </button>
              <button className="icirc" onClick={() => setShowSettings(true)} title="Settings" aria-label="Settings">
                ⚙️
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
              </span>
              {me && (
                <span className="hdr-user" title={me.email ?? ''}>
                  <span className="hdr-avatar">{(who ?? '?').charAt(0)}</span>
                  <span className="hdr-user-text">
                    <b>{who}</b>
                    <small>{me.email}</small>
                  </span>
                </span>
              )}
            </div>
          </div>
        </header>

        {restartMsg && (
          <div className="banner banner-warm">
            ↻ {restartMsg} This takes 1-4 minutes — the dashboard updates automatically.
          </div>
        )}
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
            archiveWarming={!!data?.warming}
            loading={bots.loading || dbs.loading}
            botsChecking={bots.checking}
            dbsChecking={dbs.checking}
            onCheckBots={(id) => void bots.check(`sub:${id}`, { subscriptionId: id })}
            onCheckDbs={(id) => void dbs.check(`sub:${id}`, { subscriptionId: id })}
            onOpenCustomer={(r, account) => setCustomerDetail({ key: r.key, account: account ?? null })}
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
          Godzilla Health Monitor · NTRX AppOps · bots and databases re-check {everyLabel(settings.autoMinutes)} while this page is open
        </footer>
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

      <Toasts toasts={alerts.toasts} onClose={alerts.dismissToast} onOpen={() => goTo('bots')} />

      {showNeeds && <NeedsIpPanel needs={needsIp} egressIp={data?.egressIp} onClose={() => setShowNeeds(false)} />}

      {showSettings && (
        <SettingsPanel
          settings={settings}
          mode={mode}
          setMode={setMode}
          alerts={{
            sound: alerts.sound,
            toggleSound: alerts.toggleSound,
            previewSound: () => void alerts.previewSound(),
            desktop: alerts.desktop,
            desktopSupported: alerts.desktopSupported,
            enableDesktop: () => void alerts.enableDesktop(),
            disableDesktop: alerts.disableDesktop,
            clear: alerts.clear,
            count: alerts.items.length,
          }}
          account={{ name: who, email: me?.email ?? null, egressIp: data?.egressIp, backendStarted }}
          onClose={() => setShowSettings(false)}
        />
      )}

      {customerDetailRow && (
        <CustomerDetail
          row={customerDetailRow}
          archiveWarming={!!data?.warming}
          accountName={customerDetail?.account ?? null}
          onSwitch={(account) => setCustomerDetail({ key: customerDetailRow.key, account })}
          today={today}
          bots={bots.data}
          dbs={dbs.data}
          botsBusy={bots.checking === `sub:${customerDetailRow.subscriptionId}`}
          dbsBusy={dbs.checking === `sub:${customerDetailRow.subscriptionId}`}
          checkDisabled={{ bots: bots.checking !== null, dbs: dbs.checking !== null }}
          onCheckBots={() => void bots.check(`sub:${customerDetailRow.subscriptionId}`, { subscriptionId: customerDetailRow.subscriptionId })}
          onCheckDbs={() => void dbs.check(`sub:${customerDetailRow.subscriptionId}`, { subscriptionId: customerDetailRow.subscriptionId })}
          onClose={() => setCustomerDetail(null)}
        />
      )}

      {selectedAccount && (
        <DetailDrawer account={selectedAccount} today={today} egressIp={data?.egressIp} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
