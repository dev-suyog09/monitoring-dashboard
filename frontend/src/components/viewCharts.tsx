import type { BotsResponse, DatabasesResponse } from '../types';
import type { CustomerRow } from '../lib/customers';
import { instanceLevel } from '../lib/instanceState';
import { envOf } from '../lib/watchMatch';
import { Panel } from './panels';
import { Donut, HBars, StackBars, type BarRow, type StackRow } from './charts';

const OK = 'var(--ok)';
const WARN = 'var(--warn)';
const ERR = 'var(--err)';
const IDLE = 'var(--idle)';
const ACCENT = 'var(--accent)';

/* ──────────────────────────── Customers ──────────────────────────── */

export function CustomerCharts({ rows }: { rows: CustomerRow[] }) {
  // Archive today, one count per customer
  let aOk = 0;
  let aWarn = 0;
  let aErr = 0;
  let aNone = 0;
  for (const r of rows) {
    if (r.accounts.length === 0 || r.archive.monitorable === 0) aNone++;
    else if (r.archive.healthy === r.archive.monitorable) aOk++;
    else if (r.archive.errors > 0) aErr++;
    else aWarn++;
  }

  // Bot instances (checked customers only)
  let started = 0;
  let down = 0;
  let other = 0;
  let botsUnchecked = 0;
  for (const r of rows) {
    started += r.bots.started;
    down += r.bots.down;
    other += r.bots.starting;
    if (r.bots.services > 0 && r.bots.checked === 0) botsUnchecked++;
  }
  const instTotal = started + down + other;

  // Databases
  let dbOk = 0;
  let dbIssue = 0;
  let dbUnchecked = 0;
  for (const r of rows) {
    dbIssue += r.dbs.issues;
    dbOk += r.dbs.checked - r.dbs.issues;
    dbUnchecked += r.dbs.total - r.dbs.checked;
  }

  // Customers needing attention: accounts not healthy + instances down + databases with issues
  const attention: StackRow[] = rows
    .map((r) => ({
      key: r.key,
      label: r.name.replace(/^AZU-NVM-FMC-NCC-/, ''),
      title: r.name,
      parts: [
        { label: 'archive not healthy', value: Math.max(0, r.archive.monitorable - r.archive.healthy), color: WARN },
        { label: 'instances down', value: r.bots.down, color: ERR },
        { label: 'databases with issues', value: r.dbs.issues, color: ACCENT },
      ],
    }))
    .filter((r) => r.parts.some((p) => p.value > 0))
    .sort((a, b) => b.parts.reduce((n, p) => n + p.value, 0) - a.parts.reduce((n, p) => n + p.value, 0))
    .slice(0, 8);

  return (
    <>
      <Panel title="Archive today · by customer">
        <Donut
          center={aOk}
          centerLabel={`of ${rows.length} healthy`}
          segments={[
            { label: 'All accounts archived', value: aOk, color: OK },
            { label: 'Some missing today', value: aWarn, color: WARN },
            { label: 'Errors', value: aErr, color: ERR },
            { label: 'No SRD', value: aNone, color: IDLE },
          ]}
        />
      </Panel>
      <Panel title="Bot instances · checked customers">
        <Donut
          center={started}
          centerLabel={`of ${instTotal} up`}
          empty="No bots checked yet — use ▸ check or Check everything."
          segments={[
            { label: 'Started', value: started, color: OK },
            { label: 'Starting / other', value: other, color: WARN },
            { label: 'Stopped / unresponsive', value: down, color: ERR },
            { label: 'Customers not checked', value: botsUnchecked, color: IDLE },
          ]}
        />
      </Panel>
      <Panel title="Databases · checked customers">
        <Donut
          center={dbOk}
          centerLabel="DBs OK"
          empty="No databases checked yet — use ▸ check or Check everything."
          segments={[
            { label: 'OK', value: dbOk, color: OK },
            { label: 'With issues', value: dbIssue, color: ERR },
            { label: 'Not checked', value: dbUnchecked, color: IDLE },
          ]}
        />
      </Panel>
      <Panel title="Needing attention · top customers">
        <StackBars rows={attention} empty="✓ Nothing needs attention in this view." />
        {attention.length > 0 && (
          <div className="stack-legend">
            <span><i style={{ background: WARN }} />archive not healthy</span>
            <span><i style={{ background: ERR }} />instances down</span>
            <span><i style={{ background: ACCENT }} />databases with issues</span>
          </div>
        )}
      </Panel>
    </>
  );
}

/* ──────────────────────────── Cloud Instances ──────────────────────────── */

export function BotCharts({ data }: { data: BotsResponse }) {
  const inst = data.instances;
  const lv = { ok: 0, warn: 0, bad: 0 };
  for (const i of inst) lv[instanceLevel(i.status)]++;
  const unchecked = data.cloudServices.filter((c) => !c.checkedAt).length;

  const parts = (ok: number, warn: number, bad: number) => [
    { label: 'Started', value: ok, color: OK },
    { label: 'Starting / other', value: warn, color: WARN },
    { label: 'Stopped / unresponsive', value: bad, color: ERR },
  ];

  const envs = new Map<string, { ok: number; warn: number; bad: number }>();
  const bots = new Map<string, { name: string; sub: string; ok: number; warn: number; bad: number }>();
  for (const i of inst) {
    const e = envs.get(envOf(i.cloudService)) ?? { ok: 0, warn: 0, bad: 0 };
    e[instanceLevel(i.status)]++;
    envs.set(envOf(i.cloudService), e);
    const key = `${i.subscriptionId}|${i.cloudService}`;
    const b = bots.get(key) ?? { name: i.cloudService, sub: i.subscription, ok: 0, warn: 0, bad: 0 };
    b[instanceLevel(i.status)]++;
    bots.set(key, b);
  }
  const ENV_LABEL: Record<string, string> = { PRD: 'PROD', UAT: 'UAT', DEV: 'DEV', OTHER: 'OTHER' };
  const envRows: StackRow[] = ['PRD', 'UAT', 'DEV', 'OTHER']
    .filter((e) => envs.has(e))
    .map((e) => ({ key: e, label: ENV_LABEL[e]!, parts: parts(envs.get(e)!.ok, envs.get(e)!.warn, envs.get(e)!.bad) }));
  const topBots: StackRow[] = [...bots.entries()]
    .map(([key, b]) => ({ key, label: b.name, title: `${b.name} · ${b.sub}`, parts: parts(b.ok, b.warn, b.bad) }))
    .sort((a, b) => b.parts.reduce((n, p) => n + p.value, 0) - a.parts.reduce((n, p) => n + p.value, 0))
    .slice(0, 8);

  return (
    <>
      <Panel title="Instance states">
        <Donut
          center={lv.ok}
          centerLabel={`of ${inst.length} up`}
          empty="No instances checked yet — use Check all bots."
          segments={[
            { label: 'Started', value: lv.ok, color: OK },
            { label: 'Starting / other', value: lv.warn, color: WARN },
            { label: 'Stopped / unresponsive', value: lv.bad, color: ERR },
            { label: 'Bots not checked', value: unchecked, color: IDLE },
          ]}
        />
      </Panel>
      <Panel title="By environment">
        <StackBars rows={envRows} empty="No instances checked yet." />
      </Panel>
      <Panel title="Biggest bots · instances">
        <StackBars rows={topBots} empty="No instances checked yet." />
      </Panel>
    </>
  );
}

/* ──────────────────────────── Databases ──────────────────────────── */

export function DbCharts({ data }: { data: DatabasesResponse }) {
  const crit = data.storageThreshold;
  const warn = data.warnThreshold;
  const dtuThr = data.dtuThreshold;
  const checked = data.databases.filter((d) => d.checkedAt !== null);
  const withPct = checked.filter((d) => d.usedPct !== null);

  const ok = withPct.filter((d) => d.usedPct! <= warn).length;
  const watch = withPct.filter((d) => d.usedPct! > warn && d.usedPct! <= crit).length;
  const critical = withPct.filter((d) => d.usedPct! > crit).length;
  const rest = data.databases.length - withPct.length; // not checked, or no storage figure (N/A)

  const levelColor = (p: number) => (p > crit ? ERR : p > warn ? WARN : OK);
  const storage: BarRow[] = [...withPct]
    .sort((a, b) => b.usedPct! - a.usedPct!)
    .slice(0, 8)
    .map((d) => ({
      key: `${d.subscriptionId}|${d.server}|${d.name}`,
      label: `${d.name} · ${d.server}`,
      title: `${d.server} / ${d.name}`,
      value: d.usedPct!,
      max: 100,
      display: `${d.usedPct}%`,
      sub: `${d.usedGB ?? 0} / ${d.totalGB} GB`,
      color: levelColor(d.usedPct!),
      marker: crit,
    }));
  const dtu: BarRow[] = checked
    .filter((d) => d.isDtu && d.dtuPct !== null)
    .sort((a, b) => b.dtuPct! - a.dtuPct!)
    .slice(0, 6)
    .map((d) => ({
      key: `${d.subscriptionId}|${d.server}|${d.name}`,
      label: `${d.name} · ${d.server}`,
      title: `${d.server} / ${d.name}`,
      value: d.dtuPct!,
      max: 100,
      display: `${d.dtuPct}%`,
      color: d.dtuPct! > dtuThr ? ERR : ACCENT,
      marker: dtuThr,
    }));

  return (
    <>
      <Panel title="Storage levels">
        <Donut
          center={checked.length}
          centerLabel="checked"
          empty="No databases checked yet — use Check all databases."
          segments={[
            { label: `OK (≤ ${warn}%)`, value: ok, color: OK },
            { label: `Watch (${warn}–${crit}%)`, value: watch, color: WARN },
            { label: `Critical (> ${crit}%)`, value: critical, color: ERR },
            { label: 'N/A or not checked', value: rest, color: IDLE },
          ]}
        />
      </Panel>
      <Panel title={`Fullest databases · storage (limit ${crit}%)`}>
        <HBars rows={storage} empty="No storage figures yet — run a check." />
      </Panel>
      <Panel title={`Busiest right now · DTU (limit ${dtuThr}%)`}>
        <HBars rows={dtu} empty="No DTU readings yet — run a check." />
      </Panel>
    </>
  );
}
