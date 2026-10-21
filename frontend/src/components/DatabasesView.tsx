import { useMemo, useState } from 'react';
import type { DatabasesResponse, InfraDatabase } from '../types';
import { Panel } from './panels';
import { everyLabel, useSettings } from '../lib/settings';
import MetricStrip from './MetricStrip';
import AttentionList, { type AttentionItem } from './AttentionList';
import { ChartsSection, Donut } from './charts';
import { DbCharts } from './viewCharts';

export type DbScope = { server?: string; db?: string; subscriptionId?: string };

type DbFilter = 'all' | 'ok' | 'critical' | 'watch' | 'nobackup' | 'offline' | 'unchecked' | 'dtu';
type DbSort = 'subscription' | 'server' | 'name' | 'status' | 'backup' | 'used' | 'total' | 'pct' | 'dtu';
type Level = 'critical' | 'watch' | 'ok' | 'na';
const LEVEL_SCOPE: Record<Level, string> = { critical: 'st-err', watch: 'st-warn', ok: 'st-ok', na: 'st-idle' };

const isChecked = (d: InfraDatabase) => d.checkedAt !== null;
const hasNoBackup = (d: InfraDatabase) => isChecked(d) && d.backupChecked && !d.latestBackup;

function levelOf(pct: number | null, warn: number, crit: number): Level {
  if (pct === null) return 'na';
  if (pct > crit) return 'critical';
  if (pct > warn) return 'watch';
  return 'ok';
}

function fmtBackup(d: InfraDatabase): string {
  if (!isChecked(d) || !d.backupChecked) return '—';
  if (!d.latestBackup) return 'No backup found!';
  const t = new Date(d.latestBackup);
  return Number.isNaN(t.getTime())
    ? d.latestBackup
    : t.toLocaleString([], { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const dbId = (d: InfraDatabase) => `${d.subscriptionId}|${d.server}|${d.name}`;

/** Databases tab: SQL database status, latest LTR backup and storage only. Nothing is read until a check is run. */
export default function DatabasesView({
  data,
  loading,
  error,
  checking,
  onCheck,
  autoNext,
}: {
  data: DatabasesResponse | null;
  loading: boolean;
  error: string | null;
  checking: string | null;
  onCheck: (key: string, scope: DbScope) => void;
  /** When the next automatic re-check of everything runs (null until a full check has been done). */
  autoNext: Date | null;
}) {
  const minutes = useSettings().autoMinutes;
  const crit = data?.storageThreshold ?? 75;
  const warn = data?.warnThreshold ?? 60;
  const dtuCrit = data?.dtuThreshold ?? 90;
  const databases = data?.databases ?? [];
  const highDtu = (d: InfraDatabase) => isChecked(d) && d.dtuPct !== null && d.dtuPct > dtuCrit;

  const [filter, setFilter] = useState<DbFilter>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<DbSort>('pct');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');

  const counts = useMemo(() => {
    const checked = databases.filter(isChecked);
    const lv = (l: Level) => checked.filter((d) => levelOf(d.usedPct, warn, crit) === l).length;
    return {
      checked: checked.length,
      ok: checked.filter((d) => d.usedPct !== null && levelOf(d.usedPct, warn, crit) === 'ok').length,
      critical: lv('critical'),
      watch: lv('watch'),
      nobackup: databases.filter(hasNoBackup).length,
      dtu: databases.filter(highDtu).length,
      offline: databases.filter((d) => d.status !== 'Online').length,
      unchecked: databases.length - checked.length,
    };
  }, [databases, warn, crit, dtuCrit]);

  /** Checked databases with something wrong, worst first. */
  const attentionItems: AttentionItem[] = useMemo(() => {
    const scored = databases
      .filter(isChecked)
      .map((d) => {
        const pills: { text: string; scope: string }[] = [];
        let score = 0;
        if (d.status !== 'Online') {
          pills.push({ text: d.status, scope: 'st-err' });
          score += 200;
        }
        if (d.usedPct !== null && d.usedPct > crit) {
          pills.push({ text: `storage ${d.usedPct}%`, scope: 'st-err' });
          score += 100 + d.usedPct;
        } else if (d.usedPct !== null && d.usedPct > warn) {
          pills.push({ text: `storage ${d.usedPct}%`, scope: 'st-warn' });
          score += d.usedPct;
        }
        if (highDtu(d)) {
          pills.push({ text: `DTU ${d.dtuPct}%`, scope: 'st-err' });
          score += 90 + (d.dtuPct ?? 0);
        }
        if (hasNoBackup(d)) {
          pills.push({ text: 'no backup', scope: 'st-warn' });
          score += 20;
        }
        return { d, pills, score };
      })
      .filter((x) => x.pills.length > 0)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, 6).map(({ d, pills }) => ({
      key: dbId(d),
      title: d.name,
      sub: `${d.server} · ${d.subscription}`,
      badge: d.name.slice(0, 2).toUpperCase(),
      pills,
      onClick: () => {
        setFilter('all');
        setSearch(d.server); // a database name like "DSM" is shared by many; the server name is unique
      },
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [databases, warn, crit, dtuCrit]);
  const attentionTotal = useMemo(
    () => databases.filter((d) => isChecked(d) && (d.status !== 'Online' || (d.usedPct ?? 0) > warn || highDtu(d) || hasNoBackup(d))).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [databases, warn, dtuCrit],
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = databases.filter((d) => {
      if (q && !`${d.subscription} ${d.server} ${d.name} ${d.resourceGroup}`.toLowerCase().includes(q)) return false;
      switch (filter) {
        case 'ok':
          return isChecked(d) && d.usedPct !== null && levelOf(d.usedPct, warn, crit) === 'ok';
        case 'critical':
          return isChecked(d) && levelOf(d.usedPct, warn, crit) === 'critical';
        case 'watch':
          return isChecked(d) && levelOf(d.usedPct, warn, crit) === 'watch';
        case 'nobackup':
          return hasNoBackup(d);
        case 'offline':
          return d.status !== 'Online';
        case 'unchecked':
          return !isChecked(d);
        case 'dtu':
          return highDtu(d);
        default:
          return true;
      }
    });
    const val = (d: InfraDatabase): string | number => {
      switch (sort) {
        case 'subscription':
          return d.subscription;
        case 'server':
          return d.server;
        case 'name':
          return d.name;
        case 'status':
          return d.status;
        case 'backup':
          return isChecked(d) && d.backupChecked ? (d.latestBackup ?? '') : '~';
        case 'used':
          return d.usedGB ?? -1;
        case 'total':
          return d.totalGB;
        case 'pct':
          return d.usedPct ?? -1;
        case 'dtu':
          return d.dtuPct ?? -1;
      }
    };
    return [...filtered].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      const c = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return dir === 'asc' ? c : -c;
    });
  }, [databases, filter, search, sort, dir, warn, crit, dtuCrit]);

  const toggleSort = (k: DbSort) => {
    if (k === sort) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(k);
      setDir(k === 'pct' || k === 'used' || k === 'total' || k === 'dtu' ? 'desc' : 'asc');
    }
  };
  const arrow = (k: DbSort) => (k === sort ? (dir === 'asc' ? ' ↑' : ' ↓') : '');
  const pick = (f: DbFilter) => setFilter((cur) => (cur === f ? 'all' : f));

  if (error && !data) {
    return (
      <div className="banner banner-err">
        <strong>Error:</strong> {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="skeleton-page" role="status" aria-label="Listing databases">
        <div className="skeleton" style={{ height: 96 }} />
        <div className="skeleton" style={{ height: 44 }} />
        <div className="skeleton" style={{ height: 260 }} />
      </div>
    );
  }

  const headers: { key: DbSort; label: string }[] = [
    { key: 'subscription', label: 'Subscription' },
    { key: 'server', label: 'SQL server' },
    { key: 'name', label: 'Database' },
    { key: 'status', label: 'Status' },
    { key: 'backup', label: 'Latest LTR backup' },
    { key: 'used', label: 'Used GB' },
    { key: 'total', label: 'Total GB' },
    { key: 'pct', label: 'Usage' },
    { key: 'dtu', label: 'DTU % (now)' },
  ];
  const none = counts.checked === 0;

  return (
    <>
      {error && (
        <div className="banner banner-err">
          <strong>Check failed:</strong> {error}
        </div>
      )}
      {none && (
        <div className="banner banner-warm">
          Nothing has been checked yet. Use <strong>Check all databases</strong> at the top, or the <strong>Check</strong>{' '}
          button on a single row. The list below is the inventory only.{' '}
          {minutes > 0 ? `It also re-checks everything automatically ${everyLabel(minutes, true)} while this page is open.` : 'Automatic re-checks are off (Settings).'}
        </div>
      )}
      {autoNext && (
        <p className="text-xs" style={{ color: 'var(--text-3)' }}>
          ⟳ Auto re-check of all databases (storage, backup, DTU) {everyLabel(minutes)} · next at{' '}
          <span className="mono">{autoNext.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </p>
      )}

      <MetricStrip
        metrics={[
          { key: 'all', label: 'Databases', value: databases.length, sub: `${counts.unchecked} not checked`, tone: 'neutral', active: filter === 'all', onClick: () => setFilter('all') },
          {
            key: 'checked',
            label: 'Checked',
            value: `${counts.checked}/${databases.length}`,
            ring: databases.length ? (counts.checked / databases.length) * 100 : 0,
            sub: none ? 'not checked yet' : counts.unchecked > 0 ? `${counts.unchecked} to go` : 'all checked',
            tone: none ? 'idle' : counts.unchecked > 0 ? 'warn' : 'ok',
            active: filter === 'unchecked',
            onClick: () => pick('unchecked'),
          },
          {
            key: 'critical',
            label: `Above ${crit}% storage`,
            value: none ? '—' : counts.critical,
            sub: none ? 'not checked yet' : counts.critical > 0 ? '▼ needs action' : 'none',
            tone: none ? 'idle' : counts.critical > 0 ? 'err' : 'ok',
            active: filter === 'critical',
            onClick: () => pick('critical'),
          },
          {
            key: 'watch',
            label: `${warn}–${crit}% watch`,
            value: none ? '—' : counts.watch,
            sub: none ? 'not checked yet' : counts.watch > 0 ? 'keep an eye on these' : 'none',
            tone: none ? 'idle' : counts.watch > 0 ? 'warn' : 'ok',
            active: filter === 'watch',
            onClick: () => pick('watch'),
          },
          {
            key: 'dtu',
            label: `DTU above ${dtuCrit}%`,
            value: none ? '—' : counts.dtu,
            sub: none ? 'not checked yet' : counts.dtu > 0 ? '▼ running hot' : 'none',
            tone: none ? 'idle' : counts.dtu > 0 ? 'err' : 'ok',
            active: filter === 'dtu',
            onClick: () => pick('dtu'),
          },
          {
            key: 'nobackup',
            label: 'No LTR backup',
            value: none ? '—' : counts.nobackup,
            sub: none ? 'not checked yet' : counts.nobackup > 0 ? 'check the policy' : 'none',
            tone: none ? 'idle' : counts.nobackup > 0 ? 'warn' : 'ok',
            active: filter === 'nobackup',
            onClick: () => pick('nobackup'),
          },
        ]}
      />

      <ChartsSection label="charts">
        <DbCharts data={data} onPick={(k) => setFilter(k)} />
      </ChartsSection>

      <div className="ov-grid">
        <AttentionList items={attentionItems} total={attentionTotal} empty={none ? 'Run a check to see which databases need attention.' : '✓ Every checked database looks healthy.'} />
        <Panel title="Storage health" right={<span className="panel-legend">{databases.length} databases</span>}>
          <Donut
            center={counts.checked - counts.critical - counts.watch}
            centerLabel={`of ${counts.checked} within limits`}
            empty="No databases checked yet — use Check all databases."
            segments={[
              { label: `OK (≤ ${warn}%)`, value: databases.filter((d) => isChecked(d) && d.usedPct !== null && levelOf(d.usedPct, warn, crit) === 'ok').length, color: 'var(--ok)', onClick: () => setFilter('ok') },
              { label: `Watch (${warn}–${crit}%)`, value: counts.watch, color: 'var(--warn)', onClick: () => setFilter('watch') },
              { label: `Critical (> ${crit}%)`, value: counts.critical, color: 'var(--err)', onClick: () => setFilter('critical') },
              { label: 'N/A or not checked', value: databases.length - counts.critical - counts.watch - databases.filter((d) => isChecked(d) && d.usedPct !== null && levelOf(d.usedPct, warn, crit) === 'ok').length, color: 'var(--idle)', onClick: () => setFilter('unchecked') },
            ]}
          />
        </Panel>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ['ok', `≤ ${warn}% OK`, counts.ok],
            ['critical', `> ${crit}% critical`, counts.critical],
            ['watch', `${warn}–${crit}% watch`, counts.watch],
            ['dtu', `DTU > ${dtuCrit}%`, counts.dtu],
            ['nobackup', 'No backup', counts.nobackup],
            ['offline', 'Not online', counts.offline],
            ['unchecked', 'Not checked', counts.unchecked],
          ] as [DbFilter, string, number][]
        ).map(([key, label, n]) => (
          <button key={key} className={`pill ${filter === key ? 'pill-on' : ''}`} onClick={() => pick(key)}>
            {label} {n}
          </button>
        ))}
        {filter !== 'all' && (
          <button className="pill" onClick={() => setFilter('all')}>
            ✕ Clear filter
          </button>
        )}
        <span className="ml-auto flex items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter databases…"
            className="mono rounded-full px-3 py-1.5 text-xs"
            style={{ background: 'var(--card)', color: 'var(--text-1)', border: '1px solid var(--border-strong)', minWidth: 220 }}
          />
          <span className="text-xs" style={{ color: 'var(--text-3)' }}>
            {loading ? 'Loading…' : `${rows.length} shown`}
          </span>
        </span>
      </div>

      <Panel title="SQL databases · status, backup and storage" bodyClass="panel-bd-flush">
        {rows.length === 0 ? (
          <p className="panel-empty">No databases match this filter.</p>
        ) : (
          <div className="dtable-wrap">
            <table className="dtable">
              <thead>
                <tr>
                  {headers.map((h) => (
                    <th key={h.key} onClick={() => toggleSort(h.key)} className={h.key === sort ? 'th-on' : ''}>
                      {h.label}
                      {arrow(h.key)}
                    </th>
                  ))}
                  <th style={{ cursor: 'default' }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const checked = isChecked(d);
                  const scope = LEVEL_SCOPE[checked ? levelOf(d.usedPct, warn, crit) : 'na'];
                  const key = `db:${dbId(d)}`;
                  return (
                    <tr key={dbId(d)} style={{ cursor: 'default' }} className={scope}>
                      <td>{d.subscription}</td>
                      <td className="mono">{d.server}</td>
                      <td className="mono">{d.name}</td>
                      <td>
                        <span className={`chip ${d.status === 'Online' ? 'st-ok' : 'st-err'}`}>{d.status}</span>
                      </td>
                      <td
                        className="mono"
                        style={{ color: hasNoBackup(d) ? 'var(--err-fg)' : 'var(--text-2)', fontWeight: hasNoBackup(d) ? 700 : 400 }}
                      >
                        {fmtBackup(d)}
                      </td>
                      <td className="mono">{d.usedGB === null ? '—' : `${d.usedGB} GB`}</td>
                      <td className="mono">{d.totalGB} GB</td>
                      <td>
                        {!checked ? (
                          <span className="chip st-idle">not checked</span>
                        ) : d.usedPct === null ? (
                          <span style={{ color: 'var(--text-3)' }}>N/A</span>
                        ) : (
                          <div className="cov-cell">
                            <div className="track" style={{ width: 110 }}>
                              <span style={{ width: `${Math.min(100, d.usedPct)}%` }} />
                            </div>
                            <span className="mono" style={{ color: 'var(--c-fg)', fontSize: 12, fontWeight: 700 }}>
                              {d.usedPct}%
                            </span>
                          </div>
                        )}
                      </td>
                      <td>
                        {!checked ? (
                          <span style={{ color: 'var(--text-3)' }}>—</span>
                        ) : !d.isDtu ? (
                          <span style={{ color: 'var(--text-3)' }} title={`${d.tier || 'vCore'} tier — no DTU metric`}>
                            vCore
                          </span>
                        ) : d.dtuPct === null ? (
                          <span style={{ color: 'var(--text-3)' }}>N/A</span>
                        ) : (
                          <span
                            className={`chip ${d.dtuPct > dtuCrit ? 'st-err' : 'st-ok'}`}
                            title={`Current reading${d.dtuAt ? ` as of ${new Date(d.dtuAt).toLocaleTimeString()}` : ''} (updates on each check)`}
                          >
                            {d.dtuPct}%
                          </span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="pill"
                          style={{ fontSize: 11, padding: '3px 10px', whiteSpace: 'nowrap' }}
                          disabled={checking !== null}
                          title="Check this database only"
                          onClick={() => onCheck(key, { server: d.server, db: d.name, subscriptionId: d.subscriptionId })}
                        >
                          {checking === key ? '⟳ checking…' : checked ? '⟳ Re-check' : 'Check'}
                        </button>
                      </td>
                    </tr>
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
