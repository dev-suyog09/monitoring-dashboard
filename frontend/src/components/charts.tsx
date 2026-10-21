import { useEffect, useState, type ReactNode } from 'react';
import { getSettings, useSettings } from '../lib/settings';
import { useCountUp } from '../lib/useCountUp';

/* Small animated chart pieces shared by the on-demand "charts" sections of the Customers, Cloud Instances and
   Databases tabs. Nothing here renders until the user opens the section, so every open replays the animation. */

export interface Segment {
  label: string;
  value: number;
  color: string;
  /** Click handler: applies the matching filter on the tab. */
  onClick?: () => void;
}

/** Keeps the label inside the ring. */
const fit = (t: string, max = 17): string => (t.length > max ? `${t.slice(0, max - 1)}…` : t);

function CenterNum({ n }: { n: number }) {
  return <>{Math.round(useCountUp(n, 900))}</>;
}

/** Donut: segments sweep in one after another, the centre counts up, hovering a slice highlights it and shows its numbers. */
export function Donut({
  segments,
  center,
  centerLabel,
  empty = 'Nothing to show yet',
}: {
  segments: Segment[];
  center: number;
  centerLabel: string;
  empty?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const live = segments.filter((s) => s.value > 0);
  const total = live.reduce((n, s) => n + s.value, 0);
  const r = 50;
  const sw = 15;
  const C = 2 * Math.PI * r;
  const gap = live.length > 1 ? 3 : 0;
  let acc = 0;
  const arcs = live.map((s, i) => {
    const len = total ? (s.value / total) * C : 0;
    const a = { ...s, len, off: acc, i };
    acc += len;
    return a;
  });
  const h = hover !== null ? arcs[hover] : null;
  const sig = live.map((s) => s.value).join(','); // replay when the numbers change

  if (total === 0) return <p className="panel-empty">{empty}</p>;

  return (
    <div className="donut-wrap">
      <svg key={sig} width={150} height={150} viewBox="0 0 140 140" role="img" aria-label={centerLabel}>
        <circle cx={70} cy={70} r={r} fill="none" stroke="var(--card-2)" strokeWidth={sw} />
        {arcs.map((a) => (
          <circle
            key={a.label}
            className={`donut-seg${a.onClick ? ' clickable' : ''}`}
            onClick={a.onClick}
            cx={70}
            cy={70}
            r={r}
            fill="none"
            stroke={a.color}
            strokeWidth={hover === a.i ? sw + 3 : sw}
            strokeDasharray={`${Math.max(a.len - gap, 0.001)} ${C}`}
            strokeDashoffset={-a.off}
            transform="rotate(-90 70 70)"
            style={{
              ['--circ' as string]: C,
              animationDelay: `${a.i * 0.12}s`,
              filter: hover === a.i ? `drop-shadow(0 0 6px ${a.color})` : undefined,
            }}
            onMouseEnter={() => setHover(a.i)}
            onMouseLeave={() => setHover(null)}
          >
            <title>{`${a.label}: ${a.value}${a.onClick ? ' · click to filter' : ''}`}</title>
          </circle>
        ))}
        <text x={70} y={72} textAnchor="middle" fontSize={32} fontWeight={800} fill="var(--text-1)" className="mono">
          {h ? h.value : <CenterNum n={center} />}
        </text>
        <text x={70} y={91} textAnchor="middle" fontSize={(h ? h.label : centerLabel).length > 12 ? 10 : 11.5} fontWeight={600} fill="var(--text-2)">
          {fit(h ? h.label : centerLabel)}
        </text>
      </svg>
      <ul className="donut-legend">
        {segments.map((s, i) => (
          <li
            key={s.label}
            className={`${hover !== null && arcs[hover]?.label === s.label ? 'on' : ''}${s.onClick ? ' clickable' : ''}`}
            onClick={s.onClick}
            onMouseEnter={() => {
              const idx = arcs.findIndex((a) => a.label === s.label);
              setHover(idx >= 0 ? idx : null);
            }}
            onMouseLeave={() => setHover(null)}
            style={{ animationDelay: `${0.25 + i * 0.07}s` }}
          >
            <span className="dot" style={{ background: s.color }} />
            <span className="lg-name">{s.label}</span>
            <b className="mono">{s.value}</b>
            <span className="lg-pct mono">{total ? Math.round((s.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface BarRow {
  key: string;
  label: string;
  title?: string;
  value: number;
  max: number;
  display: string;
  sub?: string;
  color: string;
  onClick?: () => void;
  /** Optional threshold tick (same unit as value). */
  marker?: number;
}

/** Horizontal bars that grow from zero, staggered; an optional tick marks a threshold. */
export function HBars({ rows, empty }: { rows: BarRow[]; empty: string }) {
  if (rows.length === 0) return <p className="panel-empty">{empty}</p>;
  const sig = rows.map((r) => `${r.key}:${r.value}`).join('|');
  return (
    <ul className="hbars" key={sig}>
      {rows.map((r, i) => (
        <li key={r.key} title={r.title ?? r.label} className={r.onClick ? 'clickable' : ''} onClick={r.onClick}>
          <div className="hbar-top">
            <span className="hbar-label mono">{r.label}</span>
            <span className="hbar-val mono">{r.display}</span>
          </div>
          <div className="hbar-track">
            <span
              className="hbar-fill"
              style={{ width: `${Math.max(2, Math.min(100, (r.value / r.max) * 100))}%`, background: r.color, animationDelay: `${i * 70}ms` }}
            />
            {r.marker !== undefined && <i className="hbar-marker" style={{ left: `${Math.min(100, (r.marker / r.max) * 100)}%` }} />}
          </div>
          {r.sub && <div className="hbar-sub">{r.sub}</div>}
        </li>
      ))}
    </ul>
  );
}

export interface StackRow {
  key: string;
  label: string;
  title?: string;
  parts: Segment[];
}

/** Stacked horizontal bars (one row per item, one coloured part per state), sharing one scale. */
export function StackBars({ rows, empty }: { rows: StackRow[]; empty: string }) {
  if (rows.length === 0) return <p className="panel-empty">{empty}</p>;
  const sum = (r: StackRow) => r.parts.reduce((n, p) => n + p.value, 0);
  const max = Math.max(...rows.map(sum), 1);
  const sig = rows.map((r) => `${r.key}:${r.parts.map((p) => p.value).join('/')}`).join('|');
  return (
    <ul className="hbars" key={sig}>
      {rows.map((r, i) => (
        <li key={r.key} title={r.title ?? r.label}>
          <div className="hbar-top">
            <span className="hbar-label mono">{r.label}</span>
            <span className="hbar-val mono">{sum(r)}</span>
          </div>
          <div className="hbar-track stack">
            {r.parts
              .filter((p) => p.value > 0)
              .map((p, j) => (
                <span
                  key={p.label}
                  className={`hbar-seg${p.onClick ? ' clickable' : ''}`}
                  onClick={p.onClick}
                  title={`${p.label}: ${p.value}`}
                  style={{ width: `${(p.value / max) * 100}%`, background: p.color, animationDelay: `${i * 70 + j * 90}ms` }}
                />
              ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * The "Visual insights" bar at the top of a tab: one clear call to action. The chart cards (children) are only
 * mounted — and animate in — once it is opened, so closed tabs stay light. "Open charts automatically" in Settings
 * opens it on load.
 */
export function ChartsSection({ children, label = 'charts' }: { children: ReactNode; label?: string }) {
  const auto = useSettings().autoCharts;
  const [open, setOpen] = useState(() => getSettings().autoCharts);
  useEffect(() => {
    if (auto) setOpen(true);
  }, [auto]);
  return (
    <>
      <div
        className={`insights ${open ? 'insights-open' : ''}`}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
      >
        <span className="ins-ico" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className="ins-text">
          <b>Visual insights</b>
          <span>{open ? 'Live charts for the filters you have applied' : 'Charts are drawn only when you ask, which keeps the dashboard fast'}</span>
        </span>
        <span className="ins-btn">
          {open ? 'Hide' : 'Show'} {label}
          <span className="ins-chev" aria-hidden>
            ▾
          </span>
        </span>
      </div>
      {open && <div className="chart-grid charts-full">{children}</div>}
    </>
  );
}
