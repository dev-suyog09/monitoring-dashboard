/**
 * Concurrent Calls tab: data model. Everything here is on demand: the only network call is `fetchSeries`, made when the user
 * presses Load (or changes a filter after a load), never at start-up.
 */

export interface MetricDef {
  key: string;
  label: string;
  unit: string;
  /** How bot instances add up to a recording group / customer. */
  combine: 'sum' | 'max' | 'avg';
  blurb: string;
  /** Multiply raw values by this (bytes -> MB). */
  scale?: number;
}

export const METRICS: MetricDef[] = [
  { key: 'calls', label: 'Concurrent calls', unit: '', combine: 'sum', blurb: 'Calls being recorded at the same time' },
  { key: 'gross', label: 'Concurrent calls (gross)', unit: '', combine: 'sum', blurb: 'Including calls still being set up or wrapped up' },
  { key: 'load', label: 'Stream load', unit: '%', combine: 'max', blurb: 'How full a bot is (the busiest bot is shown)' },
  { key: 'audio', label: 'Audio streams', unit: '', combine: 'sum', blurb: 'Audio streams being recorded' },
  { key: 'video', label: 'Video streams', unit: '', combine: 'sum', blurb: 'Video streams being recorded' },
  { key: 'vbss', label: 'Screen-share streams', unit: '', combine: 'sum', blurb: 'Video-based screen sharing streams' },
  { key: 'files', label: 'File streams', unit: '', combine: 'sum', blurb: 'File streams' },
  { key: 'participants', label: 'Recorded participants', unit: '', combine: 'sum', blurb: 'People being recorded right now' },
  { key: 'discarded', label: 'Unlicensed discarded calls', unit: '', combine: 'sum', blurb: 'Calls dropped for lack of a licence' },
  { key: 'setup', label: 'Call setup time', unit: 'ms', combine: 'avg', blurb: 'Average time until a call was established' },
  { key: 'joined', label: 'Participant join time', unit: 'ms', combine: 'avg', blurb: 'Average time until a participant joined' },
  { key: 'media', label: 'Media in local storage', unit: 'MB', combine: 'sum', blurb: 'Recording data waiting on the bots', scale: 1 / 1_048_576 },
];
export const metricOf = (key: string): MetricDef => METRICS.find((m) => m.key === key) ?? METRICS[0]!;

export const RANGES: { hours: number; label: string }[] = [
  { hours: 1, label: '1 hour' },
  { hours: 6, label: '6 hours' },
  { hours: 24, label: '24 hours' },
  { hours: 72, label: '3 days' },
  { hours: 168, label: '7 days' },
];
export const AGG_LABEL: Record<string, string> = { max: 'Max', avg: 'Avg', min: 'Min' };

/** Series colours, in order. */
export const PALETTE = ['#6aa8ff', '#4cc9a0', '#e5b95c', '#ef8b9a', '#a99bf0', '#f0a06a', '#5ec8c0', '#e58bbd', '#9aa7b8', '#9bc15a'];

// ---------------------------------------------------------------- API

export interface SeriesGroup {
  name: string;
  resourceGroup: string;
  error?: string;
  instances: string[];
  lastSeen: (string | null)[];
  times: string[];
  cells: [number, number, number][];
}
export interface SeriesResponse {
  subscriptionId: string;
  hours: number;
  bin: number;
  metric: string;
  agg: string;
  generatedAt: string;
  groups: SeriesGroup[];
  note?: string;
}

export interface CustomerOption {
  subscriptionId: string;
  /** "ADC · PRD" */
  label: string;
  /** Bots known for it (when the Cloud tab has listed them), to help picking. */
  bots?: number;
}

export async function fetchSeries(sub: string, hours: number, metric: string, agg: string): Promise<SeriesResponse> {
  const q = new URLSearchParams({ subscriptionId: sub, hours: String(hours), metric, agg });
  const res = await fetch(`/api/calls/series?${q}`, { method: 'POST', headers: { 'X-SAM-Request': '1' } });
  const json = (await res.json().catch(() => ({}))) as SeriesResponse & { error?: string };
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

// ---------------------------------------------------------------- model

export interface Bot {
  id: string;
  customerKey: string;
  customer: string;
  groupKey: string;
  group: string;
  /** "RecordingService_IN_12" */
  name: string;
  full: string;
  lastSeen: number | null;
  vals: Map<number, number>;
}

export interface GroupInfo {
  key: string;
  customer: string;
  label: string;
  resourceGroup: string;
  error?: string;
}

export interface Model {
  bots: Bot[];
  groups: GroupInfo[];
  times: number[];
  binMs: number;
  hours: number;
  metric: string;
  agg: string;
  generatedAt: number;
  notes: string[];
}

const short = (n: string) => (n.includes('.') ? n.slice(n.lastIndexOf('.') + 1) : n);
const groupLabel = (rg: string) => /grp-(.+)$/.exec(rg)?.[1] ?? rg;

export function buildModel(parts: { customer: CustomerOption; res: SeriesResponse }[]): Model {
  const bots: Bot[] = [];
  const groups: GroupInfo[] = [];
  const timeSet = new Set<number>();
  const notes: string[] = [];
  const def = metricOf(parts[0]?.res.metric ?? 'calls');
  const scale = def.scale ?? 1;
  for (const { customer, res } of parts) {
    if (res.note) notes.push(`${customer.label}: ${res.note}`);
    for (const g of res.groups) {
      const gKey = `${customer.subscriptionId}|${g.resourceGroup}`;
      groups.push({ key: gKey, customer: customer.label, label: groupLabel(g.resourceGroup), resourceGroup: g.resourceGroup, error: g.error });
      const ts = g.times.map((t) => Date.parse(t));
      ts.forEach((t) => timeSet.add(t));
      g.instances.forEach((inst, ii) => {
        bots.push({
          id: `${gKey}|${inst}`,
          customerKey: customer.subscriptionId,
          customer: customer.label,
          groupKey: gKey,
          group: groupLabel(g.resourceGroup),
          name: short(inst),
          full: inst,
          lastSeen: g.lastSeen[ii] ? Date.parse(g.lastSeen[ii]!) : null,
          vals: new Map(),
        });
      });
      const base = bots.length - g.instances.length;
      for (const [ti, ii, v] of g.cells) bots[base + ii]!.vals.set(ts[ti]!, v * scale);
    }
  }
  const first = parts[0]?.res;
  return {
    bots,
    groups,
    times: [...timeSet].sort((a, b) => a - b),
    binMs: (first?.bin ?? 1) * 60_000,
    hours: first?.hours ?? 1,
    metric: first?.metric ?? 'calls',
    agg: first?.agg ?? 'max',
    generatedAt: first ? Date.parse(first.generatedAt) : Date.now(),
    notes,
  };
}

// ---------------------------------------------------------------- aggregation and filters

export interface Filters {
  /** Recording groups switched off. */
  hiddenGroups: Set<string>;
  query: string;
  onlyActive: boolean;
  hideIdle: boolean;
}

/** The bot reports about every 20 s; 10 minutes of silence means it is not reporting. */
export const QUIET_MS = 10 * 60_000;
export const isQuiet = (b: Bot, now: number) => b.lastSeen === null || now - b.lastSeen > QUIET_MS;

export const peakOf = (b: Bot): number | null => (b.vals.size ? Math.max(...b.vals.values()) : null);
export const avgOf = (b: Bot): number | null => (b.vals.size ? [...b.vals.values()].reduce((a, c) => a + c, 0) / b.vals.size : null);
/** The newest reading the bot has in the period. */
export function nowOf(b: Bot): number | null {
  let t = -1;
  let v: number | null = null;
  for (const [k, x] of b.vals) if (k > t) [t, v] = [k, x];
  return v;
}

export function applyFilters(m: Model, f: Filters, now = Date.now()): Bot[] {
  const q = f.query.trim().toLowerCase();
  return m.bots.filter((b) => {
    if (f.hiddenGroups.has(b.groupKey)) return false;
    if (q && !`${b.full} ${b.group} ${b.customer}`.toLowerCase().includes(q)) return false;
    if (f.onlyActive && isQuiet(b, now)) return false;
    if (f.hideIdle && (peakOf(b) ?? 0) === 0) return false;
    return true;
  });
}

export function combine(values: number[], how: MetricDef['combine']): number | null {
  if (values.length === 0) return null;
  if (how === 'sum') return values.reduce((a, b) => a + b, 0);
  if (how === 'max') return Math.max(...values);
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export interface Series {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
}

/** One value per time slot for a set of bots (null when none of them reported in that slot). */
export function totalValues(bots: Bot[], times: number[], how: MetricDef['combine']): (number | null)[] {
  return times.map((t) => {
    const v: number[] = [];
    for (const b of bots) {
      const x = b.vals.get(t);
      if (x !== undefined) v.push(x);
    }
    return combine(v, how);
  });
}

export type Split = 'none' | 'group' | 'instance';
export const MAX_INSTANCE_SERIES = 10;

export function buildSeries(m: Model, bots: Bot[], split: Split): { series: Series[]; note?: string } {
  const how = metricOf(m.metric).combine;
  if (split === 'group') {
    const by = new Map<string, Bot[]>();
    for (const b of bots) by.set(b.groupKey, [...(by.get(b.groupKey) ?? []), b]);
    const many = new Set(m.groups.map((g) => g.customer)).size > 1;
    const series = [...by.entries()].map(([k, list], i) => {
      const g = m.groups.find((x) => x.key === k)!;
      return { key: k, label: many ? `${g.customer} · ${g.label}` : g.label, color: PALETTE[i % PALETTE.length]!, values: totalValues(list, m.times, how) };
    });
    return { series };
  }
  if (split === 'instance') {
    const ranked = [...bots].sort((a, b) => (peakOf(b) ?? -1) - (peakOf(a) ?? -1));
    const top = ranked.slice(0, MAX_INSTANCE_SERIES);
    return {
      series: top.map((b, i) => ({ key: b.id, label: `${b.group} · ${b.name}`, color: PALETTE[i % PALETTE.length]!, values: m.times.map((t) => b.vals.get(t) ?? null) })),
      note: ranked.length > top.length ? `Showing the ${top.length} busiest of ${ranked.length} bots. Narrow the filters to see others.` : undefined,
    };
  }
  return { series: [{ key: 'total', label: metricOf(m.metric).label, color: PALETTE[0]!, values: totalValues(bots, m.times, how) }] };
}

export interface Stats {
  now: number | null;
  nowAt: number | null;
  peak: number | null;
  peakAt: number | null;
  avg: number | null;
  min: number | null;
}

export function statsOf(values: (number | null)[], times: number[]): Stats {
  let now: number | null = null;
  let nowAt: number | null = null;
  let peak: number | null = null;
  let peakAt: number | null = null;
  let min: number | null = null;
  let sum = 0;
  let n = 0;
  values.forEach((v, i) => {
    if (v === null) return;
    now = v;
    nowAt = times[i]!;
    if (peak === null || v > peak) [peak, peakAt] = [v, times[i]!];
    if (min === null || v < min) min = v;
    sum += v;
    n++;
  });
  return { now, nowAt, peak, peakAt, avg: n ? sum / n : null, min };
}

// ---------------------------------------------------------------- formatting

export function fmtValue(v: number | null, unit = ''): string {
  if (v === null) return '–';
  const a = Math.abs(v);
  const s = a >= 1000 ? Math.round(v).toLocaleString() : a >= 100 ? String(Math.round(v)) : a >= 10 ? String(Math.round(v * 10) / 10) : String(Math.round(v * 100) / 100);
  return unit === '%' ? `${s}%` : unit ? `${s} ${unit}` : s;
}

export function fmtTime(ms: number, hours: number): string {
  const d = new Date(ms);
  if (hours <= 24) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${d.toLocaleDateString([], { weekday: 'short' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}

export const ago = (ms: number | null, now = Date.now()): string => {
  if (ms === null) return 'never';
  const m = Math.round((now - ms) / 60_000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

/** A "nice" axis maximum and tick step for 0..max. */
export function niceScale(max: number, ticks = 4): { top: number; step: number } {
  if (!(max > 0)) return { top: 1, step: 0.25 };
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  return { top: Math.ceil(max / step) * step, step };
}

export function toCsv(m: Model, bots: Bot[]): string {
  const def = metricOf(m.metric);
  // names come from Azure: a cell that starts with = + - @ would run as a formula when the CSV is opened in a spreadsheet
  const esc = (raw: string) => {
    const s = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [['time', 'customer', 'recording group', 'bot instance', `${def.label}${def.unit ? ` (${def.unit})` : ''} [${m.agg}]`].join(',')];
  for (const t of m.times)
    for (const b of bots) {
      const v = b.vals.get(t);
      if (v !== undefined) lines.push([new Date(t).toISOString(), esc(b.customer), esc(b.group), esc(b.full), String(Math.round(v * 100) / 100)].join(','));
    }
  return lines.join('\n');
}

// ---------------------------------------------------------------- plain-language insights

export interface Insight {
  tone: 'ok' | 'warn' | 'info';
  text: string;
}

/** A few short sentences that say what the numbers mean, so nobody has to read the chart to know. */
export function insightsOf(m: Model, bots: Bot[], total: (number | null)[], st: Stats, now: number): Insight[] {
  const def = metricOf(m.metric);
  const out: Insight[] = [];
  const f = (v: number | null) => fmtValue(v === null ? null : Math.round(v * 10) / 10, def.unit);

  // direction: now against about half an hour ago (or the previous slot when slots are wide)
  let li = -1;
  total.forEach((v, i) => v !== null && (li = i));
  const back = Math.max(1, Math.round((30 * 60_000) / m.binMs));
  if (li - back >= 0 && total[li] !== null) {
    const was = total[li - back] ?? null;
    if (was !== null) {
      const diff = total[li]! - was;
      const rel = was > 0 ? diff / was : diff === 0 ? 0 : 1;
      const since = m.binMs >= 30 * 60_000 ? 'the previous period' : '30 minutes ago';
      out.push(
        Math.abs(rel) < 0.05
          ? { tone: 'info', text: `Steady: ${f(total[li]!)} now, about the same as ${since}.` }
          : { tone: 'info', text: `${diff > 0 ? 'Rising' : 'Falling'}: ${f(total[li]!)} now, ${diff > 0 ? 'up' : 'down'} from ${f(was)} ${since}.` },
      );
    }
  }

  if (st.peak !== null && st.peakAt !== null && st.avg !== null && st.avg > 0) {
    const ratio = st.peak / st.avg;
    out.push({ tone: 'info', text: `Busiest at ${fmtTime(st.peakAt, m.hours)} with ${f(st.peak)}${ratio >= 1.5 ? `, ${ratio.toFixed(1)}× the average` : ''}.` });
  }

  if (def.combine === 'sum') {
    const per = m.groups.map((g) => ({ g, v: bots.filter((b) => b.groupKey === g.key).reduce((a, b) => a + (nowOf(b) ?? 0), 0) })).filter((x) => x.v > 0);
    const sum = per.reduce((a, x) => a + x.v, 0);
    if (per.length > 1 && sum > 0) {
      const top = [...per].sort((a, b) => b.v - a.v)[0]!;
      out.push({ tone: 'info', text: `${top.g.label} carries ${Math.round((top.v / sum) * 100)}% of the load right now.` });
    }
  }

  const quiet = bots.filter((b) => isQuiet(b, now));
  out.push(
    quiet.length === 0
      ? { tone: 'ok', text: bots.length ? `All ${bots.length} bots are reporting.` : 'No bots match the filters.' }
      : { tone: 'warn', text: `${quiet.length} of ${bots.length} bots have been quiet for 10+ minutes${quiet.length <= 3 ? `: ${quiet.map((b) => b.name.replace(/^RecordingService_/, '')).join(', ')}` : ''}.` },
  );
  return out.slice(0, 4);
}

/** Smooth line through points that never overshoots (monotone cubic), as an SVG path. */
export function smoothPath(pts: [number, number][]): string {
  const n = pts.length;
  if (n === 0) return '';
  if (n < 3) return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1]![0] - pts[i]![0]);
    m.push((pts[i + 1]![1] - pts[i]![1]) / (dx[i] || 1));
  }
  const t: number[] = [m[0]!];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1]! * m[i]! <= 0 ? 0 : (m[i - 1]! + m[i]!) / 2);
  t.push(m[n - 2]!);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) t[i] = t[i + 1] = 0;
    else {
      const a = t[i]! / m[i]!;
      const b = t[i + 1]! / m[i]!;
      const s = a * a + b * b;
      if (s > 9) {
        const k = 3 / Math.sqrt(s);
        t[i] = k * a * m[i]!;
        t[i + 1] = k * b * m[i]!;
      }
    }
  }
  let d = `M${pts[0]![0].toFixed(1)} ${pts[0]![1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i]! / 3;
    d += ` C${(pts[i]![0] + h).toFixed(1)} ${(pts[i]![1] + t[i]! * h).toFixed(1)} ${(pts[i + 1]![0] - h).toFixed(1)} ${(pts[i + 1]![1] - t[i + 1]! * h).toFixed(1)} ${pts[i + 1]![0].toFixed(1)} ${pts[i + 1]![1].toFixed(1)}`;
  }
  return d;
}
