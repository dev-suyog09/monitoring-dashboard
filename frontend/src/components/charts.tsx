import { lazy, Suspense, useEffect, useId, useState, type ReactNode } from 'react';
import { getSettings, updateSettings, useSettings } from '../lib/settings';
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

// the solid 3D pie is only needed when "3D charts" is switched on: its code is fetched then, not with the first page
const Pie3D = lazy(() => import('./Pie3D'));

/** Keeps the label inside the ring. */
const fit = (t: string, max = 17): string => (t.length > max ? `${t.slice(0, max - 1)}…` : t);

function CenterNum({ n }: { n: number }) {
  return <>{Math.round(useCountUp(n, 900))}</>;
}

/**
 * With "3D charts" off (the default) this is a plain flat box. With it on, a tilted "stage" that gives a ring real depth: the ring is drawn once for the top face and several more times behind it,
 * each copy a little deeper and darker (CSS 3D, `translateZ`), so the ring has a visible thickness like a solid disc.
 * A soft ground shadow sits underneath and the centre text stays upright on top.
 */
export function Stage3D({
  size = 168,
  depth = 9,
  tilt = 44,
  center,
  children,
}: {
  size?: number;
  depth?: number;
  tilt?: number;
  center?: ReactNode;
  /** Draws the ring. `side` is true for the extrusion layers behind the top face (no text, no events). */
  children: (side: boolean) => ReactNode;
}) {
  const three = useSettings().charts3d;
  if (!three) {
    depth = 0;
    tilt = 0;
  }
  const rad = (tilt * Math.PI) / 180;
  const h = three ? Math.round(size * Math.cos(rad) + depth * Math.sin(rad) + 10) : size;
  const layers = Array.from({ length: depth }, (_, i) => depth - i); // deepest first
  return (
    <div className={`stage3d${three ? '' : ' flat'}`} style={{ width: size, height: h }}>
      <div className="stage3d-plane" style={{ width: size, height: size, top: (h - size) / 2, transform: three ? `rotateX(${tilt}deg)` : 'none' }}>
        {layers.map((z) => (
          <div
            key={z}
            className="stage3d-layer side"
            aria-hidden
            style={{ transform: `translateZ(${-z}px)`, filter: `brightness(${(0.44 + (depth - z) * 0.04).toFixed(2)})` }}
          >
            {children(true)}
          </div>
        ))}
        <div className="stage3d-layer top">{children(false)}</div>
      </div>
      <span className="stage3d-shadow" aria-hidden />
      {center && <div className="stage3d-center">{center}</div>}
    </div>
  );
}


/** Donut: a flat ring, or with 3D charts on a solid exploded pie. Slices appear one after another, the centre counts up, hovering a slice shows its numbers. */
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
  const uid = useId().replace(/:/g, '');
  const three = useSettings().charts3d;
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

  const ring = (side: boolean) => (
    <svg key={sig} viewBox="0 0 140 140" role={side ? undefined : 'img'} aria-label={side ? undefined : centerLabel} aria-hidden={side || undefined}>
      {!side && three && (
        <defs>
          {arcs.map((a) => (
            <linearGradient key={a.label} id={`${uid}-g${a.i}`} gradientUnits="userSpaceOnUse" x1="14" y1="8" x2="124" y2="132">
              <stop offset="0" style={{ stopColor: `color-mix(in srgb, ${a.color} 55%, #fff)` }} />
              <stop offset="0.55" style={{ stopColor: a.color }} />
              <stop offset="1" style={{ stopColor: `color-mix(in srgb, ${a.color} 78%, #000)` }} />
            </linearGradient>
          ))}
        </defs>
      )}
      <circle cx={70} cy={70} r={r} fill="none" stroke="var(--card-2)" strokeWidth={sw} />
      {arcs.map((a) => (
        <circle
          key={a.label}
          className={`donut-seg${a.onClick && !side ? ' clickable' : ''}`}
          cx={70}
          cy={70}
          r={r}
          fill="none"
          stroke={side || !three ? a.color : `url(#${uid}-g${a.i})`}
          strokeWidth={!side && hover === a.i ? sw + 3 : sw}
          strokeDasharray={`${Math.max(a.len - gap, 0.001)} ${C}`}
          strokeDashoffset={-a.off}
          transform="rotate(-90 70 70)"
          style={{
            ['--circ' as string]: C,
            animationDelay: `${a.i * 0.12}s`,
            filter: !side && hover === a.i ? `drop-shadow(0 0 6px ${a.color})` : undefined,
          }}
          onMouseEnter={side ? undefined : () => setHover(a.i)}
          onMouseLeave={side ? undefined : () => setHover(null)}
          onClick={side ? undefined : a.onClick}
        >
          {!side && <title>{`${a.label}: ${a.value}${a.onClick ? ' · click to filter' : ''}`}</title>}
        </circle>
      ))}
    </svg>
  );

  return (
    <div className={`donut-wrap${three ? ' donut-3d' : ''}`}>
      {three ? (
        <>
          <Suspense fallback={<div className="skeleton" style={{ width: 'min(100%, 460px)', height: 220 }} />}>
            <Pie3D uid={uid} arcs={arcs} total={total} hover={hover} setHover={setHover} label={centerLabel} sig={sig} />
          </Suspense>
          <div className="dc3-cap">
            <b className="mono">{h ? h.value : <CenterNum n={center} />}</b>
            <span className="dc-label">{fit(h ? h.label : centerLabel, 24)}</span>
          </div>
        </>
      ) : (
        <Stage3D
          center={
            <div className="dc">
              <span className="dc-num mono">{h ? h.value : <CenterNum n={center} />}</span>
              <span className="dc-label" style={{ fontSize: (h ? h.label : centerLabel).length > 12 ? 10 : 11.5 }}>
                {fit(h ? h.label : centerLabel)}
              </span>
            </div>
          }
        >
          {ring}
        </Stage3D>
      )}
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
            <span className="dot" style={{ backgroundColor: s.color }} />
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
              style={{ width: `${Math.max(2, Math.min(100, (r.value / r.max) * 100))}%`, backgroundColor: r.color, animationDelay: `${i * 70}ms` }}
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
                  style={{ width: `${(p.value / max) * 100}%`, backgroundColor: p.color, animationDelay: `${i * 70 + j * 90}ms` }}
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
  const { autoCharts: auto, charts3d } = useSettings();
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
        <button
          type="button"
          role="switch"
          aria-checked={charts3d}
          aria-label="3D charts"
          className={`ins-3d${charts3d ? ' on' : ''}`}
          title="Switch between flat and 3D charts"
          onClick={(e) => {
            e.stopPropagation();
            updateSettings({ charts3d: !charts3d });
          }}
          onKeyDown={(e) => e.stopPropagation()}
        >
          3D
        </button>
        <span className="ins-btn">
          {open ? 'Hide' : 'Show'} {label}
          <span className="ins-chev" aria-hidden>
            ▾
          </span>
        </span>
      </div>
      {open && (
        <div className="chart-grid charts-full">
          <Suspense fallback={<div className="skeleton" style={{ height: 220, gridColumn: '1 / -1' }} />}>{children}</Suspense>
        </div>
      )}
    </>
  );
}
