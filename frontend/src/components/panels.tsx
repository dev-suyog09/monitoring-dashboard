import { useId, useState, type ReactNode } from 'react';
import { useCountUp } from '../lib/useCountUp';
import { useSettings } from '../lib/settings';
import { Stage3D } from './charts';
import type { DayPoint } from '../lib/history';

/** A Grafana-style panel: title strip on top, body below. */
export function Panel({
  title,
  right,
  children,
  className = '',
  bodyClass = '',
  style,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
  style?: React.CSSProperties;
}) {
  return (
    <section className={`panel ${className}`} style={style}>
      <div className="panel-hd">
        <h3>{title}</h3>
        {right}
      </div>
      <div className={`panel-bd ${bodyClass}`}>{children}</div>
    </section>
  );
}

/** Tiny inline area+line sparkline. */
/** Smooth path through the points (Catmull-Rom converted to cubic Béziers, clamped so it never overshoots). */
export function smoothPath(pts: Array<[number, number]>): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M${pts[0]![0]},${pts[0]![1]}`;
  let d = `M${pts[0]![0].toFixed(1)},${pts[0]![1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const lo = Math.min(p1[1], p2[1]);
    const hi = Math.max(p1[1], p2[1]);
    const c1y = Math.min(hi, Math.max(lo, p1[1] + (p2[1] - p0[1]) / 6));
    const c2y = Math.min(hi, Math.max(lo, p2[1] - (p3[1] - p1[1]) / 6));
    d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${c1y.toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

export function Sparkline({
  values,
  color = 'var(--accent)',
  width = 140,
  height = 30,
}: {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (values.length === 0) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const pts = values.map((v, i) => {
    const x = i * step;
    const y = height - 2 - ((v - min) / range) * (height - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const xy = pts.map((p) => p.split(',').map(Number) as [number, number]);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden>
      <path d={`${smoothPath(xy)} L${width},${height} L0,${height} Z`} fill={color} opacity={0.14} />
      <path d={smoothPath(xy)} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" pathLength={1} className="draw" />
    </svg>
  );
}

/** A number that counts up; "249/259"-style values animate both halves. */
function CountNum({ n }: { n: number }) {
  return <>{Math.round(useCountUp(n))}</>;
}
export function AnimatedValue({ value }: { value: number | string }) {
  if (typeof value === 'number') return <CountNum n={value} />;
  const m = /^(\d+)\/(\d+)$/.exec(value);
  if (m) {
    return (
      <>
        <CountNum n={Number(m[1])} />/<CountNum n={Number(m[2])} />
      </>
    );
  }
  return <>{value}</>;
}

/** Big-number stat panel, optionally clickable (to filter) and with a sparkline. */
export function StatPanel({
  label,
  value,
  scope,
  spark,
  sparkColor,
  onClick,
  active,
}: {
  label: string;
  value: number | string;
  /** status scope class (st-ok/st-warn/st-err/st-idle) → colors the number. */
  scope?: string;
  spark?: number[];
  sparkColor?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      className={`panel stat ${scope ?? ''} ${active ? 'stat-on' : ''}`}
      onClick={onClick}
      type={onClick ? 'button' : undefined}
    >
      <div className="stat-label">{label}</div>
      <div className="stat-val mono" style={{ color: scope ? 'var(--c-fg)' : 'var(--text-1)' }}>
        <AnimatedValue value={value} />
      </div>
      {spark && spark.length > 0 ? (
        <Sparkline values={spark} color={sparkColor ?? 'var(--c)'} />
      ) : (
        <div style={{ height: 30 }} />
      )}
    </Tag>
  );
}

/**
 * Daily archive coverage over the last N days. The line draws itself, the area sweeps in, the points pop in one
 * by one, and hovering shows a guide line with that day's numbers. It replays whenever the data changes (e.g. a filter).
 */
export function CoverageChart({ series, monitorable }: { series: DayPoint[]; monitorable: number }) {
  const uid = useId().replace(/:/g, '');
  const three = useSettings().charts3d;
  const [hover, setHover] = useState<number | null>(null);

  const W = 760;
  const H = 240;
  const padL = 30;
  const padR = 14;
  const padT = 14;
  const padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxY = Math.max(monitorable, ...series.map((d) => d.covered), 1);

  const x = (i: number) => padL + (series.length > 1 ? (i / (series.length - 1)) * plotW : plotW / 2);
  const y = (v: number) => padT + (1 - v / maxY) * plotH;

  const xy = series.map((d, i): [number, number] => [x(i), y(d.covered)]);
  const line = smoothPath(xy);
  const area = `${line} L${(padL + plotW).toFixed(1)},${(padT + plotH).toFixed(1)} L${padL},${(padT + plotH).toFixed(1)} Z`;
  const gridVals = [0, Math.round(maxY / 2), maxY];
  const sig = `${monitorable}|${series.map((d) => d.covered).join(',')}`; // replay the animation when this changes

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    series.forEach((_, i) => {
      if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    });
    setHover(best);
  };

  const h = hover !== null ? series[hover] : null;

  return (
    <div className="cov-wrap" style={{ position: 'relative' }}>
      <svg
        key={sig}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label="Daily archive coverage, last 7 days"
        style={{ display: 'block', height: 'auto' }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--ok)" stopOpacity="0.38" />
            <stop offset="1" stopColor="var(--ok)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${uid}-stroke`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="var(--accent)" />
            <stop offset="1" stopColor="var(--ok)" />
          </linearGradient>
          {three && <radialGradient id={`${uid}-sphere`} cx="0.35" cy="0.3" r="0.8">
            <stop offset="0" stopColor="#fff" stopOpacity="0.95" />
            <stop offset="0.42" style={{ stopColor: 'var(--ok)' }} />
            <stop offset="1" style={{ stopColor: 'color-mix(in srgb, var(--ok) 55%, #000)' }} />
          </radialGradient>}
          <clipPath id={`${uid}-clip`}>
            <rect className="reveal" x={0} y={0} width={W} height={H} />
          </clipPath>
        </defs>

        {gridVals.map((g) => (
          <g key={g}>
            <line x1={padL} x2={padL + plotW} y1={y(g)} y2={y(g)} stroke="var(--border)" strokeWidth={1} />
            <text x={padL - 6} y={y(g) + 3} textAnchor="end" fontSize={10} fill="var(--text-3)" className="mono">
              {g}
            </text>
          </g>
        ))}
        {/* reference line: total monitorable accounts (marching dashes) */}
        <line
          x1={padL}
          x2={padL + plotW}
          y1={y(monitorable)}
          y2={y(monitorable)}
          stroke="var(--accent-2)"
          strokeWidth={1}
          strokeDasharray="4 4"
          opacity={0.75}
          className="march"
        />

        <g clipPath={`url(#${uid}-clip)`}>
          <path d={area} fill={`url(#${uid}-fill)`} />
        </g>
        {/* the ribbon: copies of the line stacked downwards, each darker, give it a visible thickness */}
        <g className="cov-3d">
          {(three ? [7, 6, 5, 4, 3, 2, 1] : []).map((i) => (
            <path
              key={i}
              d={line}
              transform={`translate(0 ${i * 1.4})`}
              fill="none"
              stroke={`url(#${uid}-stroke)`}
              strokeWidth={2.75}
              strokeLinejoin="round"
              strokeLinecap="round"
              pathLength={1}
              className="draw cov-line"
              style={{ filter: `brightness(${(0.42 + (7 - i) * 0.05).toFixed(2)})` }}
            />
          ))}
          <path
            d={line}
            fill="none"
            stroke={`url(#${uid}-stroke)`}
            strokeWidth={three ? 3.25 : 2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            pathLength={1}
            className="draw cov-line"
          />
        </g>

        {h && hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + plotH} stroke="var(--accent)" strokeWidth={1} strokeDasharray="3 3" opacity={0.7} />
        )}

        {series.map((d, i) => (
          <g key={d.date}>
            {three && <ellipse className="pt" style={{ animationDelay: `${0.35 + i * 0.13}s` }} cx={x(i)} cy={y(d.covered) + 11} rx={hover === i ? 7 : 5} ry={1.8} fill="#000" opacity={0.14} />}
            <circle
              className="pt"
              style={{ animationDelay: `${0.35 + i * 0.13}s` }}
              cx={x(i)}
              cy={y(d.covered)}
              r={hover === i ? 6.5 : 4.6}
              fill={three ? `url(#${uid}-sphere)` : 'var(--ok)'}
              stroke="var(--card)"
              strokeWidth={1}
            />
            <text x={x(i)} y={H - 8} textAnchor="middle" fontSize={10} fill={hover === i ? 'var(--text-1)' : 'var(--text-3)'} className="mono">
              {d.date.slice(5)}
            </text>
          </g>
        ))}
        <rect x={padL} y={padT} width={plotW} height={plotH} fill="transparent" />
      </svg>

      {h && hover !== null && (
        <div className="cov-tip mono" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(h.covered) / H) * 100}%` }}>
          <strong>{h.date}</strong>
          <span>
            {h.covered}/{monitorable} archived
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Radial health gauge (0–100%): the arc sweeps in with the number counting up, a gradient stroke that glows
 * (and breathes), tick marks that light up as it fills, a dot riding the arc tip and a slowly rotating outer ring.
 */
export function Gauge({ pct, sub }: { pct: number; sub: string }) {
  const uid = useId().replace(/:/g, '');
  const v = useCountUp(pct, 1200);
  const r = 54;
  const circ = 2 * Math.PI * r;
  const dash = (v / 100) * circ;
  const level = pct >= 90 ? 'ok' : pct >= 70 ? 'warn' : 'err';
  const color = `var(--${level})`;
  const theta = ((-90 + (v / 100) * 360) * Math.PI) / 180;
  const tipX = 74 + r * Math.cos(theta);
  const tipY = 74 + r * Math.sin(theta);
  const TICKS = 48;

  const arc = (side: boolean) => (
    <svg viewBox="0 0 148 148" aria-hidden style={{ overflow: 'visible' }}>
      {!side && (
        <defs>
          <linearGradient id={`${uid}-arc`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: `color-mix(in srgb, ${color} 55%, #fff)` }} />
            <stop offset="0.5" stopColor={color} />
            <stop offset="1" style={{ stopColor: `color-mix(in srgb, ${color} 80%, #000)` }} />
          </linearGradient>
        </defs>
      )}
      {!side && (
        <g className="gauge-spin">
          <circle cx={74} cy={74} r={71} fill="none" stroke="var(--border-strong)" strokeWidth={1} strokeDasharray="2 7" opacity={0.7} />
        </g>
      )}
      {!side &&
        Array.from({ length: TICKS }, (_, i) => {
          const a = (i / TICKS) * Math.PI * 2 - Math.PI / 2;
          const on = (i / TICKS) * 100 < v;
          return (
            <line
              key={i}
              x1={74 + 63 * Math.cos(a)}
              y1={74 + 63 * Math.sin(a)}
              x2={74 + 67 * Math.cos(a)}
              y2={74 + 67 * Math.sin(a)}
              stroke={on ? color : 'var(--border-strong)'}
              strokeWidth={on ? 1.8 : 1}
              opacity={on ? 0.95 : 0.55}
              strokeLinecap="round"
            />
          );
        })}
      <circle cx={74} cy={74} r={r} fill="none" stroke="var(--card-2)" strokeWidth={12} />
      <circle
        className="gauge-arc"
        style={{ ['--g' as string]: color }}
        cx={74}
        cy={74}
        r={r}
        fill="none"
        stroke={side ? color : `url(#${uid}-arc)`}
        strokeWidth={12}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circ}`}
        transform="rotate(-90 74 74)"
      />
      {!side && v > 1 && <circle cx={tipX} cy={tipY} r={4} fill="#fff" opacity={0.95} style={{ filter: `drop-shadow(0 0 5px ${color})` }} />}
    </svg>
  );

  return (
    <div className="gauge-wrap" role="img" aria-label={`${pct}% healthy`}>
      <Stage3D
        size={176}
        depth={9}
        tilt={42}
        center={
          <div className="dc">
            <span className="dc-num mono">{Math.round(v)}%</span>
            <span className="dc-label">healthy</span>
          </div>
        }
      >
        {arc}
      </Stage3D>
      <div className="gauge-sub">{sub}</div>
    </div>
  );
}
