import '../calls.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AGG_LABEL,
  PALETTE,
  RANGES,
  METRICS,
  ago,
  applyFilters,
  avgOf,
  buildModel,
  buildSeries,
  fetchSeries,
  fmtTime,
  fmtValue,
  insightsOf,
  isQuiet,
  metricOf,
  nowOf,
  peakOf,
  statsOf,
  toCsv,
  totalValues,
  type Bot,
  type CustomerOption,
  type Model,
  type Split,
} from '../lib/calls';
import { Bars, Heatmap, Spark, TimeChart, type BarItem } from './CallsCharts';
import { AnimatedText } from './panels';

const MAX_CUSTOMERS = 4;
const AUTO = [
  { s: 0, label: 'Off' },
  { s: 30, label: '30 s' },
  { s: 60, label: '1 min' },
  { s: 300, label: '5 min' },
];
type SortKey = 'customer' | 'group' | 'name' | 'now' | 'peak' | 'avg' | 'seen';

/** Customer multi-select with search (a small popover, like a metrics scope picker). */
function CustomerPicker({ options, value, onChange }: { options: CustomerOption[]; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const shown = options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : value.length >= MAX_CUSTOMERS ? value : [...value, id]);
  return (
    <div className="cv-picker" ref={box}>
      <button type="button" className="cv-field cv-pick-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {value.length === 0 ? (
          <span className="cv-placeholder">Choose customers…</span>
        ) : (
          value.map((id) => (
            <span key={id} className="cv-chip">
              {options.find((o) => o.subscriptionId === id)?.label ?? id}
            </span>
          ))
        )}
        <span className="cv-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className="cv-pop" role="listbox" aria-label="Customers" aria-multiselectable>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customers…" aria-label="Search customers" />
          <ul>
            {shown.length === 0 && <li className="cv-none">No customer matches.</li>}
            {shown.map((o) => {
              const on = value.includes(o.subscriptionId);
              const full = !on && value.length >= MAX_CUSTOMERS;
              return (
                <li key={o.subscriptionId}>
                  <label className={full ? 'dim' : ''}>
                    <input type="checkbox" checked={on} disabled={full} onChange={() => toggle(o.subscriptionId)} />
                    <span>{o.label}</span>
                    {o.bots !== undefined && <em>{o.bots} bots</em>}
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="cv-hint">Up to {MAX_CUSTOMERS} customers at once. Nothing is read until you press Load.</p>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, tone = '', big = false }: { label: string; value: string; sub?: string; tone?: string; big?: boolean }) {
  return (
    <div className={`cv-kpi ${tone}${big ? ' big' : ''}`} role="listitem">
      <span>{label}</span>
      <b>
        <AnimatedText value={value} />
      </b>
      {sub && <em>{sub}</em>}
    </div>
  );
}

/**
 * Concurrent calls per bot, from the bots' Application Insights. ON DEMAND: opening this tab reads nothing; data is fetched
 * when Load is pressed (and again when the metric, aggregation or range is changed afterwards, or on the optional timer).
 */
export default function CallsView({ customers, preselect, onPreselectUsed }: { customers: CustomerOption[]; preselect?: string[] | null; onPreselectUsed?: () => void }) {
  const [selected, setSelected] = useState<string[]>(() => (preselect && preselect.length ? preselect.slice(0, MAX_CUSTOMERS) : []));
  const [metric, setMetric] = useState('calls');
  // Avg per time slot and bot adds up to the true simultaneous count; Max adds each bot's busiest moment, which overstates it
  const [agg, setAgg] = useState('avg');
  const [hours, setHours] = useState(6);
  const [split, setSplit] = useState<Split>('group');
  const [auto, setAuto] = useState(0);
  const [model, setModel] = useState<Model | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hiddenGroups, setHidden] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [onlyActive, setOnlyActive] = useState(false);
  const [hideIdle, setHideIdle] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'now', dir: -1 });
  const [allRows, setAllRows] = useState(false);
  const loaded = useRef(false);
  const seq = useRef(0);

  // a customer chosen from the details panel ("Open full view") is selected here; it still needs Load to read anything
  useEffect(() => {
    if (preselect && preselect.length) {
      setSelected(preselect.slice(0, MAX_CUSTOMERS));
      onPreselectUsed?.();
    }
  }, [preselect]); // eslint-disable-line react-hooks/exhaustive-deps

  const def = metricOf(metric);

  const load = useCallback(
    async (ids = selected, m = metric, a = agg, h = hours) => {
      if (ids.length === 0) return;
      const mine = ++seq.current;
      setLoading(true);
      setError(null);
      try {
        const parts = await Promise.all(
          ids.map(async (id) => {
            const customer = customers.find((c) => c.subscriptionId === id) ?? { subscriptionId: id, label: id };
            return { customer, res: await fetchSeries(id, h, m, a) };
          }),
        );
        if (mine !== seq.current) return; // a newer request replaced this one
        setModel(buildModel(parts));
        setHidden(new Set());
        loaded.current = true;
      } catch (e) {
        if (mine === seq.current) setError(e instanceof Error ? e.message : 'Could not read the concurrent calls.');
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    },
    [selected, metric, agg, hours, customers],
  );

  // after the first Load, changing the metric / aggregation / range re-reads straight away
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (loaded.current) void load(selected, metric, agg, hours);
  }, [metric, agg, hours]); // eslint-disable-line react-hooks/exhaustive-deps

  // optional live refresh, only while this tab is open and only if chosen
  useEffect(() => {
    if (!auto || !loaded.current) return;
    const t = window.setInterval(() => void load(), auto * 1000);
    return () => window.clearInterval(t);
  }, [auto, load]);

  const now = model?.generatedAt ?? Date.now();
  const bots = useMemo(() => (model ? applyFilters(model, { hiddenGroups, query, onlyActive, hideIdle }, now) : []), [model, hiddenGroups, query, onlyActive, hideIdle, now]);
  const built = useMemo(() => (model ? buildSeries(model, bots, split) : null), [model, bots, split]);
  const total = useMemo(() => (model ? totalValues(bots, model.times, def.combine) : []), [model, bots, def.combine]);
  const stats = useMemo(() => statsOf(total, model?.times ?? []), [total, model]);
  const active = bots.filter((b) => !isQuiet(b, now)).length;
  const lastSeen = bots.reduce<number | null>((m, b) => (b.lastSeen !== null && (m === null || b.lastSeen > m) ? b.lastSeen : m), null);

  const insights = useMemo(() => (model ? insightsOf(model, bots, total, stats, now) : []), [model, bots, total, stats, now]);

  const groupRows: BarItem[] = useMemo(() => {
    if (!model) return [];
    const many = new Set(model.groups.map((g) => g.customer)).size > 1;
    const rows = model.groups
      .map((g, i) => {
        const list = bots.filter((b) => b.groupKey === g.key);
        const vals = totalValues(list, model.times, def.combine);
        const st = statsOf(vals, model.times);
        return { g, i, st, list };
      })
      .filter((r) => !r.g.error);
    const max = Math.max(...rows.map((r) => r.st.peak ?? 0), 1);
    return rows.map((r) => ({
      key: r.g.key,
      label: many ? `${r.g.customer} · ${r.g.label}` : r.g.label,
      sub: `${r.list.length} bots · peak ${fmtValue(r.st.peak, def.unit)} · avg ${fmtValue(r.st.avg === null ? null : Math.round(r.st.avg * 10) / 10, def.unit)}`,
      value: r.st.now,
      display: fmtValue(r.st.now, def.unit),
      max,
      color: PALETTE[r.i % PALETTE.length]!,
      onClick: () => setHidden(new Set(model.groups.filter((x) => x.key !== r.g.key).map((x) => x.key))),
    }));
  }, [model, bots, def]);

  const busiest: BarItem[] = useMemo(() => {
    const ranked = [...bots].sort((a, b) => (peakOf(b) ?? -1) - (peakOf(a) ?? -1)).slice(0, 8);
    const max = Math.max(...ranked.map((b) => peakOf(b) ?? 0), 1);
    return ranked.map((b, i) => ({
      key: b.id,
      label: `${b.group} · ${b.name.replace(/^RecordingService_/, '')}`,
      sub: `now ${fmtValue(nowOf(b), def.unit)} · avg ${fmtValue(avgOf(b) === null ? null : Math.round(avgOf(b)! * 10) / 10, def.unit)}`,
      value: peakOf(b),
      display: `peak ${fmtValue(peakOf(b), def.unit)}`,
      max,
      color: PALETTE[i % PALETTE.length]!,
      onClick: () => setQuery(b.full),
    }));
  }, [bots, def.unit]);

  const sorted = useMemo(() => {
    const val = (b: Bot): number | string => {
      switch (sort.key) {
        case 'customer': return b.customer;
        case 'group': return b.group;
        case 'name': return b.name.padStart(32, '0');
        case 'now': return nowOf(b) ?? -1;
        case 'peak': return peakOf(b) ?? -1;
        case 'avg': return avgOf(b) ?? -1;
        default: return b.lastSeen ?? 0;
      }
    };
    return [...bots].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [bots, sort]);

  const head = (key: SortKey, label: string, cls = '') => (
    <th className={cls} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : -1 }))}>
        {label}
        {sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  );

  const download = () => {
    if (!model) return;
    const blob = new Blob([toCsv(model, bots)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `concurrent-calls-${metric}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const rangeLabel = RANGES.find((r) => r.hours === (model?.hours ?? hours))?.label ?? `${hours} h`;
  const erroredGroups = model?.groups.filter((g) => g.error) ?? [];

  return (
    <div className="cv">
      {/* ── toolbar: scope, metric, aggregation, range, split ── */}
      <section className="cv-bar panel" aria-label="Chart settings" aria-busy={loading}>
        <div className="cv-grid">
          <div className="cv-ctl cv-wide">
            <label id="cv-cust">Customers</label>
            <CustomerPicker options={customers} value={selected} onChange={setSelected} />
          </div>
          <div className="cv-ctl">
            <label htmlFor="cv-metric">Metric</label>
            <select id="cv-metric" className="cv-field" value={metric} onChange={(e) => setMetric(e.target.value)} title={def.blurb}>
              {METRICS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className="cv-ctl">
            <label htmlFor="cv-agg">Aggregation</label>
            <select id="cv-agg" className="cv-field" value={agg} onChange={(e) => setAgg(e.target.value)}>
              {Object.entries(AGG_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="cv-ctl">
            <label htmlFor="cv-split">Split by</label>
            <select id="cv-split" className="cv-field" value={split} onChange={(e) => setSplit(e.target.value as Split)}>
              <option value="none">None (total)</option>
              <option value="group">Recording group</option>
              <option value="instance">Bot instance</option>
            </select>
          </div>
          <div className="cv-ctl">
            <label htmlFor="cv-live">Live refresh</label>
            <select id="cv-live" className="cv-field" value={auto} onChange={(e) => setAuto(Number(e.target.value))} disabled={!model}>
              {AUTO.map((a) => (
                <option key={a.s} value={a.s}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="cv-row">
          <div className="cv-seg" role="radiogroup" aria-label="Time range">
            {RANGES.map((r) => (
              <button key={r.hours} type="button" role="radio" aria-checked={hours === r.hours} className={hours === r.hours ? 'on' : ''} onClick={() => setHours(r.hours)}>
                {r.label}
              </button>
            ))}
          </div>
          <span className="cv-grow" />
          <button type="button" className="btn-accent" disabled={loading || selected.length === 0} onClick={() => void load()}>
            {loading ? '⏳ Reading…' : model ? '⟳ Reload' : '▶ Load'}
          </button>
        </div>
      </section>

      {error && <div className="banner banner-err">{error}</div>}

      {!model && !loading && (
        <section className="cv-empty panel" aria-label="Not loaded">
          <div className="cv-empty-ico" aria-hidden>
            📞
          </div>
          <h2>Concurrent calls, on demand</h2>
          <p>
            Choose one or more customers, a metric and a time range, then press <b>Load</b>. Nothing is read from Application Insights until you do, so this tab costs nothing while you are not using it.
          </p>
          {selected.length === 0 && <p className="cv-hint">Start by choosing a customer above.</p>}
        </section>
      )}
      {!model && loading && <div className="skeleton" style={{ height: 320 }} aria-busy />}

      {model && (
        <div className={`cv-results${loading ? ' cv-busy' : ''}`}>
          {/* ── filters on what is loaded (no new request) ── */}
          <section className="cv-filters panel" aria-label="Filters">
            <div className="cv-row cv-wrap">
              <span className="cv-flabel">Filter</span>
              {model.groups.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  className={`cv-toggle${hiddenGroups.has(g.key) ? '' : ' on'}${g.error ? ' bad' : ''}`}
                  aria-pressed={!hiddenGroups.has(g.key)}
                  onClick={() => setHidden((cur) => { const n = new Set(cur); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n; })}
                  title={g.error ?? g.resourceGroup}
                >
                  {new Set(model.groups.map((x) => x.customer)).size > 1 ? `${g.customer} · ` : ''}
                  {g.label}
                  {g.error ? ' ⚠' : ''}
                </button>
              ))}
            </div>
            <div className="cv-row cv-wrap">
              <input className="cv-field cv-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Bot instance contains…" aria-label="Bot instance contains" />
              <label className="cv-check">
                <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} /> Only bots that reported in the last 10 min
              </label>
              <label className="cv-check">
                <input type="checkbox" checked={hideIdle} onChange={(e) => setHideIdle(e.target.checked)} /> Hide bots with no activity
              </label>
              <span className="cv-grow" />
              <span className="cv-count mono">
                {bots.length} of {model.bots.length} bots
              </span>
              {(query || onlyActive || hideIdle || hiddenGroups.size > 0) && (
                <button type="button" className="pill" onClick={() => { setQuery(''); setOnlyActive(false); setHideIdle(false); setHidden(new Set()); }}>
                  ✕ Clear filters
                </button>
              )}
            </div>
          </section>

          {erroredGroups.length > 0 && (
            <div className="banner banner-warm">
              {erroredGroups.length} recording group{erroredGroups.length === 1 ? '' : 's'} could not be read: {erroredGroups.map((g) => `${g.customer} ${g.label}`).join(', ')}.
            </div>
          )}
          {model.notes.map((n) => (
            <div key={n} className="banner banner-warm">
              {n}
            </div>
          ))}

          {/* ── at a glance: the number that matters, and what it means in words ── */}
          <div className="cv-top">
            <Kpi
              big
              label={`${def.label} now`}
              value={fmtValue(stats.now, def.unit)}
              sub={stats.nowAt ? `reading from ${fmtTime(stats.nowAt, model.hours)}` : undefined}
              tone="accent"
            />
            <section className="cv-insights" aria-label="What stands out">
              <h3>What stands out</h3>
              <ul>
                {insights.map((i) => (
                  <li key={i.text} className={i.tone}>
                    <i aria-hidden />
                    <span>{i.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
          <div className="cv-kpis" role="list">
            <Kpi label="Peak" value={fmtValue(stats.peak, def.unit)} sub={stats.peakAt ? `at ${fmtTime(stats.peakAt, model.hours)}` : undefined} />
            <Kpi label="Average" value={fmtValue(stats.avg === null ? null : Math.round(stats.avg * 10) / 10, def.unit)} sub={`over ${rangeLabel}`} />
            <Kpi label="Lowest" value={fmtValue(stats.min, def.unit)} sub={`in ${rangeLabel}`} />
            <Kpi label="Bots reporting" value={`${active}/${bots.length}`} sub={bots.length - active > 0 ? `${bots.length - active} quiet 10+ min` : 'all reporting'} tone={bots.length - active > 0 ? 'warn' : 'ok'} />
            <Kpi label="Last reading" value={ago(lastSeen, now)} sub={lastSeen ? new Date(lastSeen).toLocaleTimeString() : undefined} tone={lastSeen !== null && now - lastSeen > 10 * 60_000 ? 'warn' : ''} />
          </div>

          {/* ── main chart ── */}
          <section className="panel cv-card" aria-label="Chart">
            <div className="panel-hd">
              <div>
                <h3>
                  {def.label} · {AGG_LABEL[model.agg]} · last {rangeLabel}
                </h3>
                <p className="cv-sub">{def.blurb}.</p>
              </div>
              <span className="cv-hd-right">
                <span className="panel-legend">
                  one point per {model.binMs / 60_000 >= 60 ? `${Math.round(model.binMs / 3_600_000)} h` : `${model.binMs / 60_000} min`} · {def.combine === 'sum' ? 'bots added up' : def.combine === 'max' ? 'busiest bot' : 'bots averaged'}
                </span>
                <button type="button" className="pill" onClick={download} disabled={bots.length === 0}>
                  ⬇ CSV
                </button>
              </span>
            </div>
            <div className="panel-bd">
              {built && <TimeChart series={built.series} times={model.times} hours={model.hours} unit={def.unit} average={stats.avg} />}
              {built?.note && <p className="cv-hint">{built.note}</p>}
              {def.combine === 'sum' && model.agg === 'max' && (
                <p className="cv-hint">
                  Max adds up each bot's busiest moment within a time slot, so totals can be higher than the calls that were really at the same time. Choose Avg for a closer match.
                </p>
              )}
            </div>
          </section>

          {/* ── by recording group / busiest bots ── */}
          <div className="cv-two">
            <section className="panel cv-card" aria-label="Recording groups">
              <div className="panel-hd">
                <div>
                  <h3>Recording groups</h3>
                  <p className="cv-sub">Where the load sits. Click one to focus on it.</p>
                </div>
              </div>
              <div className="panel-bd">
                <Bars items={groupRows} empty="No recording group has readings." />
              </div>
            </section>
            <section className="panel cv-card" aria-label="Busiest bots">
              <div className="panel-hd">
                <div>
                  <h3>Busiest bots</h3>
                  <p className="cv-sub">The bots with the highest peak. Click one to find it below.</p>
                </div>
              </div>
              <div className="panel-bd">
                <Bars items={busiest} empty="No bots match the filters." />
              </div>
            </section>
          </div>

          {/* ── heatmap ── */}
          <section className="panel cv-card" aria-label="Heatmap">
            <div className="panel-hd">
              <div>
                <h3>Every bot over time</h3>
                <p className="cv-sub">Each row is a bot, each column a slice of time. Darker means busier.</p>
              </div>
            </div>
            <div className="panel-bd">
              <Heatmap bots={[...bots].sort((a, b) => (peakOf(b) ?? -1) - (peakOf(a) ?? -1)).slice(0, 80)} times={model.times} hours={model.hours} unit={def.unit} />
              {bots.length > 80 && <p className="cv-hint">Showing the 80 busiest of {bots.length} bots.</p>}
            </div>
          </section>

          {/* ── table ── */}
          <section className="panel cv-card" aria-label="Bot instances">
            <div className="panel-hd">
              <div>
                <h3>Bot instances · {bots.length}</h3>
                <p className="cv-sub">Click a heading to sort.</p>
              </div>
            </div>
            <div className="panel-bd panel-bd-flush">
              {sorted.length === 0 ? (
                <p className="panel-empty">No bots match the filters.</p>
              ) : (
                <div className="cv-tablewrap">
                  <table className="cv-table">
                    <thead>
                      <tr>
                        {head('customer', 'Customer')}
                        {head('group', 'Group')}
                        {head('name', 'Bot')}
                        {head('now', 'Now', 'num')}
                        {head('peak', 'Peak', 'num')}
                        {head('avg', 'Avg', 'num')}
                        {head('seen', 'Last reading')}
                        <th>Trend</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(allRows ? sorted : sorted.slice(0, 25)).map((b) => {
                        const quiet = isQuiet(b, now);
                        return (
                          <tr key={b.id} className={quiet ? 'quiet' : ''}>
                            <td>{b.customer}</td>
                            <td className="mono">{b.group}</td>
                            <td className="mono" title={b.full}>
                              {b.name}
                            </td>
                            <td className="num mono">{fmtValue(nowOf(b), def.unit)}</td>
                            <td className="num mono">{fmtValue(peakOf(b), def.unit)}</td>
                            <td className="num mono">{fmtValue(avgOf(b) === null ? null : Math.round(avgOf(b)! * 10) / 10, def.unit)}</td>
                            <td className={quiet ? 'cv-warn' : ''}>
                              <i className={`cv-dot${quiet ? ' warn' : ' ok'}`} aria-hidden />
                              {ago(b.lastSeen, now)}
                            </td>
                            <td>
                              <Spark bot={b} times={model.times} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {sorted.length > 25 && (
                    <button type="button" className="cv-more" onClick={() => setAllRows((a) => !a)}>
                      {allRows ? 'Show fewer' : `Show all ${sorted.length} bots`}
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>

          <p className="cv-foot">
            Read at {new Date(model.generatedAt).toLocaleTimeString()} from Application Insights (read-only). Quiet means no reading for 10+ minutes.
            {auto ? ` Refreshing every ${AUTO.find((a) => a.s === auto)?.label}.` : ''}
          </p>
        </div>
      )}
    </div>
  );
}
