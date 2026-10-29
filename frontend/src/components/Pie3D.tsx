import type { Segment } from './charts';

/** Keeps a label short. */
const fit = (t: string, max = 17): string => (t.length > max ? `${t.slice(0, max - 1)}…` : t);

/**
 * A solid 3D pie, like a chart on a presentation slide: every slice is a thick wedge that sits slightly apart from the
 * others on a round platform, hovering pulls one further out, and each slice has a callout with its share, name and count.
 */
interface PieArc extends Segment {
  i: number;
}
export default function Pie3D({
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

