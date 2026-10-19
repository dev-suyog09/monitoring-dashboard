import { useMemo, useState } from 'react';
import type { BotsResponse } from '../types';
import { Panel, StatPanel } from './panels';
import BotGroups, { type BotScope } from './BotGroups';
import { ChartsSection } from './charts';
import { BotCharts } from './viewCharts';
import { instanceLevel, isDownState, LEVEL_SCOPE } from '../lib/instanceState';

function StateChip({ status }: { status: string }) {
  const scope = LEVEL_SCOPE[instanceLevel(status)];
  return (
    <span className={`chip ${scope}`}>
      <span className="dot" />
      {status}
    </span>
  );
}

/** Cloud Instances tab: bot (cloud service) role-instance state only. Nothing is read until a check is run. */
export default function BotsView({
  data,
  loading,
  error,
  checking,
  onCheck,
  autoNext,
}: {
  data: BotsResponse | null;
  loading: boolean;
  error: string | null;
  checking: string | null;
  onCheck: (key: string, scope: BotScope) => void;
  /** When the next automatic re-check of everything runs (null until a full check has been done). */
  autoNext: Date | null;
}) {
  const services = data?.cloudServices ?? [];
  const instances = data?.instances ?? [];

  const stats = useMemo(() => {
    const checked = services.filter((c) => c.checkedAt !== null);
    const notStarted = instances.filter((i) => i.status !== 'Started');
    // red = Stopped / Unresponsive; yellow = Starting and every other non-started state
    const red = notStarted.filter((i) => isDownState(i.status)).length;
    const starting = notStarted.length - red;
    return {
      checked: checked.length,
      unreadable: checked.filter((c) => c.error).length,
      notStarted,
      down: red,
      starting,
    };
  }, [services, instances]);

  // Clicking a card filters the whole tab: the table, and the bots / instances listed below.
  type CardFilter = 'all' | 'checked' | 'started' | 'down' | 'warn';
  const [f, setF] = useState<CardFilter>('all');
  const pick = (k: CardFilter) => setF((cur) => (cur === k ? 'all' : k));
  const statusFilter = useMemo<((s: string) => boolean) | null>(() => {
    if (f === 'started') return (s) => s === 'Started';
    if (f === 'down') return (s) => isDownState(s);
    if (f === 'warn') return (s) => s !== 'Started' && !isDownState(s);
    return null;
  }, [f]);
  const tableRows = useMemo(
    () => stats.notStarted.filter((i) => (f === 'down' ? isDownState(i.status) : f === 'warn' ? !isDownState(i.status) : true)),
    [stats.notStarted, f],
  );
  const FILTER_TEXT: Record<CardFilter, string> = {
    all: '',
    checked: 'bots that have been checked',
    started: 'started instances',
    down: 'stopped / unresponsive instances',
    warn: 'starting / other instances (not started, not stopped)',
  };

  if (error && !data) {
    return (
      <div className="banner banner-err">
        <strong>Error:</strong> {error}
      </div>
    );
  }
  if (!data) {
    return <div className="banner banner-warm">⏳ Listing cloud services…</div>;
  }

  return (
    <>
      {error && (
        <div className="banner banner-err">
          <strong>Check failed:</strong> {error}
        </div>
      )}
      {stats.checked === 0 && (
        <div className="banner banner-warm">
          Nothing has been checked yet. Use <strong>Check all bots</strong> at the top, or open a customer below and check
          just that one — nothing is read from Azure until you ask. After the first full check it re-checks everything
          automatically every 15 minutes.
        </div>
      )}
      {autoNext && (
        <p className="text-xs" style={{ color: 'var(--text-3)' }}>
          ⟳ Auto re-check of all bots every 15 min · next at{' '}
          <span className="mono">{autoNext.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </p>
      )}

      <div className="stat-row">
        <StatPanel label="Cloud services" value={services.length} active={f === 'all'} onClick={() => setF('all')} />
        <StatPanel label="Checked" value={`${stats.checked}/${services.length}`} active={f === 'checked'} onClick={() => pick('checked')} />
        <StatPanel
          label="Instances started"
          value={stats.checked === 0 ? '—' : `${instances.length - stats.notStarted.length}/${instances.length}`}
          scope={stats.checked === 0 ? 'st-idle' : stats.notStarted.length === 0 ? 'st-ok' : stats.down > 0 ? 'st-err' : 'st-warn'}
          active={f === 'started'}
          onClick={() => pick('started')}
        />
        <StatPanel
          label="Stopped / unresponsive"
          value={stats.checked === 0 ? '—' : stats.down}
          scope={stats.checked === 0 ? 'st-idle' : stats.down > 0 ? 'st-err' : 'st-ok'}
          active={f === 'down'}
          onClick={() => pick('down')}
        />
        <StatPanel
          label="Starting / other"
          value={stats.checked === 0 ? '—' : stats.starting}
          scope={stats.checked === 0 ? 'st-idle' : stats.starting > 0 ? 'st-warn' : 'st-ok'}
          active={f === 'warn'}
          onClick={() => pick('warn')}
        />
      </div>

      {f !== 'all' && (
        <div className="banner banner-warm flex items-center justify-between gap-3">
          <span>
            Showing only <strong>{FILTER_TEXT[f]}</strong>
          </span>
          <button className="pill" onClick={() => setF('all')}>
            ✕ Show everything
          </button>
        </div>
      )}

      <ChartsSection label="charts">
        <BotCharts data={data} onPick={(k) => setF(k)} />
      </ChartsSection>

      {stats.checked > 0 && f !== 'started' && (
        <Panel
          title="Instances that are not started"
          right={
            <span className="panel-legend">
              {stats.down} stopped / unresponsive · {stats.starting} starting / other
              {stats.unreadable > 0 ? ` · ${stats.unreadable} cloud service(s) unreadable` : ''}
            </span>
          }
          bodyClass="panel-bd-flush"
        >
          {tableRows.length === 0 ? (
            <p className="panel-empty">{f === 'all' ? '✓ All checked role instances are Started.' : 'No instances in this state.'}</p>
          ) : (
            <div className="dtable-wrap">
              <table className="dtable">
                <thead>
                  <tr>
                    <th>Subscription</th>
                    <th>Resource group</th>
                    <th>Cloud service</th>
                    <th>Instance</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[...tableRows]
                    .sort((a, b) => Number(!isDownState(a.status)) - Number(!isDownState(b.status)))
                    .map((i) => (
                      <tr key={`${i.subscriptionId}|${i.cloudService}|${i.instance}`} style={{ cursor: 'default' }}>
                        <td>{i.subscription}</td>
                        <td className="mono">{i.resourceGroup}</td>
                        <td className="mono">{i.cloudService}</td>
                        <td className="mono">{i.instance}</td>
                        <td>
                          <StateChip status={i.status} />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      <BotGroups data={data} checking={checking} onCheck={onCheck} statusFilter={statusFilter} onlyChecked={f === 'checked'} />
      {loading && <p className="text-xs" style={{ color: 'var(--text-3)' }}>Loading…</p>}
    </>
  );
}
