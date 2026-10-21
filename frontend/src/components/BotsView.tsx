import { useMemo, useState } from 'react';
import type { BotsResponse } from '../types';
import { Panel } from './panels';
import { everyLabel, useSettings } from '../lib/settings';
import MetricStrip from './MetricStrip';
import AttentionList, { type AttentionItem } from './AttentionList';
import BotGroups, { type BotScope } from './BotGroups';
import { ChartsSection, Donut } from './charts';
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
  const minutes = useSettings().autoMinutes;
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
  /** Bots with something not started, worst first. */
  const attention = useMemo(() => {
    const by = new Map<string, { name: string; sub: string; down: number; other: number; total: number }>();
    for (const i of instances) {
      const k = `${i.subscriptionId}|${i.cloudService}`;
      const e = by.get(k) ?? { name: i.cloudService, sub: i.subscription, down: 0, other: 0, total: 0 };
      e.total++;
      if (isDownState(i.status)) e.down++;
      else if (i.status !== 'Started') e.other++;
      by.set(k, e);
    }
    return [...by.entries()]
      .filter(([, e]) => e.down > 0 || e.other > 0)
      .sort((a, b) => b[1].down * 100 + b[1].other - (a[1].down * 100 + a[1].other));
  }, [instances]);
  const attentionItems: AttentionItem[] = attention.slice(0, 6).map(([key, e]) => ({
    key,
    title: e.name,
    sub: `${e.sub} · ${e.total} instance${e.total === 1 ? '' : 's'}`,
    badge: e.name.slice(0, 2).toUpperCase(),
    pills: [
      ...(e.down > 0 ? [{ text: `${e.down} down`, scope: 'st-err' }] : []),
      ...(e.other > 0 ? [{ text: `${e.other} starting / other`, scope: 'st-warn' }] : []),
    ],
    onClick: () => setF(e.down > 0 ? 'down' : 'warn'),
  }));
  const upCount = instances.length - stats.notStarted.length;
  const unchecked = services.length - stats.checked;

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
    return (
      <div className="skeleton-page" role="status" aria-label="Listing cloud services">
        <div className="skeleton" style={{ height: 96 }} />
        <div className="skeleton" style={{ height: 44 }} />
        <div className="skeleton" style={{ height: 260 }} />
      </div>
    );
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
          just that one. {minutes > 0 ? `It also re-checks everything automatically ${everyLabel(minutes, true)} while this page is open.` : 'Automatic re-checks are off (Settings).'}
        </div>
      )}
      {autoNext && (
        <p className="text-xs" style={{ color: 'var(--text-3)' }}>
          ⟳ Auto re-check of all bots {everyLabel(minutes)} · next at{' '}
          <span className="mono">{autoNext.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </p>
      )}

      <MetricStrip
        metrics={[
          { key: 'all', label: 'Cloud services', value: services.length, sub: `${instances.length} instances listed`, tone: 'neutral', active: f === 'all', onClick: () => setF('all') },
          {
            key: 'checked',
            label: 'Checked',
            value: `${stats.checked}/${services.length}`,
            ring: services.length ? (stats.checked / services.length) * 100 : 0,
            sub: unchecked > 0 ? `${unchecked} not checked yet` : 'all checked',
            tone: stats.checked === 0 ? 'idle' : unchecked > 0 ? 'warn' : 'ok',
            active: f === 'checked',
            onClick: () => pick('checked'),
          },
          {
            key: 'started',
            label: 'Instances started',
            value: stats.checked === 0 ? '—' : `${upCount}/${instances.length}`,
            ring: instances.length ? (upCount / instances.length) * 100 : 0,
            sub: stats.checked === 0 ? 'not checked yet' : stats.notStarted.length === 0 ? '▲ all started' : `▼ ${stats.notStarted.length} not started`,
            tone: stats.checked === 0 ? 'idle' : stats.notStarted.length === 0 ? 'ok' : stats.down > 0 ? 'err' : 'warn',
            active: f === 'started',
            onClick: () => pick('started'),
          },
          {
            key: 'down',
            label: 'Stopped / unresponsive',
            value: stats.checked === 0 ? '—' : stats.down,
            sub: stats.checked === 0 ? 'not checked yet' : stats.down > 0 ? 'needs action' : 'none',
            tone: stats.checked === 0 ? 'idle' : stats.down > 0 ? 'err' : 'ok',
            active: f === 'down',
            onClick: () => pick('down'),
          },
          {
            key: 'warn',
            label: 'Starting / other',
            value: stats.checked === 0 ? '—' : stats.starting,
            sub: stats.checked === 0 ? 'not checked yet' : stats.starting > 0 ? 'keep an eye on these' : 'none',
            tone: stats.checked === 0 ? 'idle' : stats.starting > 0 ? 'warn' : 'ok',
            active: f === 'warn',
            onClick: () => pick('warn'),
          },
        ]}
      />

      <ChartsSection label="charts">
        <BotCharts data={data} onPick={(k) => setF(k)} />
      </ChartsSection>

      <div className="cust-layout">
        <div className="cust-main">
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
        </div>
        <aside className="cust-side">
          <div className="side-scroll">
        <AttentionList items={attentionItems} total={attention.length} empty={stats.checked === 0 ? 'Run a check to see which bots need attention.' : '✓ Every checked instance is started.'} />
        <Panel title="Instance health" right={<span className="panel-legend">{instances.length} instances</span>}>
          <Donut
            center={upCount}
            centerLabel={`of ${instances.length} up`}
            empty="No instances checked yet — use Check all bots."
            segments={[
              { label: 'Started', value: upCount, color: 'var(--ok)', onClick: () => setF('started') },
              { label: 'Starting / other', value: stats.starting, color: 'var(--warn)', onClick: () => setF('warn') },
              { label: 'Stopped / unresponsive', value: stats.down, color: 'var(--err)', onClick: () => setF('down') },
              { label: 'Bots not checked', value: unchecked, color: 'var(--idle)' },
            ]}
          />
        </Panel>
          </div>
        </aside>
      </div>
    </>
  );
}
