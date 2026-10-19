import { useMemo, useState } from 'react';
import type { CheckResult } from '../types';
import { detectEnv, STATUS_META } from '../lib/ui';
import { BotChip } from './Badges';

type SortKey = 'accountName' | 'env' | 'status' | 'coverage' | 'latest';
type Dir = 'asc' | 'desc';

const STATUS_RANK: Record<string, number> = { error: 0, missing_today: 1, no_data: 2, healthy: 3 };

function coveragePct(r: CheckResult): number {
  return r.capturesTotal > 0 ? Math.round((r.capturesWithToday / r.capturesTotal) * 100) : 0;
}

export default function AccountTable({
  results,
  onSelect,
}: {
  results: CheckResult[];
  onSelect: (r: CheckResult) => void;
}) {
  const [sort, setSort] = useState<SortKey>('status');
  const [dir, setDir] = useState<Dir>('asc');

  const toggle = (k: SortKey) => {
    if (k === sort) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(k);
      setDir('asc');
    }
  };

  const rows = useMemo(() => {
    const val = (r: CheckResult): string | number => {
      switch (sort) {
        case 'accountName':
          return r.accountName;
        case 'env':
          return detectEnv(r.accountName);
        case 'status':
          return STATUS_RANK[r.status] ?? 9;
        case 'coverage':
          return coveragePct(r);
        case 'latest':
          return r.captureFolders.reduce<string>((m, c) => (c.latestDate && c.latestDate > m ? c.latestDate : m), '');
      }
    };
    const sorted = [...results].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return dir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [results, sort, dir]);

  const arrow = (k: SortKey) => (k === sort ? (dir === 'asc' ? ' ↑' : ' ↓') : '');
  const headers: { key: SortKey; label: string }[] = [
    { key: 'accountName', label: 'Account' },
    { key: 'env', label: 'Env' },
    { key: 'status', label: 'Status' },
    { key: 'coverage', label: 'Coverage today' },
    { key: 'latest', label: 'Latest date' },
  ];

  return (
    <div className="dtable-wrap">
      <table className="dtable">
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h.key} onClick={() => toggle(h.key)} className={h.key === sort ? 'th-on' : ''}>
                {h.label}
                {arrow(h.key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const env = detectEnv(r.accountName);
            const m = STATUS_META[r.status];
            const cov = coveragePct(r);
            const latest = r.captureFolders.reduce<string>(
              (mx, c) => (c.latestDate && c.latestDate > mx ? c.latestDate : mx),
              '',
            );
            return (
              <tr key={r.accountName} className={m.scope} onClick={() => onSelect(r)}>
                <td className="mono td-name">{r.accountName}</td>
                <td>
                  <span className={`chip en-${env}`}>{env}</span>
                </td>
                <td>
                  <span className={`chip ${m.scope}`}>
                    <span className={`dot ${r.status === 'healthy' ? 'pulse' : ''}`} />
                    {m.label}
                  </span>
                  {r.bot && (
                    <span style={{ marginLeft: 6 }}>
                      <BotChip bot={r.bot} />
                    </span>
                  )}
                </td>
                <td>
                  {r.status === 'error' ? (
                    <span className="td-err" title={r.error ?? ''}>
                      {r.error ?? 'Error'}
                    </span>
                  ) : r.status === 'no_data' ? (
                    <span style={{ color: 'var(--text-3)' }}>—</span>
                  ) : (
                    <div className="cov-cell">
                      <div className="track" style={{ width: 90 }}>
                        <span style={{ width: `${cov}%` }} />
                      </div>
                      <span className="mono" style={{ color: 'var(--text-2)', fontSize: 12 }}>
                        {r.capturesWithToday}/{r.capturesTotal}
                      </span>
                    </div>
                  )}
                </td>
                <td className="mono" style={{ color: latest ? 'var(--text-2)' : 'var(--text-3)' }}>
                  {latest || '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
