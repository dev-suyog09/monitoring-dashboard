import { useMemo, useState } from 'react';
import type { CustomerRow } from '../lib/customers';
import { EnvBadge } from './Badges';
import { Panel } from './panels';
import MetricStrip from './MetricStrip';
export type CustPick =
  | 'arch-ok' | 'arch-warn' | 'arch-err' | 'arch-none'
  | 'bot-ok' | 'bot-warn' | 'bot-down' | 'bot-unchecked'
  | 'db-ok' | 'db-issue' | 'db-unchecked'
  | 'health-ok' | 'health-warn' | 'health-err' | 'health-idle';

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
  renderDetail,
  archiveWarming = false,
}: {
  rows: CustomerRow[];
  /** The backend is still running its first archive scan (it restarts every 15 min): no archive numbers exist yet. */
  archiveWarming?: boolean;
  loading: boolean;
  botsChecking: string | null;
  dbsChecking: string | null;
  onCheckBots: (subscriptionId: string) => void;
  onCheckDbs: (subscriptionId: string) => void;
  /** The details shown right under a customer's row (for one of its SRD accounts, or none). */
  renderDetail: (row: CustomerRow, accountName: string | null, switchTo: (accountName: string) => void) => React.ReactNode;
}) {
  const [sort, setSort] = useState<SortKey>('archive');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [pick, setPick] = useState<CustPick | null>(null);
  /** Customers whose details are open; the value is the SRD account being shown ('' when it has none). */
  const [details, setDetails] = useState<Map<string, string>>(new Map());
  /** Click a customer: its full details open (or close) directly below the row. */
  const toggleDetail = (r: CustomerRow) =>
    setDetails((cur) => {
      const n = new Map(cur);
      if (n.has(r.key)) n.delete(r.key);
      else n.set(r.key, r.accounts[0]?.accountName ?? '');
      return n;
    });

  const PICKS: Record<CustPick, { text: string; test: (r: CustomerRow) => boolean }> = {
    'arch-ok': { text: 'customers with all archives present today', test: (r) => r.archive.monitorable > 0 && r.archive.healthy === r.archive.monitorable },
    'arch-warn': { text: 'customers with archives missing today', test: (r) => r.archive.monitorable > 0 && r.archive.healthy < r.archive.monitorable && r.archive.errors === 0 },
    'arch-err': { text: 'customers with archive errors', test: (r) => r.archive.monitorable > 0 && r.archive.healthy < r.archive.monitorable && r.archive.errors > 0 },
    'arch-none': { text: 'customers without an SRD account', test: (r) => r.accounts.length === 0 || r.archive.monitorable === 0 },
    'bot-ok': { text: 'customers with started bot instances', test: (r) => r.bots.started > 0 },
    'bot-warn': { text: 'customers with starting / other bot instances', test: (r) => r.bots.starting > 0 },
    'bot-down': { text: 'customers with stopped / unresponsive bot instances', test: (r) => r.bots.down > 0 },
    'bot-unchecked': { text: 'customers whose bots are not checked yet', test: (r) => r.bots.services > 0 && r.bots.checked === 0 },
    'db-ok': { text: 'customers with healthy databases', test: (r) => r.dbs.checked - r.dbs.issues > 0 },
    'db-issue': { text: 'customers with database issues', test: (r) => r.dbs.issues > 0 },
    'db-unchecked': { text: 'customers with databases not checked yet', test: (r) => r.dbs.total - r.dbs.checked > 0 },
    'health-ok': { text: 'fully healthy customers', test: (r) => healthClass(r) === 'ok' },
    'health-warn': { text: 'customers that need a look', test: (r) => healthClass(r) === 'warn' },
    'health-err': { text: 'critical customers (instances down, database issues or archive errors)', test: (r) => healthClass(r) === 'err' },
    'health-idle': { text: 'customers that are not checked', test: (r) => healthClass(r) === 'idle' },
  };

  const kpi = useMemo(() => {
    let archiveOk = 0;
    let partialCustomers = 0;
    let botsDown = 0;
    let botsChecked = 0;
    let dbIssues = 0;
    let dbChecked = 0;
    for (const r of rows) {
      if (r.archive.monitorable > 0 && r.archive.healthy === r.archive.monitorable) {
        archiveOk++;
        if (r.archive.partialFolders > 0) partialCustomers++;
      }
      botsDown += r.bots.down;
      botsChecked += r.bots.checked;
      dbIssues += r.dbs.issues;
      dbChecked += r.dbs.checked;
    }
    let withSrd = 0;
    let up = 0;
    let instances = 0;
    for (const r of rows) {
      if (r.archive.monitorable > 0) withSrd++;
      up += r.bots.started;
      instances += r.bots.instances;
    }
    return { archiveOk, partialCustomers, botsDown, botsChecked, dbIssues, dbChecked, withSrd, up, instances };
  }, [rows]);

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
    return (pick ? rows.filter(PICKS[pick].test) : rows).sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      const c = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return (dir === 'asc' ? c : -c) || a.name.localeCompare(b.name);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort, dir, pick]);

  const toggleSort = (k: SortKey) => {
    if (k === sort) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(k);
      setDir('asc');
    }
  };
  const arrow = (k: SortKey) => (k === sort ? (dir === 'asc' ? ' ↑' : ' ↓') : '');
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

    {archiveWarming && (
      <div className="banner banner-warm">
        ⏳ The archive scan is warming up (the backend restarts every 15 minutes and re-scans all locations). Archive numbers on
        this tab appear when it finishes, usually within 1–4 minutes — nothing here is "missing" yet.
      </div>
    )}
    <MetricStrip
      metrics={[
        { key: 'all', label: 'Customers', value: rows.length, sub: archiveWarming ? 'archive scan warming up' : `${kpi.withSrd} with an SRD account`, tone: 'neutral', active: pick === null, onClick: () => setPick(null) },
        {
          key: 'arch',
          label: 'Archive complete',
          value: archiveWarming ? '…' : kpi.archiveOk,
          ring: kpi.withSrd ? (kpi.archiveOk / kpi.withSrd) * 100 : 0,
          sub: archiveWarming
            ? 'scanning archive…'
            : kpi.withSrd === 0
              ? 'no archive data'
              : kpi.withSrd - kpi.archiveOk > 0 ? `${kpi.withSrd - kpi.archiveOk} still missing today` : kpi.partialCustomers > 0 ? `${kpi.partialCustomers} with folders empty` : 'all archived',
          tone: archiveWarming || kpi.withSrd === 0 ? 'idle' : kpi.archiveOk === kpi.withSrd ? 'ok' : 'warn',
          active: pick === 'arch-ok',
          onClick: () => setPick((c) => (c === 'arch-ok' ? null : 'arch-ok')),
        },
        {
          key: 'inst',
          label: 'Instances up',
          value: kpi.botsChecked === 0 ? '—' : `${kpi.up}/${kpi.instances}`,
          ring: kpi.instances ? (kpi.up / kpi.instances) * 100 : 0,
          sub: kpi.botsChecked === 0 ? 'not checked yet' : kpi.botsDown > 0 ? `▼ ${kpi.botsDown} down` : '▲ all up',
          tone: kpi.botsChecked === 0 ? 'idle' : kpi.botsDown > 0 ? 'err' : 'ok',
          active: pick === 'bot-down',
          onClick: () => setPick((c) => (c === 'bot-down' ? null : 'bot-down')),
        },
        {
          key: 'db',
          label: 'Databases healthy',
          value: kpi.dbChecked === 0 ? '—' : `${kpi.dbChecked - kpi.dbIssues}/${kpi.dbChecked}`,
          ring: kpi.dbChecked ? ((kpi.dbChecked - kpi.dbIssues) / kpi.dbChecked) * 100 : 0,
          sub: kpi.dbChecked === 0 ? 'not checked yet' : kpi.dbIssues > 0 ? `▼ ${kpi.dbIssues} with issues` : '▲ all healthy',
          tone: kpi.dbChecked === 0 ? 'idle' : kpi.dbIssues > 0 ? 'err' : 'ok',
          active: pick === 'db-issue',
          onClick: () => setPick((c) => (c === 'db-issue' ? null : 'db-issue')),
        },
      ]}
    />

    <div className="cust-layout cust-solo">
      <div className="cust-main">
      {pick && (
        <div className="banner banner-warm flex items-center justify-between gap-3">
          <span>
            Showing only <strong>{PICKS[pick].text}</strong> · {sorted.length}
          </span>
          <button className="pill" onClick={() => setPick(null)}>
            ✕ Show everything
          </button>
        </div>
      )}
      <Panel
        title={`Customers · ${rows.length} subscription${rows.length === 1 ? '' : 's'}`}
        right={<span className="panel-legend">{loading ? 'listing bots and databases…' : 'click a customer for its details'}</span>}
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
                  const isOpen = details.has(r.key);
                  const a = r.archive;
                  const archiveChip = archiveWarming
                    ? { text: 'scanning…', scope: 'st-idle' }
                    : r.accounts.length === 0
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
                      <tr id={`cust-${r.key}`} className={isOpen ? 'cust-row-open' : ''} onClick={() => toggleDetail(r)} aria-expanded={isOpen} style={{ cursor: 'pointer' }} title="Click to show its details">
                        <td>
                          <div className="cust-cell">
                            <span className="cust-caret">{isOpen ? '▾' : '▸'}</span>
                            <span className="cust-av">{shortName(r.name).slice(0, 2).toUpperCase()}</span>
                            <span className="cust-txt">
                              <b className="cust-short" title={r.name}>
                                {r.name}
                              </b>
                              <span className="cust-full">
                                {r.accounts.length} SRD account{r.accounts.length === 1 ? '' : 's'}
                              </span>
                            </span>
                          </div>
                        </td>
                        <td>{r.env === 'OTHER' ? <span style={{ color: 'var(--text-3)' }}>—</span> : <EnvBadge env={r.env} />}</td>
                        <td>
                          {archiveChip ? (
                            <span className="prog-cell">
                              <span className={`chip ${archiveChip.scope}`}>
                                <span className="dot" />
                                {archiveChip.text}
                              </span>
                              {a.partialFolders > 0 && (
                                <span
                                  className="chip st-warn chip-mini"
                                  title={`These accounts are Healthy (at least one capture folder has today's data), but ${a.partialFolders} capture folder${a.partialFolders === 1 ? ' has' : 's have'} nothing for today yet (${a.foldersToday}/${a.folders} folders have today).`}
                                >
                                  ⚠ {a.partialFolders} folder{a.partialFolders === 1 ? '' : 's'} empty
                                </span>
                              )}
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
                      {isOpen && (
                        <tr className="cd-inline-row">
                          <td colSpan={6}>
                            <div className="cd-inline">
                              {renderDetail(r, details.get(r.key) || null, (acct) => setDetails((cur) => new Map(cur).set(r.key, acct)))}
                            </div>
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
      </div>
    </div>
    </>
  );
}

/** One health class per customer: critical (err), needs a look (warn), not checked (idle) or fully healthy (ok). */
function healthClass(r: CustomerRow): 'ok' | 'warn' | 'err' | 'idle' {
  const checked = r.bots.checked > 0 || r.dbs.checked > 0;
  if (r.bots.down > 0 || r.dbs.issues > 0 || r.archive.errors > 0) return 'err';
  if ((r.archive.monitorable > 0 && r.archive.healthy < r.archive.monitorable) || r.bots.starting > 0) return 'warn';
  if (!checked && r.archive.monitorable === 0) return 'idle';
  return 'ok';
}

/** "AZU-NVM-FMC-NCC-PRD-ATD" -> "ATD": the customer part of the subscription name. */
function shortName(name: string): string {
  const t = name.replace(/^AZU-NVM-FMC-NCC-/, '');
  return /^(?:PRD|PROD|UAT|DEV|TST|TEST)-(.+)$/i.exec(t)?.[1] ?? t;
}

/** A keyed fragment (a row plus its expanded sub-rows). */
function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
