import '../calls.css';
import { useMemo, useState } from 'react';
import { checkCalls, type CallGroup, type CallsResponse } from '../lib/api';
import { PALETTE, fmtTime, type Series } from '../lib/calls';
import { TimeChart } from './CallsCharts';

const HOURS = [
  { h: 1, label: '1 hour' },
  { h: 6, label: '6 hours' },
  { h: 24, label: '24 hours' },
];

const ago = (iso: string | null): string => {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
/** The bot reports about every 20 seconds; silence for 10 minutes means it is not reporting. */
const stale = (iso: string | null) => !iso || Date.now() - Date.parse(iso) > 10 * 60_000;
const fmt = (v: number | null) => (v === null ? '–' : String(Math.round(v)));
/** "adcprdntx-uaen-grp-rec-01" -> "rec-01". */
const groupLabel = (g: CallGroup) => /grp-(.+)$/.exec(g.resourceGroup)?.[1] ?? g.resourceGroup;
const shortInst = (n: string) => (n.includes('.') ? n.slice(n.lastIndexOf('.') + 1) : n);
const SHOWN = 6;

function Stat({ label, value, sub, tone = '' }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className={`cc-stat ${tone}`}>
      <span>{label}</span>
      <b>{value}</b>
      {sub && <em>{sub}</em>}
    </div>
  );
}

function Group({ g, color }: { g: CallGroup; color: string }) {
  const [all, setAll] = useState(false);
  const quiet = !g.error && stale(g.lastSeen);
  return (
    <div className={`cc-group${g.error ? ' cc-bad' : ''}`}>
      <div className="cc-group-top">
        <span className="cc-group-name" title={g.resourceGroup}>
          <i style={{ background: color }} aria-hidden />
          {groupLabel(g)}
        </span>
        {!g.error && (
          <span className={`cc-seen${quiet ? ' cc-warn' : ''}`}>
            <i className={`cv-dot ${quiet ? 'warn' : 'ok'}`} aria-hidden />
            last reading {ago(g.lastSeen)}
          </span>
        )}
      </div>
      {g.error ? (
        <p className="cd-errline">{g.error}</p>
      ) : g.lastSeen === null ? (
        <p className="cd-errline">This bot reported no concurrent-call readings in this period.</p>
      ) : (
        <>
          <div className="cc-nums">
            <div>
              <b>{fmt(g.calls)}</b>
              <span>calls now</span>
            </div>
            <div>
              <b>{fmt(g.peak)}</b>
              <span>peak</span>
            </div>
            <div>
              <b>{g.load === null ? '–' : `${Math.round(g.load)}%`}</b>
              <span>load (busiest bot)</span>
            </div>
          </div>
          {g.instances.length > 0 && (
            <table className="cc-inst">
              <thead>
                <tr>
                  <th>Bot</th>
                  <th>Calls</th>
                  <th>Peak</th>
                  <th>Avg</th>
                  <th>Load</th>
                  <th>Last reading</th>
                </tr>
              </thead>
              <tbody>
                {(all ? g.instances : g.instances.slice(0, SHOWN)).map((i) => (
                  <tr key={i.instance}>
                    <td title={i.instance}>{shortInst(i.instance)}</td>
                    <td>{fmt(i.calls)}</td>
                    <td>{fmt(i.peak)}</td>
                    <td>{i.avg === null ? '–' : i.avg}</td>
                    <td>{i.load === null ? '–' : `${Math.round(i.load)}%`}</td>
                    <td className={stale(i.lastSeen) ? 'cc-warn' : ''}>{ago(i.lastSeen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {g.instances.length > SHOWN && (
            <button type="button" className="cc-more" onClick={() => setAll((a) => !a)}>
              {all ? 'Show fewer' : `Show all ${g.instances.length} bot instances`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

/**
 * "Concurrent calls" for one customer, read live from the bots' Application Insights. ON DEMAND: nothing is requested until the
 * button is pressed (not when the panel opens, not at start-up), and the result is dropped when the panel closes.
 */
export default function CallsSection({ subscriptionId, onOpenFull }: { subscriptionId: string; onOpenFull?: () => void }) {
  const [hours, setHours] = useState(1);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<CallsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setData(await checkCalls(subscriptionId, hours));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the concurrent calls.');
    } finally {
      setBusy(false);
    }
  };

  // one line per recording group, plus the headline numbers of all groups together
  const chart = useMemo(() => {
    if (!data) return null;
    const good = data.groups.filter((g) => !g.error && g.series.length > 0);
    const times = [...new Set(good.flatMap((g) => g.series.map((p) => Date.parse(p.t))))].sort((a, b) => a - b);
    const series: Series[] = good.map((g, i) => {
      const by = new Map(g.series.map((p) => [Date.parse(p.t), p.v]));
      return { key: g.resourceGroup, label: groupLabel(g), color: PALETTE[i % PALETTE.length]!, values: times.map((t) => by.get(t) ?? null) };
    });
    const total = times.map((_, ti) => {
      const v = series.map((s) => s.values[ti]).filter((x): x is number => x !== null && x !== undefined);
      return v.length ? v.reduce((a, b) => a + b, 0) : null;
    });
    const peak = total.reduce<number | null>((m, v) => (v !== null && (m === null || v > m) ? v : m), null);
    const peakAt = peak === null ? null : times[total.indexOf(peak)]!;
    return { times, series, peak, peakAt };
  }, [data]);

  const now = data ? data.groups.reduce((a, g) => a + (g.calls ?? 0), 0) : 0;
  const bots = data ? data.groups.reduce((a, g) => a + g.instances.length, 0) : 0;
  const quietBots = data ? data.groups.reduce((a, g) => a + g.instances.filter((i) => stale(i.lastSeen)).length, 0) : 0;
  const maxLoad = data ? Math.max(0, ...data.groups.map((g) => g.load ?? 0)) : 0;

  return (
    <section className="cd-sec cc-section" aria-label="Concurrent calls">
      <div className="cc-head">
        <div className="cc-title">
          <span className="cc-icon" aria-hidden>
            📞
          </span>
          <div>
            <h4>Concurrent calls</h4>
            <p>Live from the bots&apos; Application Insights, only when you ask.</p>
          </div>
        </div>
        <div className="cc-controls">
          <div className="cv-seg cc-seg" role="radiogroup" aria-label="Period">
            {HOURS.map((o) => (
              <button key={o.h} type="button" role="radio" aria-checked={hours === o.h} className={hours === o.h ? 'on' : ''} disabled={busy} onClick={() => setHours(o.h)}>
                {o.label}
              </button>
            ))}
          </div>
          {data && (
            <button type="button" className="pill" disabled={busy} onClick={() => void run()}>
              {busy ? '⏳ Reading…' : '⟳ Re-check'}
            </button>
          )}
          {onOpenFull && (
            <button type="button" className="pill" onClick={onOpenFull} title="Open the full Concurrent Calls page for this customer">
              Full view ↗
            </button>
          )}
        </div>
      </div>

      {!data && !error && (
        <div className="cc-empty">
          <div className="cc-empty-ico" aria-hidden>
            📞
          </div>
          <h5>Not loaded</h5>
          <p>Read how many calls each bot is handling at the same time. Handy when calls are missing from the archive: you can see whether the bots were busy or silent.</p>
          <button type="button" className="btn-accent" disabled={busy} onClick={() => void run()}>
            {busy ? '⏳ Reading…' : 'Check concurrent calls'}
          </button>
        </div>
      )}
      {error && (
        <div className="cd-err">
          {error}
          <button type="button" className="pill" style={{ marginLeft: 12 }} disabled={busy} onClick={() => void run()}>
            Try again
          </button>
        </div>
      )}

      {data && (
        <>
          {data.note && <p className="cc-note">{data.note}</p>}
          <div className="cc-stats">
            <Stat label="Calls now" value={fmt(now)} sub={`across ${data.groups.length} recording group${data.groups.length === 1 ? '' : 's'}`} tone="accent" />
            <Stat label="Peak" value={fmt(chart?.peak ?? null)} sub={chart?.peakAt ? `at ${fmtTime(chart.peakAt, data.hours)}` : undefined} />
            <Stat label="Busiest bot load" value={`${Math.round(maxLoad)}%`} sub="of its capacity" />
            <Stat label="Bots reporting" value={`${bots - quietBots}/${bots}`} sub={quietBots > 0 ? `${quietBots} quiet 10+ min` : 'all reporting'} tone={quietBots > 0 ? 'warn' : 'ok'} />
          </div>
          {chart && chart.series.length > 0 && (
            <div className="cc-chart">
              <TimeChart series={chart.series} times={chart.times} hours={data.hours} unit="" />
            </div>
          )}
          {data.groups.map((g, i) => (
            <Group key={g.resourceGroup + g.name} g={g} color={PALETTE[i % PALETTE.length]!} />
          ))}
          <p className="cc-note">
            {data.hours === 1 ? 'Last hour' : `Last ${data.hours} hours`} · read {new Date(data.generatedAt).toLocaleTimeString()} · peak is the busiest moment of the whole recording group.
          </p>
        </>
      )}
    </section>
  );
}
