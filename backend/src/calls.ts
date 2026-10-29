import { ResourceGraphClient } from '@azure/arm-resourcegraph';
import type { TokenCredential } from '@azure/identity';
import { graphAll } from './azure.js';
import { kqlString } from './security.js';

/**
 * Concurrent calls per bot, read from the bots' own Application Insights (`botAppInsights*`, one per recording group, in the
 * customer's subscription). The bot reports "Concurrent Call Count" about every 20 seconds as a custom metric.
 *
 * ON DEMAND ONLY: nothing here runs at start-up or on a timer. It runs when someone asks for one customer (one subscription),
 * because a recording group's logs hold hundreds of thousands of readings and there are well over a hundred of them.
 */
export const CALLS = 'Concurrent Call Count';
export const CALLS_GROSS = 'Concurrent Call Count (Gross)';
export const LOAD = 'Concurrent Streams (% Load)';
const METRICS = [CALLS, CALLS_GROSS, LOAD];
export const HOUR_CHOICES = [1, 6, 24];
const MAX_GROUPS = 20;
const ARM = 'https://management.azure.com';
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isGuid = (v: unknown): v is string => typeof v === 'string' && GUID_RE.test(v);

export interface CallInstance {
  instance: string;
  /** Latest reading of each metric (null = never reported in the window). */
  calls: number | null;
  gross: number | null;
  load: number | null;
  peak: number | null;
  avg: number | null;
  lastSeen: string | null;
}

export interface CallGroup {
  name: string;
  resourceGroup: string;
  /** Sum over the group's bot instances. */
  calls: number | null;
  peak: number | null;
  load: number | null;
  lastSeen: string | null;
  instances: CallInstance[];
  /** Total concurrent calls over time (points oldest first). */
  series: { t: string; v: number }[];
  error?: string;
}

export interface CallsResponse {
  subscriptionId: string;
  hours: number;
  generatedAt: string;
  groups: CallGroup[];
  note?: string;
}

// ---------------------------------------------------------------- queries (hours is a validated number, never user text)

/** The newest time slot is still filling up: with only part of its readings it would draw as a false drop. */
export function dropIncompleteSlot<T extends { t: string }>(points: T[], slotMs: number, now = Date.now()): T[] {
  const last = points[points.length - 1];
  return last && points.length > 1 && Date.parse(last.t) + slotMs > now ? points.slice(0, -1) : points;
}

export function summaryQuery(hours: number): string {
  return (
    `customMetrics | where timestamp > ago(${hours}h) and name in (${METRICS.map(kqlString).join(', ')}) ` +
    `| summarize arg_max(timestamp, value), peak=max(value), avg=avg(value) by name, cloud_RoleInstance`
  );
}

export function seriesQuery(hours: number): string {
  const binMin = Math.max(1, Math.round((hours * 60) / 30));
  return (
    `customMetrics | where timestamp > ago(${hours}h) and name == ${kqlString(CALLS)} ` +
    `| summarize v=avg(value) by bin(timestamp, ${binMin}m), cloud_RoleInstance ` +
    `| summarize total=sum(v) by timestamp | order by timestamp asc`
  );
}

interface Table {
  Columns: { ColumnName: string }[];
  Rows: unknown[][];
}

/** The App Insights REST answer -> plain row objects. */
export function rows(body: unknown): Record<string, unknown>[] {
  const t = (body as { Tables?: Table[] } | null)?.Tables?.[0];
  if (!t) return [];
  const names = t.Columns.map((c) => c.ColumnName);
  return t.Rows.map((r) => Object.fromEntries(names.map((n, i) => [n, r[i]])));
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round = (v: number | null, d = 1): number | null => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);

/** Summary rows (one per metric and bot instance) -> one entry per bot instance, plus the group totals. */
export function shapeGroup(name: string, resourceGroup: string, summary: Record<string, unknown>[], series: Record<string, unknown>[]): CallGroup {
  const by = new Map<string, CallInstance>();
  for (const r of summary) {
    const key = String(r.cloud_RoleInstance ?? '');
    const inst = by.get(key) ?? { instance: key || '(unnamed)', calls: null, gross: null, load: null, peak: null, avg: null, lastSeen: null };
    const value = num(r.value);
    const when = typeof r.timestamp === 'string' ? r.timestamp : null;
    if (when && (!inst.lastSeen || when > inst.lastSeen)) inst.lastSeen = when;
    if (r.name === CALLS) {
      inst.calls = value;
      inst.peak = num(r.peak);
      inst.avg = round(num(r.avg));
    } else if (r.name === CALLS_GROSS) inst.gross = value;
    else if (r.name === LOAD) inst.load = round(value);
    by.set(key, inst);
  }
  const instances = [...by.values()].sort((a, b) => (b.calls ?? -1) - (a.calls ?? -1) || a.instance.localeCompare(b.instance));
  const sum = (f: (i: CallInstance) => number | null): number | null => {
    const v = instances.map(f).filter((x): x is number => x !== null);
    return v.length ? v.reduce((a, b) => a + b, 0) : null;
  };
  const loads = instances.map((i) => i.load).filter((x): x is number => x !== null);
  const pts = series.map((r) => ({ t: String(r.timestamp), v: num(r.total) ?? 0 }));
  return {
    name,
    resourceGroup,
    calls: sum((i) => i.calls),
    // the busiest moment of the whole group (sum across instances per bin), not the sum of each instance's own peak
    peak: pts.length ? Math.max(...pts.map((p) => p.v)) : sum((i) => i.peak),
    load: loads.length ? round(Math.max(...loads)) : null,
    lastSeen: instances.map((i) => i.lastSeen).filter((x): x is string => !!x).sort().pop() ?? null,
    instances,
    series: pts,
  };
}

// ---------------------------------------------------------------- Azure calls

interface Insights {
  id: string;
  name: string;
  resourceGroup: string;
}

/** Which bot Application Insights a subscription has changes rarely: remember the answer for 10 minutes. */
const insightsCache = new Map<string, { at: number; list: Promise<Insights[]> }>();
const INSIGHTS_TTL_MS = 10 * 60_000;

export function findBotInsights(cred: TokenCredential, subscriptionId: string): Promise<Insights[]> {
  const hit = insightsCache.get(subscriptionId);
  if (hit && Date.now() - hit.at < INSIGHTS_TTL_MS) return hit.list;
  const list = lookupBotInsights(cred, subscriptionId);
  insightsCache.set(subscriptionId, { at: Date.now(), list });
  list.catch(() => insightsCache.delete(subscriptionId)); // never remember a failure
  return list;
}

async function lookupBotInsights(cred: TokenCredential, subscriptionId: string): Promise<Insights[]> {
  const graph = new ResourceGraphClient(cred);
  const found = await graphAll(
    graph,
    `Resources | where type =~ 'microsoft.insights/components' and name startswith 'botAppInsights' | project id, name, resourceGroup | order by resourceGroup asc`,
    [subscriptionId],
  );
  return found.map((r) => ({ id: r.id!, name: r.name!, resourceGroup: r.resourceGroup! }));
}

class Denied extends Error {}

async function insightsQuery(cred: TokenCredential, id: string, query: string, hours: number): Promise<unknown> {
  const token = await cred.getToken(`${ARM}/.default`);
  if (!token) throw new Error('no token');
  const res = await fetch(`${ARM}${id}/api/query?api-version=2014-12-01-preview`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, timespan: `PT${hours}H` }),
    signal: AbortSignal.timeout(40_000),
  });
  if (res.status === 401 || res.status === 403) throw new Denied();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** The concurrent-call picture of one customer: every bot recording group in the subscription. */
export async function checkCalls(cred: TokenCredential, subscriptionId: string, hours: number): Promise<CallsResponse> {
  const all = await findBotInsights(cred, subscriptionId);
  const targets = all.slice(0, MAX_GROUPS);
  const groups: CallGroup[] = new Array(targets.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, targets.length) }, async () => {
      while (next < targets.length) {
        const i = next++;
        const t = targets[i]!;
        try {
          const [summary, series] = await Promise.all([insightsQuery(cred, t.id, summaryQuery(hours), hours), insightsQuery(cred, t.id, seriesQuery(hours), hours)]);
          const g = shapeGroup(t.name, t.resourceGroup, rows(summary), rows(series));
          const kept = dropIncompleteSlot(g.series, Math.max(1, Math.round((hours * 60) / 30)) * 60_000);
          groups[i] = kept === g.series ? g : { ...g, series: kept, peak: kept.length ? Math.max(...kept.map((p) => p.v)) : g.peak };
        } catch (err) {
          groups[i] = { ...shapeGroup(t.name, t.resourceGroup, [], []), error: err instanceof Denied ? 'No permission to read this Application Insights.' : 'Could not read this Application Insights right now.' };
        }
      }
    }),
  );
  return {
    subscriptionId,
    hours,
    generatedAt: new Date().toISOString(),
    groups,
    note: all.length > MAX_GROUPS ? `Showing the first ${MAX_GROUPS} of ${all.length} recording groups.` : all.length === 0 ? 'No bot Application Insights (botAppInsights…) found in this subscription.' : undefined,
  };
}

// ---------------------------------------------------------------- time series for the Concurrent Calls tab

/**
 * What the bots report. The browser only ever sends one of these KEYS; the metric name that goes into the query comes from here,
 * so no user text reaches the query.
 */
export const METRIC_NAMES: Record<string, string> = {
  calls: 'Concurrent Call Count',
  gross: 'Concurrent Call Count (Gross)',
  load: 'Concurrent Streams (% Load)',
  audio: 'Total Audio Streams',
  video: 'Total Video Streams',
  vbss: 'Total Vbss Streams',
  files: 'Number of File Streams',
  participants: 'Number of Recorded Participants',
  discarded: 'Total Unlicensed discarded calls',
  setup: 'Average Time Until Call Established In Milliseconds',
  joined: 'Average Time Until Recorded Participant Joined In Milliseconds',
  media: 'Total Media Bytes in local storage',
};
export const AGGS = ['max', 'avg', 'min'] as const;
export type Agg = (typeof AGGS)[number];
/** Ranges the tab offers; longer ones use wider bins so a chart always has about 70 points. */
export const RANGE_HOURS = [1, 6, 24, 72, 168];

export const binMinutes = (hours: number): number => Math.max(1, Math.round((hours * 60) / 72));

export function timeSeriesQuery(metric: string, hours: number, agg: Agg): string {
  const name = Object.hasOwn(METRIC_NAMES, metric) ? METRIC_NAMES[metric] : undefined;
  if (!name || !AGGS.includes(agg)) throw new Error('bad metric or aggregation');
  return (
    `customMetrics | where timestamp > ago(${hours}h) and name == ${kqlString(name)} ` +
    `| summarize v=${agg}(value), t=max(timestamp) by bin(timestamp, ${binMinutes(hours)}m), cloud_RoleInstance ` +
    `| order by timestamp asc | take 40000`
  );
}

export interface SeriesGroup {
  name: string;
  resourceGroup: string;
  error?: string;
  /** Bot instances that reported, and for each the time of its last reading. */
  instances: string[];
  lastSeen: (string | null)[];
  /** Bin start times, oldest first. */
  times: string[];
  /** [time index, instance index, value] */
  cells: [number, number, number][];
}

export interface SeriesResponse {
  subscriptionId: string;
  hours: number;
  bin: number;
  metric: string;
  agg: Agg;
  generatedAt: string;
  groups: SeriesGroup[];
  note?: string;
}

export function shapeSeries(name: string, resourceGroup: string, data: Record<string, unknown>[]): SeriesGroup {
  const times: string[] = [];
  const timeIx = new Map<string, number>();
  const instances: string[] = [];
  const instIx = new Map<string, number>();
  const lastSeen: (string | null)[] = [];
  const cells: [number, number, number][] = [];
  for (const r of data) {
    const ts = typeof r.timestamp === 'string' ? r.timestamp : null;
    const v = num(r.v);
    if (!ts || v === null) continue;
    const inst = String(r.cloud_RoleInstance ?? '') || '(unnamed)';
    let ti = timeIx.get(ts);
    if (ti === undefined) {
      ti = times.length;
      times.push(ts);
      timeIx.set(ts, ti);
    }
    let ii = instIx.get(inst);
    if (ii === undefined) {
      ii = instances.length;
      instances.push(inst);
      instIx.set(inst, ii);
      lastSeen.push(null);
    }
    const seen = typeof r.t === 'string' ? r.t : ts;
    if (!lastSeen[ii] || seen > lastSeen[ii]!) lastSeen[ii] = seen;
    cells.push([ti, ii, Math.round(v * 100) / 100]);
  }
  // the query is ordered by time, but make sure of it: the chart relies on it
  const order = times.map((t, i) => [t, i] as const).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (order.some(([, i], k) => i !== k)) {
    const remap = new Map(order.map(([, i], k) => [i, k]));
    return { name, resourceGroup, instances, lastSeen, times: order.map(([t]) => t), cells: cells.map(([t, i, v]) => [remap.get(t)!, i, v]) };
  }
  return { name, resourceGroup, instances, lastSeen, times, cells };
}

/** Drop the newest time slot of a series while it is still filling up (see dropIncompleteSlot). */
export function trimNewestSlot(g: SeriesGroup, slotMs: number, now = Date.now()): SeriesGroup {
  const n = g.times.length;
  if (n < 2 || Date.parse(g.times[n - 1]!) + slotMs <= now) return g;
  return { ...g, times: g.times.slice(0, -1), cells: g.cells.filter(([ti]) => ti < n - 1) };
}

export async function checkSeries(cred: TokenCredential, subscriptionId: string, hours: number, metric: string, agg: Agg): Promise<SeriesResponse> {
  const all = await findBotInsights(cred, subscriptionId);
  const targets = all.slice(0, MAX_GROUPS);
  const query = timeSeriesQuery(metric, hours, agg);
  const groups: SeriesGroup[] = new Array(targets.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, targets.length) }, async () => {
      while (next < targets.length) {
        const i = next++;
        const t = targets[i]!;
        try {
          groups[i] = trimNewestSlot(shapeSeries(t.name, t.resourceGroup, rows(await insightsQuery(cred, t.id, query, hours))), binMinutes(hours) * 60_000);
        } catch (err) {
          groups[i] = { ...shapeSeries(t.name, t.resourceGroup, []), error: err instanceof Denied ? 'No permission to read this Application Insights.' : 'Could not read this Application Insights right now.' };
        }
      }
    }),
  );
  return {
    subscriptionId,
    hours,
    bin: binMinutes(hours),
    metric,
    agg,
    generatedAt: new Date().toISOString(),
    groups,
    note: all.length > MAX_GROUPS ? `Showing the first ${MAX_GROUPS} of ${all.length} recording groups.` : all.length === 0 ? 'No bot Application Insights (botAppInsights…) found in this subscription.' : undefined,
  };
}
