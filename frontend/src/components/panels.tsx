import type { ReactNode } from 'react';
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
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden>
      <polygon points={`0,${height} ${pts.join(' ')} ${width},${height}`} fill={color} opacity={0.14} />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
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
        {value}
      </div>
      {spark && spark.length > 0 ? (
        <Sparkline values={spark} color={sparkColor ?? 'var(--c)'} />
      ) : (
        <div style={{ height: 30 }} />
      )}
    </Tag>
  );
}

/** Time-series area chart of daily archive coverage over the last N days. */
export function CoverageChart({ series, monitorable }: { series: DayPoint[]; monitorable: number }) {
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

  const line = series.map((d, i) => `${x(i).toFixed(1)},${y(d.covered).toFixed(1)}`).join(' ');
  const area = `${padL},${(padT + plotH).toFixed(1)} ${line} ${(padL + plotW).toFixed(1)},${(padT + plotH).toFixed(1)}`;
  const gridVals = [0, Math.round(maxY / 2), maxY];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="auto" role="img" aria-label="Daily archive coverage, last 7 days" style={{ display: 'block' }}>
      {gridVals.map((g) => (
        <g key={g}>
          <line x1={padL} x2={padL + plotW} y1={y(g)} y2={y(g)} stroke="var(--border)" strokeWidth={1} />
          <text x={padL - 6} y={y(g) + 3} textAnchor="end" fontSize={10} fill="var(--text-3)" className="mono">
            {g}
          </text>
        </g>
      ))}
      {/* reference line: total monitorable accounts */}
      <line x1={padL} x2={padL + plotW} y1={y(monitorable)} y2={y(monitorable)} stroke="var(--accent-2)" strokeWidth={1} strokeDasharray="4 4" opacity={0.7} />
      <polygon points={area} fill="var(--ok)" opacity={0.15} />
      <polyline points={line} fill="none" stroke="var(--ok)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      {series.map((d, i) => (
        <g key={d.date}>
          <circle cx={x(i)} cy={y(d.covered)} r={3} fill="var(--ok)" />
          <title>{`${d.date}: ${d.covered}/${monitorable} archived`}</title>
          <text x={x(i)} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--text-3)" className="mono">
            {d.date.slice(5)}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** Radial health gauge (0–100%). */
export function Gauge({ pct, sub }: { pct: number; sub: string }) {
  const r = 54;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  const color = pct >= 90 ? 'var(--ok)' : pct >= 70 ? 'var(--warn)' : 'var(--err)';
  return (
    <div className="gauge-wrap">
      <svg width={148} height={148} viewBox="0 0 148 148" role="img" aria-label={`${pct}% healthy`}>
        <circle cx={74} cy={74} r={r} fill="none" stroke="var(--card-2)" strokeWidth={12} />
        <circle
          cx={74}
          cy={74}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={12}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          transform="rotate(-90 74 74)"
        />
        <text x={74} y={72} textAnchor="middle" fontSize={30} fontWeight={800} fill="var(--text-1)" className="mono">
          {pct}%
        </text>
        <text x={74} y={92} textAnchor="middle" fontSize={11} fill="var(--text-3)">
          healthy
        </text>
      </svg>
      <div className="gauge-sub">{sub}</div>
    </div>
  );
}
