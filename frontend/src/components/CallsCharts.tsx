import { useId, useMemo, useState } from 'react';
import { fmtTime, fmtValue, niceScale, smoothPath, type Bot, type Series } from '../lib/calls';

const W = 1000;
const H = 320;
const PAD = { l: 52, r: 16, t: 22, b: 30 };

/** Runs of consecutive readings (a missing slot breaks the line instead of being drawn as zero). */
function runs(values: (number | null)[], x: (i: number) => number, y: (v: number) => number): [number, number][][] {
  const out: [number, number][][] = [];
  let cur: [number, number][] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (cur.length) out.push(cur);
      cur = [];
    } else cur.push([x(i), y(v)]);
  });
  if (cur.length) out.push(cur);
  return out;
}

/**
 * The main chart: smooth, thin lines on a quiet grid, a soft filled area for a single series, a dashed average line and a marked
 * peak, a hover guide with a tooltip listing every series at that moment, and a clickable legend.
 */
export function TimeChart({
  series,
  times,
  hours,
  unit,
  average,
  empty = 'No readings in this period.',
}: {
  series: Series[];
  times: number[];
  hours: number;
  unit: string;
  /** Drawn as a dashed reference line when there is a single series. */
  average?: number | null;
  empty?: string;
}) {
  const uid = useId().replace(/:/g, '');
  const [off, setOff] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  const shown = series.filter((s) => !off.has(s.key));

  const max = useMemo(() => Math.max(0, ...shown.flatMap((s) => s.values.filter((v): v is number => v !== null))), [shown]);
  const { top, step } = niceScale(max);
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (times.length > 1 ? (i / (times.length - 1)) * plotW : plotW / 2);
  const y = (v: number) => PAD.t + (1 - v / top) * plotH;
  const grid = Array.from({ length: Math.round(top / step) + 1 }, (_, k) => k * step);
  const tickCount = Math.min(7, times.length);
  const ticks = tickCount > 1 ? Array.from({ length: tickCount }, (_, k) => Math.round((k / (tickCount - 1)) * (times.length - 1))) : [0];

  if (times.length === 0) return <p className="panel-empty">{empty}</p>;

  const single = shown.length === 1 ? shown[0]! : null;
  let peakIx = -1;
  if (single) single.values.forEach((v, i) => v !== null && (peakIx < 0 || v > single.values[peakIx]!) && (peakIx = i));

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * plotW;
    setHover(Math.max(0, Math.min(times.length - 1, Math.round((px / plotW) * (times.length - 1)))));
  };
  const tip = hover === null ? null : shown.map((s) => ({ s, v: s.values[hover] ?? null })).filter((r) => r.v !== null).sort((a, b) => b.v! - a.v!).slice(0, 10);

  return (
    <div className="ch-wrap">
      <div className="ch-box">
        <svg className="ch-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Chart over time" onMouseLeave={() => setHover(null)}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`${uid}-${s.key.replace(/\W/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={s.color} stopOpacity="0.26" />
                <stop offset="1" stopColor={s.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          {grid.map((g) => (
            <g key={g}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(g)} y2={y(g)} className={g === 0 ? 'ch-base' : 'ch-grid'} />
              <text x={PAD.l - 10} y={y(g) + 4} textAnchor="end" className="ch-axis">
                {fmtValue(g, '').replace(/\.0+$/, '')}
              </text>
            </g>
          ))}
          {ticks.map((ti) => (
            <text key={ti} x={x(ti)} y={H - 8} textAnchor="middle" className="ch-axis">
              {fmtTime(times[ti]!, hours)}
            </text>
          ))}
          {unit && (
            <text x={PAD.l - 10} y={12} textAnchor="end" className="ch-axis ch-unit">
              {unit}
            </text>
          )}

          {single && average !== null && average !== undefined && average > 0 && average < top && (
            <g>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(average)} y2={y(average)} className="ch-avg" />
              <text x={W - PAD.r - 4} y={y(average) - 6} textAnchor="end" className="ch-avg-label">
                average {fmtValue(Math.round(average * 10) / 10, unit)}
              </text>
            </g>
          )}

          {single &&
            runs(single.values, x, y).map((r, i) =>
              r.length > 1 ? (
                <path key={`f${i}`} d={`${smoothPath(r)} L${r[r.length - 1]![0].toFixed(1)} ${y(0).toFixed(1)} L${r[0]![0].toFixed(1)} ${y(0).toFixed(1)}Z`} fill={`url(#${uid}-${single.key.replace(/\W/g, '')})`} className="ch-area" />
              ) : null,
            )}
          {shown.map((s) =>
            runs(s.values, x, y).map((r, i) => (
              <path key={`${s.key}${i}`} d={smoothPath(r)} fill="none" stroke={s.color} strokeWidth={shown.length > 4 ? 1.6 : 2.1} strokeLinejoin="round" strokeLinecap="round" pathLength={1} className="draw ch-line" />
            )),
          )}

          {single && peakIx >= 0 && hover === null && (
            <g className="ch-peak">
              <circle cx={x(peakIx)} cy={y(single.values[peakIx]!)} r={4.5} fill={single.color} stroke="var(--card)" strokeWidth={2} />
              <text x={Math.min(Math.max(x(peakIx), PAD.l + 28), W - PAD.r - 28)} y={y(single.values[peakIx]!) - 11} textAnchor="middle" className="ch-peak-label">
                peak {fmtValue(Math.round(single.values[peakIx]! * 10) / 10, unit)}
              </text>
            </g>
          )}

          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + plotH} className="ch-guide" />
              {shown.map((s) => {
                const v = s.values[hover];
                return v === null || v === undefined ? null : <circle key={s.key} cx={x(hover)} cy={y(v)} r={4.5} fill={s.color} stroke="var(--card)" strokeWidth={2} />;
              })}
            </g>
          )}
          <rect x={PAD.l} y={PAD.t} width={plotW} height={plotH} fill="transparent" onMouseMove={onMove} />
        </svg>
        {hover !== null && tip && (
          <div className="ch-tip" style={{ left: `${(x(hover) / W) * 100}%`, ['--flip' as string]: hover > times.length * 0.62 ? '-104%' : '4%' }}>
            <b>{fmtTime(times[hover]!, hours)}</b>
            {tip.length === 0 ? (
              <span>no readings</span>
            ) : (
              tip.map((r) => (
                <span key={r.s.key}>
                  <i style={{ background: r.s.color }} />
                  {r.s.label}
                  <em>{fmtValue(r.v, unit)}</em>
                </span>
              ))
            )}
          </div>
        )}
      </div>
      {series.length > 1 && (
        <div className="ch-legend" role="group" aria-label="Series">
          {series.map((s) => (
            <button
              key={s.key}
              type="button"
              className={off.has(s.key) ? 'off' : ''}
              aria-pressed={!off.has(s.key)}
              onClick={() => setOff((cur) => { const n = new Set(cur); if (n.has(s.key)) n.delete(s.key); else n.add(s.key); return n; })}
            >
              <i style={{ background: s.color }} />
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** One row per bot, one column per time slot, darker = more. Hover a cell to read it. */
export function Heatmap({ bots, times, hours, unit }: { bots: Bot[]; times: number[]; hours: number; unit: string }) {
  const [hint, setHint] = useState<string | null>(null);
  const max = useMemo(() => Math.max(0, ...bots.flatMap((b) => [...b.vals.values()])), [bots]);
  if (bots.length === 0 || times.length === 0) return <p className="panel-empty">No bots match the filters.</p>;
  const LABEL = 132;
  const RH = 14;
  const plotW = W - LABEL - 8;
  const cw = plotW / times.length;
  const height = bots.length * RH + 24;
  const tickN = Math.min(6, times.length);
  const ticks = tickN > 1 ? Array.from({ length: tickN }, (_, k) => Math.round((k / (tickN - 1)) * (times.length - 1))) : [0];
  return (
    <div className="ch-heat">
      <div className="ch-heat-top">
        <p className="ch-hint" aria-live="polite">
          {hint ?? 'Hover a cell to read it.'}
        </p>
        <span className="ch-ramp" aria-hidden>
          <em>0</em>
          <i />
          <em>{fmtValue(Math.round(max * 10) / 10, unit)}</em>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${height}`} className="ch-svg" role="img" aria-label="Heatmap of bots over time" onMouseLeave={() => setHint(null)}>
        {bots.map((b, r) => (
          <g key={b.id} className="ch-heat-row" style={{ ['--r' as string]: Math.min(r, 28) }}>
            <text x={LABEL - 10} y={r * RH + RH - 3} textAnchor="end" className="ch-axis">
              {b.group} · {b.name.replace(/^RecordingService_/, '')}
            </text>
            {times.map((t, c) => {
              const v = b.vals.get(t);
              const pct = v === undefined ? 0 : max > 0 ? 8 + 82 * (v / max) : 8;
              return (
                <rect
                  key={t}
                  x={LABEL + c * cw}
                  y={r * RH + 1.5}
                  width={Math.max(cw - 1.2, 1)}
                  height={RH - 3}
                  rx={3}
                  style={{ fill: v === undefined ? 'var(--card-2)' : `color-mix(in srgb, var(--accent) ${pct.toFixed(0)}%, var(--card-2))` }}
                  opacity={v === undefined ? 0.3 : 1}
                  onMouseEnter={() => setHint(`${b.customer} · ${b.group} · ${b.name} · ${fmtTime(t, hours)} · ${v === undefined ? 'no reading' : fmtValue(v, unit)}`)}
                />
              );
            })}
          </g>
        ))}
        {ticks.map((ti) => (
          <text key={ti} x={LABEL + ti * cw + cw / 2} y={bots.length * RH + 16} textAnchor="middle" className="ch-axis">
            {fmtTime(times[ti]!, hours)}
          </text>
        ))}
      </svg>
    </div>
  );
}

export interface BarItem {
  key: string;
  label: string;
  sub?: string;
  value: number | null;
  display: string;
  max: number;
  color: string;
  warn?: boolean;
  onClick?: () => void;
}

export function Bars({ items, empty = 'Nothing to show.' }: { items: BarItem[]; empty?: string }) {
  if (items.length === 0) return <p className="panel-empty">{empty}</p>;
  return (
    <ul className="ch-bars">
      {items.map((it) => (
        <li key={it.key} className={it.onClick ? 'clickable' : ''}>
          <button type="button" disabled={!it.onClick} onClick={it.onClick}>
            <span className="ch-bar-top">
              <span className="ch-bar-label">
                <i style={{ background: it.color }} aria-hidden />
                {it.label}
              </span>
              <span className="ch-bar-val">{it.display}</span>
            </span>
            <span className="ch-bar-track">
              <span className="ch-bar-fill" style={{ width: `${Math.max(it.value ? 2 : 0, Math.min(100, ((it.value ?? 0) / (it.max || 1)) * 100))}%`, background: it.color }} />
            </span>
            {it.sub && <span className={`ch-bar-sub${it.warn ? ' warn' : ''}`}>{it.sub}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Spark({ bot, times }: { bot: Bot; times: number[] }) {
  const vals = times.map((t) => bot.vals.get(t) ?? null);
  const pts = vals.filter((v): v is number => v !== null);
  if (pts.length < 2) return <span className="ch-nospark">–</span>;
  const w = 110;
  const h = 26;
  const max = Math.max(...pts, 1);
  const x = (i: number) => (i / (vals.length - 1)) * w;
  const y = (v: number) => h - 3 - (v / max) * (h - 7);
  return (
    <svg className="ch-spark" viewBox={`0 0 ${w} ${h}`} aria-hidden>
      {runs(vals, x, y).map((r, i) => (
        <path key={i} d={smoothPath(r)} fill="none" stroke="var(--accent)" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
      ))}
    </svg>
  );
}
