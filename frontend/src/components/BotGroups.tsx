import { useMemo, useState } from 'react';
import type { BotsResponse } from '../types';
import { groupBots, healthOf, type BotEntry, type BotGroup, type Health } from '../lib/botGroups';
import { Panel } from './panels';
import { instanceLevel, LEVEL_SCOPE } from '../lib/instanceState';

export type BotScope = { customer?: string; env?: string; service?: string; subscriptionId?: string };

const SCOPE: Record<Health, string> = { ok: 'st-ok', warn: 'st-warn', bad: 'st-err', idle: 'st-idle' };
const ENV_LABEL: Record<string, string> = { prd: 'PRD', uat: 'UAT', dev: 'DEV', tst: 'TST', stg: 'STG', poc: 'POC', other: 'OTHER' };
const ENV_CLASS: Record<string, string> = { prd: 'en-PRD', uat: 'en-UAT', dev: 'en-DEV', tst: 'en-DEV', stg: 'en-DEV', poc: 'en-DEV', other: 'en-OTHER' };

/** "MicrosoftTeams.RecordingService_IN_0" -> "IN_0" (full name stays in the tooltip). */
function shortInstance(name: string): string {
  const m = /(IN_\d+)$/.exec(name);
  return m ? m[1]! : name;
}

function InstanceChip({ name, status }: { name: string; status: string }) {
  const scope = LEVEL_SCOPE[instanceLevel(status)];
  return (
    <span className={`chip ${scope}`} title={`${name} — ${status}`}>
      <span className="dot" />
      {shortInstance(name)}
      {status !== 'Started' && <> · {status}</>}
    </span>
  );
}

/** Small "check" button; safe inside a <summary> (does not toggle the group). */
function CheckButton({
  label,
  busy,
  disabled,
  onClick,
  title,
}: {
  label: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      className="pill"
      style={{ fontSize: 11, padding: '3px 10px' }}
      disabled={disabled}
      title={title}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
    >
      {busy ? '⟳ checking…' : label}
    </button>
  );
}

function Bot({ b, checking, onCheck }: { b: BotEntry; checking: string | null; onCheck: (key: string, scope: BotScope) => void }) {
  const key = `bot:${b.service.name}`;
  const h = b.service.error ? 'warn' : healthOf(b.checked, b.started, b.instances.length, b.down, b.starting);
  return (
    <li className="rounded-xl p-3" style={{ background: 'var(--card)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="mono text-xs font-semibold" style={{ color: 'var(--text-1)' }} title={b.service.subscription}>
          {b.service.name}
        </span>
        {b.region && (
          <span className="mono text-[10px]" style={{ color: 'var(--text-3)' }}>
            {b.region}
          </span>
        )}
        {!b.checked ? (
          <span className="chip st-idle">not checked</span>
        ) : b.service.error ? (
          <span className="td-err" title={b.service.error}>
            unchecked — {b.service.error}
          </span>
        ) : (
          <span className={`chip ${SCOPE[h]}`}>
            {b.started}/{b.instances.length} instances
          </span>
        )}
        <span className="ml-auto">
          <CheckButton
            label={b.checked ? '⟳ Re-check' : 'Check'}
            busy={checking === key}
            disabled={checking !== null}
            title="Check this bot only"
            onClick={() => onCheck(key, { service: b.service.name })}
          />
        </span>
      </div>
      {b.instances.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {b.instances.map((i) => (
            <InstanceChip key={i.instance} name={i.instance} status={i.status} />
          ))}
        </div>
      )}
    </li>
  );
}

function Group({ g, checking, onCheck }: { g: BotGroup; checking: string | null; onCheck: (key: string, scope: BotScope) => void }) {
  const key = `group:${g.key}`;
  const h = healthOf(g.checkedBots > 0, g.started, g.total, g.down, g.starting, g.errors);
  const regions = [...new Set(g.bots.map((b) => b.region).filter(Boolean))];
  const notChecked = g.bots.length - g.checkedBots;
  return (
    <details className={`rounded-2xl ${SCOPE[h]}`} style={{ background: 'var(--card-2)', border: '1px solid var(--border)' }}>
      <summary className="flex cursor-pointer select-none flex-wrap items-center gap-3 p-3.5">
        <span className="mono text-sm font-bold uppercase" style={{ color: 'var(--text-1)', minWidth: 54 }}>
          {g.customer}
        </span>
        <span className={`chip ${ENV_CLASS[g.env] ?? 'en-OTHER'}`}>{ENV_LABEL[g.env] ?? g.env.toUpperCase()}</span>
        {g.checkedBots === 0 ? (
          <span className="chip st-idle">not checked</span>
        ) : (
          <span className={`chip ${SCOPE[h]}`}>
            <span className="dot" />
            {g.started}/{g.total} instances
          </span>
        )}
        <span className="text-xs" style={{ color: 'var(--text-3)' }}>
          {g.bots.length} bot{g.bots.length === 1 ? '' : 's'}
          {regions.length ? ` · ${regions.join(', ')}` : ''}
          {g.down > 0 ? ` · ${g.down} down` : ''}
          {g.starting > 0 ? ` · ${g.starting} starting / other` : ''}
          {g.errors > 0 ? ` · ${g.errors} unreadable` : ''}
          {g.checkedBots > 0 && notChecked > 0 ? ` · ${notChecked} not checked` : ''}
        </span>
        <span className="ml-auto">
          <CheckButton
            label={g.checkedBots > 0 ? '⟳ Re-check' : 'Check'}
            busy={checking === key}
            disabled={checking !== null}
            title={`Check every ${g.customer.toUpperCase()} ${ENV_LABEL[g.env] ?? g.env} bot`}
            onClick={() => onCheck(key, { customer: g.customer, env: g.env === 'other' ? undefined : g.env })}
          />
        </span>
      </summary>
      <ul className="flex flex-col gap-2 px-3.5 pb-3.5">
        {g.bots.map((b) => (
          <Bot key={`${b.service.subscriptionId}|${b.service.name}`} b={b} checking={checking} onCheck={onCheck} />
        ))}
      </ul>
    </details>
  );
}

/** Bots grouped by customer + environment: "DB · PRD — 8/8 instances", expandable to every bot and instance. */
export default function BotGroups({
  data,
  checking,
  onCheck,
}: {
  data: BotsResponse;
  checking: string | null;
  onCheck: (key: string, scope: BotScope) => void;
}) {
  const [q, setQ] = useState('');

  const groups = useMemo(() => groupBots(data.cloudServices, data.instances), [data]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return groups.filter(
      (g) => !term || g.customer.includes(term) || g.bots.some((b) => b.service.name.toLowerCase().includes(term)),
    );
  }, [groups, q]);

  const started = shown.reduce((n, g) => n + g.started, 0);
  const total = shown.reduce((n, g) => n + g.total, 0);

  return (
    <Panel
      title="Bots by customer · environment"
      right={
        <span className="panel-legend">
          {shown.length} group{shown.length === 1 ? '' : 's'} · {started}/{total} instances started (checked bots)
        </span>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Customer or bot name…"
          className="mono ml-auto rounded-full px-3 py-1.5 text-xs"
          style={{ background: 'var(--card)', color: 'var(--text-1)', border: '1px solid var(--border-strong)', minWidth: 220 }}
        />
      </div>
      {shown.length === 0 ? (
        <p className="panel-empty">No bots match.</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {shown.map((g) => (
            <Group key={g.key} g={g} checking={checking} onCheck={onCheck} />
          ))}
        </div>
      )}
    </Panel>
  );
}
