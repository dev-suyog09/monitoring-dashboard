import { useMemo, useState } from 'react';
import type { CheckResult } from '../types';
import type { CustomerRow } from '../lib/customers';
import { EnvBadge, StatusBadge } from './Badges';
import { Panel } from './panels';
import { ChartsSection } from './charts';
import { CustomerCharts } from './viewCharts';

type SortKey = 'name' | 'env' | 'archive' | 'bots' | 'dbs';

const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '–';

/** Lower = needs attention first. */
function archiveRank(r: CustomerRow): number {
  if (r.accounts.length === 0 || r.archive.monitorable === 0) return 2;
  return r.archive.healthy / r.archive.monitorable;
}
function botsRank(r: CustomerRow): number {
  if (r.bots.services === 0) return 4;
  if (r.bots.checked === 0) return 3;
  return r.bots.down > 0 ? 0 : r.bots.instances ? r.bots.started / r.bots.instances : 1;
}
function dbsRank(r: CustomerRow): number {
  if (r.dbs.total === 0) return 4;
  if (r.dbs.checked === 0) return 3;
  return r.dbs.issues > 0 ? 0 : 1;
}

/** A check button, or the result chip (click it to re-check). */
function CheckCell({
  total,
  emptyLabel,
  checked,
  chip,
  busy,
  disabled,
  onCheck,
  title,
}: {
  total: number;
  emptyLabel: string;
  checked: boolean;
  chip: { text: string; scope: string };
  busy: boolean;
  disabled: boolean;
  onCheck: () => void;
  title: string;
}) {
  if (total === 0) {
    return (
      <span className="chip st-idle">
        <span className="dot" />
        {emptyLabel}
      </span>
    );
  }
  const stop = (e: React.MouseEvent) => {
    e.stopPropagation();
    onCheck();
  };
  if (busy) return <span className="chip st-idle">⟳ checking…</span>;
  if (!checked) {
    return (
      <button type="button" className="pill" style={{ fontSize: 11, padding: '3px 10px' }} disabled={disabled} onClick={stop} title={title}>
        ▸ check
      </button>
    );
  }
  return (
    <button
      type="button"
      className={`chip ${chip.scope}`}
      style={{ cursor: disabled ? 'default' : 'pointer', border: 'none' }}
      disabled={disabled}
      onClick={stop}
      title={`${title} — click to re-check`}
    >
      <span className="dot" />
      {chip.text}
    </button>
  );
}

/**
 * Customers tab: one row per subscription (customer) with archive status, bots and databases (DSM) side by side,
 * a per-customer check for bots / databases, and the SRD accounts one click away.
 */
export default function CustomersView({
  rows,
  loading,
  botsChecking,
  dbsChecking,
  onCheckBots,
  onCheckDbs,
  onSelectAccount,
}: {
  rows: CustomerRow[];
  loading: boolean;
  botsChecking: string | null;
  dbsChecking: string | null;
  onCheckBots: (subscriptionId: string) => void;
  onCheckDbs: (subscriptionId: string) => void;
  onSelectAccount: (a: CheckResult) => void;
}) {
  const [sort, setSort] = useState<SortKey>('archive');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [open, setOpen] = useState<Set<string>>(new Set());

  const sorted = useMemo(() => {
    const val = (r: CustomerRow): string | number => {
      switch (sort) {
        case 'name':
          return r.name;
        case 'env':
          return r.env;
        case 'archive':
          return archiveRank(r);
        case 'bots':
          return botsRank(r);
        case 'dbs':
          return dbsRank(r);
      }
    };
    return [...rows].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      const c = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return (dir === 'asc' ? c : -c) || a.name.localeCompare(b.name);
    });
  }, [rows, sort, dir]);

  const toggleSort = (k: SortKey) => {
    if (k === sort) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(k);
      setDir('asc');
    }
  };
  const arrow = (k: SortKey) => (k === sort ? (dir === 'asc' ? ' ↑' : ' ↓') : '');
  const toggleOpen = (key: string) =>
    setOpen((cur) => {
      const n = new Set(cur);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const headers: { key: SortKey | null; label: string }[] = [
    { key: 'name', label: 'customer' },
    { key: 'env', label: 'env' },
    { key: 'archive', label: 'archive today' },
    { key: 'bots', label: 'bots' },
    { key: 'dbs', label: 'dsm / db' },
    { key: null, label: 'bot/dsm checked' },
  ];

  return (
    <>
    <ChartsSection label="charts">
      <CustomerCharts rows={rows} />
    </ChartsSection>
    <Panel
      title={`Customers · ${rows.length} subscription${rows.length === 1 ? '' : 's'}`}
      right={<span className="panel-legend">{loading ? 'listing bots and databases…' : 'click a row for its SRD accounts'}</span>}
      bodyClass="panel-bd-flush"
    >
      {rows.length === 0 ? (
        <p className="panel-empty">No customers match this filter.</p>
      ) : (
        <div className="dtable-wrap">
          <table className="dtable">
            <thead>
              <tr>
                {headers.map((h) => (
                  <th
                    key={h.label}
                    onClick={h.key ? () => toggleSort(h.key!) : undefined}
                    className={h.key === sort ? 'th-on' : ''}
                    style={{ textTransform: 'lowercase', cursor: h.key ? 'pointer' : 'default' }}
                  >
                    {h.label}
                    {h.key ? arrow(h.key) : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const isOpen = open.has(r.key);
                const a = r.archive;
                const archiveChip =
                  r.accounts.length === 0
                    ? null
                    : a.monitorable === 0
                      ? { text: 'no SRD', scope: 'st-idle' }
                      : {
                          text: `${a.healthy}/${a.monitorable} today`,
                          scope: a.healthy === a.monitorable ? 'st-ok' : a.errors > 0 ? 'st-err' : 'st-warn',
                        };
                const b = r.bots;
                const botsScope =
                  b.down > 0 ? 'st-err' : b.starting > 0 || b.unreadable > 0 || b.checked < b.services || b.started < b.instances ? 'st-warn' : 'st-ok';
                const d = r.dbs;
                const dbsScope = d.issues > 0 ? 'st-err' : d.checked < d.total ? 'st-warn' : 'st-ok';
                const botsBusy = botsChecking === `sub:${r.subscriptionId}`;
                const dbsBusy = dbsChecking === `sub:${r.subscriptionId}`;
                return (
                  <FragmentRows key={r.key}>
                    <tr onClick={() => toggleOpen(r.key)} style={{ cursor: 'pointer' }}>
                      <td>
                        <span style={{ color: 'var(--text-3)', fontSize: 10, marginRight: 8 }}>{isOpen ? '▾' : '▸'}</span>
                        <span className="mono" style={{ fontWeight: 800, color: 'var(--text-1)' }}>
                          {r.name}
                        </span>{' '}
                        <span style={{ color: 'var(--text-3)', fontSize: 12 }}>
                          {r.accounts.length} acct{r.accounts.length === 1 ? '' : 's'}
                        </span>
                      </td>
                      <td>{r.env === 'OTHER' ? <span style={{ color: 'var(--text-3)' }}>—</span> : <EnvBadge env={r.env} />}</td>
                      <td>
                        {archiveChip ? (
                          <span className={`chip ${archiveChip.scope}`}>
                            <span className="dot" />
                            {archiveChip.text}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-3)' }}>—</span>
                        )}
                      </td>
                      <td>
                        <CheckCell
                          total={b.services}
                          emptyLabel="no bots"
                          checked={b.checked > 0}
                          chip={{ text: `${b.started}/${b.instances} up${b.down > 0 ? ` · ${b.down} down` : ''}`, scope: botsScope }}
                          busy={botsBusy}
                          disabled={botsChecking !== null}
                          onCheck={() => onCheckBots(r.subscriptionId)}
                          title={`${b.services} bot${b.services === 1 ? '' : 's'}`}
                        />
                      </td>
                      <td>
                        <CheckCell
                          total={d.total}
                          emptyLabel="no dbs"
                          checked={d.checked > 0}
                          chip={{
                            text: d.issues > 0 ? `⚠ ${d.issues} issue${d.issues === 1 ? '' : 's'}` : `${d.checked}/${d.total} db ok`,
                            scope: dbsScope,
                          }}
                          busy={dbsBusy}
                          disabled={dbsChecking !== null}
                          onCheck={() => onCheckDbs(r.subscriptionId)}
                          title={d.issueText.length ? d.issueText.join(' · ') : `${d.total} database${d.total === 1 ? '' : 's'}`}
                        />
                      </td>
                      <td className="mono" style={{ color: 'var(--text-3)', fontSize: 12, whiteSpace: 'nowrap' }}>
                        bots {fmtTime(b.checkedAt)} · dsm {fmtTime(d.checkedAt)}
                      </td>

                    </tr>
                    {isOpen &&
                      r.accounts.map((acct) => (
                        <tr key={acct.accountName} style={{ background: 'var(--card-2)', cursor: 'default' }}>
                          <td className="mono" style={{ paddingLeft: 38, color: 'var(--text-2)' }}>
                            {acct.accountName}
                          </td>
                          <td />
                          <td>
                            <StatusBadge status={acct.status} />{' '}
                            {acct.status !== 'error' && acct.status !== 'no_data' && (
                              <span className="mono" style={{ color: 'var(--text-3)', fontSize: 12 }}>
                                · {acct.capturesWithToday}/{acct.capturesTotal}
                              </span>
                            )}
                          </td>
                          <td>
                            <button
                              type="button"
                              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-2)', fontSize: 12 }}
                              onClick={() => onSelectAccount(acct)}
                            >
                              open details →
                            </button>
                          </td>
                          <td />
                          <td />
                        </tr>
                      ))}
                    {isOpen && r.accounts.length === 0 && (
                      <tr style={{ background: 'var(--card-2)', cursor: 'default' }}>
                        <td colSpan={6} style={{ paddingLeft: 38, color: 'var(--text-3)', fontSize: 12 }}>
                          No SRD storage account in this subscription.
                        </td>
                      </tr>
                    )}
                  </FragmentRows>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
    </>
  );
}

/** A keyed fragment (a row plus its expanded sub-rows). */
function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
