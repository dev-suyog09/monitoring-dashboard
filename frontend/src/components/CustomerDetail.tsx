import { useState } from 'react';
import type { CheckResult } from '../types';
import type { CustomerRow } from '../lib/customers';
import { dbIssues } from '../lib/customers';
import { instanceLevel, LEVEL_SCOPE } from '../lib/instanceState';
import { StatusBadge, CopyIpChip } from './Badges';
import LatestFiles from './LatestFiles';
import BotStoragePanel from './BotStoragePanel';

const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'not checked';

function DateChip({ date, today }: { date: string; today: string }) {
  const isToday = date === today;
  return <span className={`cd-date mono ${isToday ? 'cd-date-today' : ''}`}>{isToday ? `${date} ✓` : date}</span>;
}

function AccountBlock({ account, today, egressIp }: { account: CheckResult; today: string; egressIp?: string | null }) {
  const [filesOpen, setFilesOpen] = useState<Set<string>>(new Set());
  const toggle = (name: string) =>
    setFilesOpen((cur) => {
      const n = new Set(cur);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });
  return (
    <div className="cd-acct">
      <div className="cd-acct-hd">
        <span className="mono cd-acct-name">{account.accountName}</span>
        <StatusBadge status={account.status} />
        {account.status !== 'error' && account.status !== 'no_data' && (
          <span className="mono cd-dim">
            {account.capturesWithToday}/{account.capturesTotal} folders have {today}
          </span>
        )}
      </div>
      {account.status === 'error' ? (
        <div className="cd-err">
          {account.error}
          {/allowlisted/i.test(account.error ?? '') && egressIp && (
            <span style={{ marginLeft: 10 }}>
              <CopyIpChip ip={egressIp} />
            </span>
          )}
        </div>
      ) : account.status === 'no_data' ? (
        <div className="cd-dim">No archive container on this account.</div>
      ) : (
        <div className="cd-folders">
          {account.captureFolders.map((cf) => {
            const date = cf.todayExists ? today : cf.latestDate;
            const open = filesOpen.has(cf.name);
            return (
              <div key={cf.name} className="cd-folder">
                <div className="cd-folder-hd">
                  <span className="mono cd-folder-name">{cf.name}</span>
                  <span className={`chip ${cf.todayExists ? 'st-ok' : 'st-warn'}`}>{cf.todayExists ? 'today ✓' : 'no today'}</span>
                  {date && (
                    <button type="button" className="cd-link" onClick={() => toggle(cf.name)}>
                      {open ? 'hide latest files' : 'latest files'}
                    </button>
                  )}
                </div>
                <div className="cd-dates">
                  {cf.recentDates.length === 0 ? (
                    <span className="cd-dim">no date folders</span>
                  ) : (
                    cf.recentDates.map((d) => <DateChip key={d} date={d} today={today} />)
                  )}
                </div>
                {open && date && <LatestFiles account={account.accountName} capture={cf.name} date={date} />}
              </div>
            );
          })}
        </div>
      )}
      {account.bot && <BotStoragePanel bot={account.bot} />}
    </div>
  );
}

/**
 * Everything about one customer (subscription), inline under its row: archive folders for today, bot instances and
 * databases, with a button that re-checks bots + databases for just this customer.
 */
export default function CustomerDetail({
  row,
  today,
  egressIp,
  thresholds,
  botsBusy,
  dbsBusy,
  anyBusy,
  archiveBusy,
  onRecheck,
  onRefreshArchive,
}: {
  row: CustomerRow;
  today: string;
  egressIp?: string | null;
  thresholds: { storage: number; dtu: number };
  botsBusy: boolean;
  dbsBusy: boolean;
  anyBusy: boolean;
  archiveBusy: boolean;
  onRecheck: () => void;
  onRefreshArchive: () => void;
}) {
  const busy = botsBusy || dbsBusy;
  const instancesBySvc = new Map<string, typeof row.botInstances>();
  for (const i of row.botInstances) {
    const k = i.cloudService.toLowerCase();
    instancesBySvc.set(k, [...(instancesBySvc.get(k) ?? []), i]);
  }

  return (
    <div className="cd">
      <div className="cd-bar">
        <div className="cd-bar-text">
          <strong>{row.name}</strong>
          <span className="cd-dim">
            bots checked {fmtTime(row.bots.checkedAt)} · databases checked {fmtTime(row.dbs.checkedAt)}
          </span>
        </div>
        <div className="cd-bar-actions">
          <button className="btn-accent" disabled={anyBusy || (row.bots.services === 0 && row.dbs.total === 0)} onClick={onRecheck} title="Live-check the bots and databases of this customer only">
            {busy ? '⟳ Checking…' : '↻ Recheck bots + databases'}
          </button>
          <button className="pill" disabled={archiveBusy} onClick={onRefreshArchive} title="Archive status comes from the global scan: this re-scans every account">
            {archiveBusy ? '⟳ Scanning…' : '↻ Rescan archive'}
          </button>
        </div>
      </div>

      <div className="cd-grid">
        {/* ── Archive ── */}
        <section className="cd-card cd-wide">
          <h4>
            SRD archive · today <span className="mono">{today}</span>
          </h4>
          {row.accounts.length === 0 ? (
            <p className="cd-dim">No SRD storage account in this subscription.</p>
          ) : (
            row.accounts.map((a) => <AccountBlock key={a.accountName} account={a} today={today} egressIp={egressIp} />)
          )}
        </section>

        {/* ── Bots ── */}
        <section className="cd-card">
          <h4>
            Bots <span className="cd-dim">{row.bots.started}/{row.bots.instances} up{row.bots.down > 0 ? ` · ${row.bots.down} down` : ''}</span>
          </h4>
          {row.botServices.length === 0 ? (
            <p className="cd-dim">No bot cloud services.</p>
          ) : (
            row.botServices.map((c) => {
              const inst = instancesBySvc.get(c.name.toLowerCase()) ?? [];
              return (
                <div key={c.name} className="cd-row">
                  <div className="cd-row-hd">
                    <span className="mono cd-row-name">{c.name}</span>
                    <span className="mono cd-dim">{c.checkedAt ? `${c.running}/${c.total} running` : 'not checked'}</span>
                  </div>
                  {c.error && <div className="cd-err">{c.error}</div>}
                  <div className="cd-chips">
                    {inst.length === 0 ? (
                      <span className="cd-dim">no instances listed</span>
                    ) : (
                      inst.map((i) => (
                        <span key={i.instance} className={`chip ${LEVEL_SCOPE[instanceLevel(i.status)]}`} title={`${i.instance}: ${i.status}`}>
                          <span className="dot" />
                          {i.instance} · {i.status}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              );
            })
          )}
        </section>

        {/* ── Databases ── */}
        <section className="cd-card">
          <h4>
            Databases (DSM) <span className="cd-dim">{row.dbs.checked}/{row.dbs.total} checked{row.dbs.issues > 0 ? ` · ${row.dbs.issues} issue${row.dbs.issues === 1 ? '' : 's'}` : ''}</span>
          </h4>
          {row.databases.length === 0 ? (
            <p className="cd-dim">No SQL databases.</p>
          ) : (
            row.databases.map((d) => {
              const issues = d.checkedAt ? dbIssues(d, thresholds.storage, thresholds.dtu) : [];
              const scope = !d.checkedAt ? 'st-idle' : issues.length ? 'st-err' : 'st-ok';
              return (
                <div key={`${d.server}/${d.name}`} className="cd-row">
                  <div className="cd-row-hd">
                    <span className="mono cd-row-name">
                      {d.server}/{d.name}
                    </span>
                    <span className={`chip ${scope}`}>
                      <span className="dot" />
                      {!d.checkedAt ? 'not checked' : issues.length ? `${issues.length} issue${issues.length === 1 ? '' : 's'}` : 'ok'}
                    </span>
                  </div>
                  <div className="cd-stats mono">
                    <span>status {d.status}</span>
                    {d.usedPct !== null && (
                      <span>
                        storage {d.usedPct}%{d.usedGB !== null ? ` (${d.usedGB}/${d.totalGB} GB)` : ''}
                      </span>
                    )}
                    {d.isDtu && d.dtuPct !== null && <span>DTU {d.dtuPct}%</span>}
                    {d.backupChecked && <span>{d.latestBackup ? `backup ${new Date(d.latestBackup).toLocaleDateString()}` : 'no LTR backup'}</span>}
                    {d.tier && <span>{d.tier}</span>}
                  </div>
                  {issues.map((t) => (
                    <div key={t} className="cd-err">
                      {t}
                    </div>
                  ))}
                </div>
              );
            })
          )}
        </section>
      </div>
    </div>
  );
}
