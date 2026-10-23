import { Suspense, useEffect, useId, useState, type ReactNode } from 'react';
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


/**
 * A solid 3D pie, like a chart on a presentation slide: every slice is a thick wedge that sits slightly apart from the
 * others on a round platform, hovering pulls one further out, and each slice has a callout with its share, name and count.
 */
interface PieArc extends Segment {
  i: number;
}
function Pie3D({
  uid,
  arcs,
  total,
  hover,
  setHover,
  label,
  sig,
}: {
  uid: string;
  arcs: PieArc[];
  total: number;
  hover: number | null;
  setHover: (i: number | null) => void;
  label: string;
  sig: string;
}) {
  const W = 500;
  const H = 240;
  const cx = 250;
  const cy = 100;
  const rx = 96;
  const ry = 56;
  const t = 24; // thickness
  const n = arcs.length;
  const base = n > 1 ? 9 : 0;
  const pt = (a: number, k = 1): [number, number] => [cx + rx * k * Math.cos(a), cy + ry * k * Math.sin(a)];
  let acc = -Math.PI / 2;
  const sl = arcs.map((a) => {
    const sweep = (a.value / total) * Math.PI * 2;
    const a0 = acc;
    const a1 = acc + sweep;
    acc = a1;
    const m = (a0 + a1) / 2;
    const ex = hover === a.i ? base + 10 : base;
    return { ...a, a0, a1, m, sweep, dx: Math.cos(m) * ex, dy: Math.sin(m) * ex * (ry / rx), pct: Math.round((a.value / total) * 100) };
  });
  const order = [...sl].sort((p, q) => Math.sin(p.m) - Math.sin(q.m)); // far slices first

  // callouts: one column on each side, spread so they never overlap
  const place = (side: 'l' | 'r') => {
    const list = sl.filter((s) => (Math.cos(s.m) >= 0 ? 'r' : 'l') === side).map((s) => ({ s, y: Math.max(26, Math.min(H - 44, cy + (ry + 34) * Math.sin(s.m))) }));
    list.sort((p, q) => p.y - q.y);
    const gap = Math.min(42, (H - 60) / Math.max(list.length, 1));
    for (let k = 1; k < list.length; k++) list[k]!.y = Math.max(list[k]!.y, list[k - 1]!.y + gap);
    const over = (list[list.length - 1]?.y ?? 0) - (H - 44);
    if (over > 0) list.forEach((l) => (l.y -= over));
    return list;
  };
  const callouts = [...place('l').map((c) => ({ ...c, side: 'l' as const })), ...place('r').map((c) => ({ ...c, side: 'r' as const }))];

  const wall = (a0: number, a1: number) => {
    const [x0, y0] = pt(a0);
    const [x1, y1] = pt(a1);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M${x0} ${y0} A${rx} ${ry} 0 ${large} 1 ${x1} ${y1} L${x1} ${y1 + t} A${rx} ${ry} 0 ${large} 0 ${x0} ${y0 + t}Z`;
  };
  const tone = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, #000)`;

  return (
    <svg key={sig} className="pie3" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <defs>
        {sl.map((s) => (
          <g key={s.label}>
            <linearGradient id={`${uid}-t${s.i}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" style={{ stopColor: `color-mix(in srgb, ${s.color} 60%, #fff)` }} />
              <stop offset="0.5" style={{ stopColor: s.color }} />
              <stop offset="1" style={{ stopColor: tone(s.color, 82) }} />
            </linearGradient>
            <linearGradient id={`${uid}-w${s.i}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" style={{ stopColor: tone(s.color, 60) }} />
              <stop offset="0.45" style={{ stopColor: tone(s.color, 78) }} />
              <stop offset="1" style={{ stopColor: tone(s.color, 48) }} />
            </linearGradient>
          </g>
        ))}
        <radialGradient id={`${uid}-plat`} cx="0.5" cy="0.4" r="0.7">
          <stop offset="0" style={{ stopColor: 'var(--card-2)' }} />
          <stop offset="1" style={{ stopColor: 'color-mix(in srgb, var(--card-2) 70%, #000)' }} />
        </radialGradient>
      </defs>

      {/* platform and ground shadow */}
      <ellipse cx={cx} cy={cy + t + 30} rx={rx + 46} ry={ry + 14} fill="#000" opacity={0.28} style={{ filter: 'blur(9px)' }} />
      <ellipse cx={cx} cy={cy + t + 8} rx={rx + 34} ry={ry + 20} fill="color-mix(in srgb, var(--card-2) 55%, #000)" />
      <ellipse cx={cx} cy={cy + t} rx={rx + 34} ry={ry + 20} fill={`url(#${uid}-plat)`} stroke="var(--border-strong)" strokeWidth={1} />

      {order.map((s) => {
        const single = n === 1;
        const [sx, sy] = pt(s.a0);
        const [ex, ey] = pt(s.a1);
        const top = single
          ? `M${cx - rx} ${cy} A${rx} ${ry} 0 1 1 ${cx + rx} ${cy} A${rx} ${ry} 0 1 1 ${cx - rx} ${cy}Z`
          : `M${cx} ${cy} L${sx} ${sy} A${rx} ${ry} 0 ${s.sweep > Math.PI ? 1 : 0} 1 ${ex} ${ey}Z`;
        const front = single ? [0, Math.PI] : [Math.max(s.a0, 0), Math.min(s.a1, Math.PI)];
        const quad = (a: number) => {
          const [x, y] = pt(a);
          return `M${cx} ${cy} L${x} ${y} L${x} ${y + t} L${cx} ${cy + t}Z`;
        };
        return (
          <g
            key={s.label}
            className={`pie3-slice${s.onClick ? ' clickable' : ''}${hover === s.i ? ' on' : ''}`}
            style={{ transform: `translate(${s.dx}px, ${s.dy}px)`, opacity: hover !== null && hover !== s.i ? 0.82 : 1 }}
            onMouseEnter={() => setHover(s.i)}
            onMouseLeave={() => setHover(null)}
            onClick={s.onClick}
          >
            <g className="pie3-pop" style={{ animationDelay: `${s.i * 0.1}s` }}>
              {!single && Math.cos(s.a0) < 0 && <path d={quad(s.a0)} fill={tone(s.color, 52)} />}
              {!single && Math.cos(s.a1) > 0 && <path d={quad(s.a1)} fill={tone(s.color, 58)} />}
              {front[1]! > front[0]! && <path d={wall(front[0]!, front[1]!)} fill={`url(#${uid}-w${s.i})`} />}
              <path d={top} fill={`url(#${uid}-t${s.i})`} stroke="rgba(255,255,255,0.28)" strokeWidth={1} strokeLinejoin="round" />
              <title>{`${s.label}: ${s.value} (${s.pct}%)${s.onClick ? ' · click to filter' : ''}`}</title>
            </g>
          </g>
        );
      })}

      {callouts.map(({ s, y, side }) => {
        const right = side === 'r';
        const ax = cx + s.dx + 0.86 * rx * Math.cos(s.m);
        const ay = cy + s.dy + 0.86 * ry * Math.sin(s.m);
        const ex = right ? cx + rx + 30 : cx - rx - 30;
        const lx = ex + (right ? 8 : -8);
        const tx = lx + (right ? 4 : -4);
        const anchor = right ? 'start' : 'end';
        return (
          <g
            key={s.label}
            className={`pie3-call${hover === s.i ? ' on' : ''}${s.onClick ? ' clickable' : ''}`}
            onMouseEnter={() => setHover(s.i)}
            onMouseLeave={() => setHover(null)}
            onClick={s.onClick}
          >
            <polyline points={`${ax},${ay} ${ex},${y} ${lx},${y}`} fill="none" stroke={s.color} strokeWidth={1.4} strokeLinejoin="round" />
            <circle cx={ax} cy={ay} r={2.6} fill={s.color} stroke="var(--card)" strokeWidth={1} />
            <text x={tx} y={y - 8} textAnchor={anchor} className="pie3-pct" fill="var(--text-1)">
              {s.pct}%
            </text>
            <text x={tx} y={y + 5} textAnchor={anchor} className="pie3-name" fill="var(--text-2)">
              {fit(s.label, 19)}
            </text>
            <text x={tx} y={y + 17} textAnchor={anchor} className="pie3-sub mono" fill="var(--text-3)">
              {s.value} of {total}
            </text>
          </g>
        );
      })}
    </svg>
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
          <Pie3D uid={uid} arcs={arcs} total={total} hover={hover} setHover={setHover} label={centerLabel} sig={sig} />
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
