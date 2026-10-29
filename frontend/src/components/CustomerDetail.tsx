import { useMemo } from 'react';
import type { BotsResponse, DatabasesResponse, InfraDatabase } from '../types';
import type { CustomerRow } from '../lib/customers';
import { dbIssues } from '../lib/customers';
import { instanceLevel, LEVEL_SCOPE } from '../lib/instanceState';
import { detectEnv } from '../lib/ui';
import { EnvBadge, StatusBadge } from './Badges';
import '../detail.css';
import BotStoragePanel from './BotStoragePanel';
import CallsSection from './CallsSection';
import LatestFiles from './LatestFiles';
import SidePanel from './SidePanel';

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : null);
const shortInstance = (n: string) => n.split('.').pop() ?? n;
/** "AZU-NVM-FMC-NCC-PRD-ATD" -> "ATD". */
const shortName = (name: string): string => {
  const t = name.replace(/^AZU-NVM-FMC-NCC-/, '');
  return /^(?:PRD|PROD|UAT|DEV|TST|TEST)-(.+)$/i.exec(t)?.[1] ?? t;
};

function Section({ icon, title, right, children }: { icon: string; title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="cd-sec">
      <div className="cd-sec-hd">
        <h4>
          <span className="cd-ico">{icon}</span>
          {title}
        </h4>
        {right}
      </div>
      {children}
    </section>
  );
}

/** One headline number in the summary strip. */
function Kpi({ label, value, sub, scope, icon, pct }: { label: string; value: string; sub: string; scope: string; icon: string; pct?: number | null }) {
  return (
    <div className={`cd-kpi ${scope}`}>
      <span className="cd-kpi-top">
        <span className="cd-kpi-label">{label}</span>
        <span className="cd-kpi-ico" aria-hidden>
          {icon}
        </span>
      </span>
      <span className="cd-kpi-val">{value}</span>
      <span className="cd-kpi-sub">{sub}</span>
      {pct !== undefined && pct !== null && (
        <span className="cd-kpi-bar" aria-hidden>
          <i style={{ width: `${Math.max(3, Math.min(100, pct))}%` }} />
        </span>
      )}
    </div>
  );
}

function CheckButton({ busy, disabled, label, onClick }: { busy: boolean; disabled: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" className="pill" disabled={disabled} onClick={onClick}>
      {busy ? '⏳ checking…' : label}
    </button>
  );
}

function DbCard({ d, issues }: { d: InfraDatabase; issues: string[] }) {
  const checked = d.checkedAt !== null;
  const scope = !checked ? 'st-idle' : issues.length > 0 ? 'st-err' : 'st-ok';
  return (
    <div className="cd-item">
      <div className="cd-item-top">
        <span className="mono cd-name" title={`${d.server}/${d.name}`}>
          {d.server}/{d.name}
        </span>
        <span className={`chip ${scope}`}>
          <span className="dot" />
          {!checked ? 'not checked' : issues.length > 0 ? `${issues.length} issue${issues.length === 1 ? '' : 's'}` : 'ok'}
        </span>
      </div>
      {checked && d.usedPct !== null && (
        <div className="cd-bar" title={`${d.usedPct}% of ${d.totalGB} GB used`}>
          <span style={{ width: `${Math.max(2, Math.min(100, d.usedPct))}%`, background: d.usedPct > 75 ? 'var(--err)' : d.usedPct > 60 ? 'var(--warn)' : 'var(--ok)' }} />
        </div>
      )}
      {checked ? (
        <div className="mono cd-facts">
          <span>status {d.status}</span>
          <span>
            storage {d.usedPct ?? '—'}% ({d.usedGB ?? '—'}/{d.totalGB} GB)
          </span>
          <span>DTU {d.isDtu ? `${d.dtuPct ?? '—'}%` : 'n/a'}</span>
          <span>backup {d.backupChecked ? (fmtDate(d.latestBackup) ?? 'none') : '—'}</span>
          <span>{d.tier}</span>
        </div>
      ) : (
        <div className="mono cd-facts">
          <span>status {d.status}</span>
          <span>{d.totalGB} GB</span>
          <span>{d.tier}</span>
        </div>
      )}
      {issues.length > 0 && (
        <ul className="cd-issues">
          {issues.map((t) => (
            <li key={t}>{t.replace(`${d.server}/${d.name}: `, '')}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Customers tab → "open details": one side panel with everything about a customer's SRD account and the rest of its
 * subscription — archive coverage, bot storage, the bots with every instance, and the databases (DSM).
 */
export default function CustomerDetail({
  row,
  archiveWarming = false,
  accountName,
  onSwitch,
  today,
  bots,
  dbs,
  botsBusy,
  dbsBusy,
  checkDisabled,
  onCheckBots,
  onCheckDbs,
  onOpenCalls,
  onClose,
}: {
  row: CustomerRow;
  archiveWarming?: boolean;
  /** The SRD account to show (the first one when null). */
  accountName: string | null;
  onSwitch: (accountName: string) => void;
  today: string;
  bots: BotsResponse | null;
  dbs: DatabasesResponse | null;
  botsBusy: boolean;
  dbsBusy: boolean;
  checkDisabled: { bots: boolean; dbs: boolean };
  onCheckBots: () => void;
  onCheckDbs: () => void;
  /** Open the Concurrent Calls tab with this customer selected. */
  onOpenCalls?: (subscriptionId: string) => void;
  onClose: () => void;
}) {
  const account = row.accounts.find((a) => a.accountName === accountName) ?? row.accounts[0] ?? null;
  const sub = row.subscriptionId.toLowerCase();
  const env = detectEnv(account?.accountName ?? row.name);
  const cov = account && account.capturesTotal > 0 ? Math.round((account.capturesWithToday / account.capturesTotal) * 100) : 0;
  const accErr = account?.status === 'error';

  const services = useMemo(
    () => (bots?.cloudServices ?? []).filter((s) => s.subscriptionId.toLowerCase() === sub).sort((a, b) => a.name.localeCompare(b.name)),
    [bots, sub],
  );
  const instances = useMemo(() => (bots?.instances ?? []).filter((i) => i.subscriptionId.toLowerCase() === sub), [bots, sub]);
  const databases = useMemo(
    () => (dbs?.databases ?? []).filter((d) => d.subscriptionId.toLowerCase() === sub).sort((a, b) => `${a.server}/${a.name}`.localeCompare(`${b.server}/${b.name}`)),
    [dbs, sub],
  );

  const up = instances.filter((i) => i.status === 'Started').length;
  const down = instances.filter((i) => instanceLevel(i.status) === 'bad').length;
  const botsChecked = services.filter((s) => s.checkedAt).length;
  const dbsChecked = databases.filter((d) => d.checkedAt).length;
  const issueMap = databases.map((d) => dbIssues(d, dbs?.storageThreshold ?? 75, dbs?.dtuThreshold ?? 90));
  const dbIssueCount = issueMap.filter((x, i) => databases[i]!.checkedAt && x.length > 0).length;

  return (
    <SidePanel
      title={`${shortName(row.name)}${row.env !== 'OTHER' ? ` · ${row.env}` : ''}`}
      subtitle={account ? `${account.accountName} · ${row.name}` : row.name}
      onClose={onClose}
      width="clamp(720px, 84vw, 1560px)"
      className="sheet-xl"
      icon={<span className="cd-avatar">{shortName(row.name).replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || '?'}</span>}
    >
      <div className="cd-head">
        {account && <StatusBadge status={account.status} />}
        <EnvBadge env={env} />
        {row.accounts.length > 1 && (
          <span className="cd-accts">
            {row.accounts.map((a) => (
              <button key={a.accountName} type="button" className={`pill ${a.accountName === account?.accountName ? 'pill-on' : ''}`} onClick={() => onSwitch(a.accountName)} title={a.accountName}>
                {a.accountName}
              </button>
            ))}
          </span>
        )}
      </div>

      <div className="cd-kpis">
        <Kpi
          label="Archive folders"
          icon="🗄️"
          pct={account && !accErr && account.capturesTotal > 0 ? cov : null}
          value={!account || accErr ? '—' : `${account.capturesWithToday}/${account.capturesTotal}`}
          sub={!account ? (archiveWarming ? 'archive scan warming up' : 'no SRD account') : accErr ? 'could not read' : account.capturesWithToday === account.capturesTotal ? 'all have today' : `${account.capturesTotal - account.capturesWithToday} empty today`}
          scope={!account ? 'st-idle' : accErr ? 'st-err' : account.capturesWithToday === account.capturesTotal ? 'st-ok' : account.capturesWithToday === 0 ? 'st-err' : 'st-warn'}
        />
        <Kpi
          label="Bot storage"
          icon="🧺"
          value={!account?.bot || account.bot.status === 'none' ? '—' : account.bot.status === 'clean' ? 'Clean' : account.bot.status === 'stuck' ? `${account.bot.stuckCount} stuck` : 'Error'}
          sub={account?.bot ? `last ${account.bot.windowDays} days` : 'no bot storage'}
          scope={!account?.bot || account.bot.status === 'none' ? 'st-idle' : account.bot.status === 'clean' ? 'st-ok' : account.bot.status === 'stuck' ? 'st-err' : 'st-warn'}
        />
        <Kpi
          label="Instances"
          icon="🤖"
          pct={botsChecked > 0 && instances.length > 0 ? (up / instances.length) * 100 : null}
          value={botsChecked > 0 ? `${up}/${instances.length}` : '—'}
          sub={botsChecked > 0 ? (down > 0 ? `${down} down` : 'all up') : 'not checked'}
          scope={botsChecked === 0 ? 'st-idle' : down > 0 ? 'st-err' : up < instances.length ? 'st-warn' : 'st-ok'}
        />
        <Kpi
          label="Databases"
          icon="🛢️"
          pct={dbsChecked > 0 && databases.length > 0 ? ((dbsChecked - dbIssueCount) / databases.length) * 100 : null}
          value={dbsChecked > 0 ? `${dbsChecked - dbIssueCount}/${databases.length}` : '—'}
          sub={dbsChecked > 0 ? (dbIssueCount > 0 ? `${dbIssueCount} with issues` : 'all ok') : 'not checked'}
          scope={dbsChecked === 0 ? 'st-idle' : dbIssueCount > 0 ? 'st-err' : dbsChecked < databases.length ? 'st-warn' : 'st-ok'}
        />
      </div>

      <div className="cd-layout">
        <div className="cd-col">
      {account?.bot && <BotStoragePanel bot={account.bot} />}

      {account && accErr && <div className="cd-err">{account.error}</div>}
      {account && !accErr && (
        <Section
          icon="🗄️"
          title="Archive today"
          right={
            <span className="mono cd-count">
              {account.capturesWithToday}/{account.capturesTotal} folders · {cov}%
            </span>
          }
        >
          <div className="track">
            <span style={{ width: `${cov}%` }} />
          </div>
          {account.status === 'healthy' && account.capturesWithToday < account.capturesTotal && (
            <p className="cd-note">
              The account counts as <b>Healthy</b> because at least one capture folder has today&apos;s data, but{' '}
              <b>{account.capturesTotal - account.capturesWithToday}</b> of {account.capturesTotal} folders have nothing for today yet.
            </p>
          )}
          <div className="cd-folders">
            {account.captureFolders.length === 0 && <p className="panel-empty">No capture folders found.</p>}
            {account.captureFolders.map((cf) => (
              <div key={cf.name} className="cd-item">
                <div className="cd-item-top">
                  <span className="mono cd-name">{cf.name}</span>
                  <span className={`chip ${cf.todayExists ? 'st-ok' : 'st-warn'}`}>{cf.todayExists ? 'today ✓' : 'no today'}</span>
                </div>
                {(cf.todayExists || cf.latestDate) && (
                  <LatestFiles account={account.accountName} capture={cf.name} date={cf.todayExists ? today : cf.latestDate!} />
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

        </div>
        <div className="cd-col">
        <Section
          icon="🤖"
          title="Bots"
          right={
            <span className="cd-right">
              {botsChecked > 0 && (
                <span className={`mono cd-count ${down > 0 ? 'cd-bad' : ''}`}>
                  {up}/{instances.length} up
                </span>
              )}
              <CheckButton busy={botsBusy} disabled={checkDisabled.bots} label={botsChecked > 0 ? '⟳ Re-check' : 'Check'} onClick={onCheckBots} />
            </span>
          }
        >
          {services.length === 0 ? (
            <p className="panel-empty">{bots ? 'No bots in this subscription.' : 'Listing bots…'}</p>
          ) : (
            services.map((s) => {
              const mine = instances.filter((i) => i.cloudService === s.name).sort((a, b) => a.instance.localeCompare(b.instance));
              return (
                <div key={s.name} className="cd-item">
                  <div className="cd-item-top">
                    <span className="mono cd-name" title={s.name}>
                      {s.name}
                    </span>
                    <span className="mono cd-count">{s.checkedAt ? `${s.running}/${s.total} running` : 'not checked'}</span>
                  </div>
                  {s.error && <p className="cd-errline">{s.error}</p>}
                  <div className="cd-chips">
                    {mine.map((i) => (
                      <span key={i.instance} className={`chip ${LEVEL_SCOPE[instanceLevel(i.status)]}`} title={i.instance}>
                        <span className="dot" />
                        {shortInstance(i.instance)} · {i.status}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </Section>

        <Section
          icon="🛢️"
          title="Databases (DSM)"
          right={
            <span className="cd-right">
              {databases.length > 0 && (
                <span className={`mono cd-count ${dbIssueCount > 0 ? 'cd-bad' : ''}`}>
                  {dbsChecked}/{databases.length} checked
                </span>
              )}
              <CheckButton busy={dbsBusy} disabled={checkDisabled.dbs} label={dbsChecked > 0 ? '⟳ Re-check' : 'Check'} onClick={onCheckDbs} />
            </span>
          }
        >
          {databases.length === 0 ? (
            <p className="panel-empty">{dbs ? 'No databases in this subscription.' : 'Listing databases…'}</p>
          ) : (
            databases.map((d, i) => <DbCard key={`${d.server}/${d.name}`} d={d} issues={issueMap[i]!} />)
          )}
        </Section>

        </div>
      </div>
      <div className="cd-wide">
        {/* on demand only: nothing is requested until its button is pressed */}
        <CallsSection key={row.subscriptionId} subscriptionId={row.subscriptionId} onOpenFull={onOpenCalls ? () => onOpenCalls(row.subscriptionId) : undefined} />
      </div>
    </SidePanel>
  );
}
