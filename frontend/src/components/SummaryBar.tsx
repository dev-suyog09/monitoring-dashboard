import type { CheckResult } from '../types';

function Ring({ pct }: { pct: number }) {
  return (
    <div
      className="grid place-items-center rounded-full"
      style={{
        width: 132,
        height: 132,
        background: `conic-gradient(var(--accent) ${pct * 3.6}deg, rgba(255,255,255,0.12) 0deg)`,
      }}
    >
      <div
        className="grid place-items-center rounded-full text-center"
        style={{ width: 104, height: 104, background: 'var(--feature)' }}
      >
        <div>
          <div className="text-2xl font-extrabold" style={{ color: 'var(--on-feature)' }}>
            {pct}%
          </div>
          <div className="text-[10px] uppercase tracking-wider" style={{ color: 'rgba(245,242,233,0.5)' }}>
            archived
          </div>
        </div>
      </div>
    </div>
  );
}

function Legend({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      <span className="text-sm font-semibold" style={{ color: 'var(--on-feature)' }}>
        {value}
      </span>
      <span className="text-xs" style={{ color: 'rgba(245,242,233,0.55)' }}>
        {label}
      </span>
    </div>
  );
}

export default function SummaryBar({ results }: { results: CheckResult[] }) {
  const healthy = results.filter((r) => r.status === 'healthy').length;
  const missing = results.filter((r) => r.status === 'missing_today').length;
  const errored = results.filter((r) => r.status === 'error').length;
  const noSrd = results.filter((r) => r.status === 'no_data').length;

  // Coverage % is measured only over locations that actually have SRD.
  const monitorable = results.length - noSrd;
  const pct = monitorable > 0 ? Math.round((healthy / monitorable) * 100) : 0;

  // PRD at risk excludes "no SRD" locations — only real problems count.
  const prdAtRisk = results.filter(
    (r) => /prd|prod/i.test(r.accountName) && (r.status === 'missing_today' || r.status === 'error'),
  ).length;

  return (
    <div className="feature fade-up flex flex-wrap items-center gap-6 p-6" style={{ boxShadow: 'var(--shadow)' }}>
      <Ring pct={pct} />

      <div className="flex-1" style={{ minWidth: 200 }}>
        <div className="text-xs uppercase tracking-wider" style={{ color: 'rgba(245,242,233,0.55)' }}>
          Archived today
        </div>
        <div className="mt-1 flex items-end gap-2">
          <span className="text-4xl font-extrabold" style={{ color: 'var(--on-feature)' }}>
            {healthy}
          </span>
          <span className="mb-1 text-lg" style={{ color: 'rgba(245,242,233,0.5)' }}>
            / {monitorable} with SRD
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
          <Legend label="Healthy" value={healthy} color="var(--ok)" />
          <Legend label="Missing" value={missing} color="var(--warn)" />
          <Legend label="Errors" value={errored} color="var(--err)" />
          <Legend label="No SRD" value={noSrd} color="var(--idle)" />
        </div>
      </div>

      {/* PRD-at-risk callout */}
      <div
        className="rounded-2xl px-5 py-4 text-center"
        style={{ background: prdAtRisk > 0 ? 'var(--err)' : 'var(--accent)', color: '#1c1b19', minWidth: 130 }}
      >
        <div className="text-3xl font-extrabold">{prdAtRisk > 0 ? prdAtRisk : '✓'}</div>
        <div className="text-[11px] font-semibold uppercase tracking-wide opacity-80">PRD at risk</div>
      </div>
    </div>
  );
}
