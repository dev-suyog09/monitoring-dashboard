import { AnimatedValue } from './panels';

export type Tone = 'ok' | 'warn' | 'err' | 'idle' | 'neutral';

export interface Metric {
  key: string;
  label: string;
  value: number | string;
  /** 0-100: draws a small progress ring beside the number. */
  ring?: number;
  /** Small line under the number, e.g. "▼ 3 down". */
  sub?: string;
  tone?: Tone;
  active?: boolean;
  onClick?: () => void;
}

const TONE_VAR: Record<Tone, string> = {
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  err: 'var(--err)',
  idle: 'var(--idle)',
  neutral: 'var(--accent)',
};

function Ring({ pct, color }: { pct: number; color: string }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct));
  return (
    <svg className="mring" width={46} height={46} viewBox="0 0 46 46" aria-hidden>
      <circle cx={23} cy={23} r={r} fill="none" stroke="var(--card-2)" strokeWidth={5} />
      <circle
        key={Math.round(p)}
        className="mring-arc"
        cx={23}
        cy={23}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={5}
        strokeLinecap="round"
        strokeDasharray={`${(p / 100) * c} ${c}`}
        transform="rotate(-90 23 23)"
        style={{ ['--circ' as string]: c }}
      />
    </svg>
  );
}

/** A clean, borderless row of headline numbers (label, big value, optional ring and trend line) — each can be a filter. */
export default function MetricStrip({ metrics }: { metrics: Metric[] }) {
  return (
    <div className="mstrip" role="list">
      {metrics.map((m) => {
        const Tag = m.onClick ? 'button' : 'div';
        const color = TONE_VAR[m.tone ?? 'neutral'];
        return (
          <Tag
            key={m.key}
            role="listitem"
            type={m.onClick ? 'button' : undefined}
            onClick={m.onClick}
            className={`metric ${m.active ? 'metric-on' : ''}`}
            style={{ ['--mc' as string]: color }}
          >
            <span className="metric-main">
              <span className="metric-label">{m.label}</span>
              <span className="metric-val mono">
                <AnimatedValue value={m.value} />
              </span>
              {m.sub && <span className="metric-sub">{m.sub}</span>}
            </span>
            {m.ring !== undefined && <Ring pct={m.ring} color={color} />}
          </Tag>
        );
      })}
    </div>
  );
}
