import type { InfraCloudService, InfraInstance } from '../types';
import { isDownState } from './instanceState';

/**
 * Cloud service names look like `<customer><env>ntx-<region>-cs-<kind>`, e.g.
 * `dbprdntrx-gewc-cs-bot-11` -> customer "db", env "prd", region "gewc", kind "bot-11".
 */
const NAME_RE = /^([a-z0-9]+?)(prd|uat|dev|tst|stg|poc)(?:ntx|ntrx|ntr)?-([a-z0-9]+)-cs-(.+)$/i;

export interface ParsedBot {
  customer: string;
  env: string;
  region: string;
  kind: string;
}

export function parseBotName(name: string): ParsedBot {
  const m = NAME_RE.exec(name);
  if (m) return { customer: m[1]!.toLowerCase(), env: m[2]!.toLowerCase(), region: m[3]!.toLowerCase(), kind: m[4]! };
  return { customer: name.split('-')[0]!.toLowerCase(), env: 'other', region: '', kind: name };
}

export interface BotEntry {
  service: InfraCloudService;
  region: string;
  kind: string;
  /** False until a live check has run for this bot. */
  checked: boolean;
  instances: InfraInstance[];
  started: number;
  /** Instances in a Stopped / Aborted / Unknown / other state. */
  down: number;
  starting: number;
}

export interface BotGroup {
  key: string;
  customer: string;
  env: string;
  bots: BotEntry[];
  /** Counts cover the bots that have been checked. */
  started: number;
  total: number;
  down: number;
  starting: number;
  checkedBots: number;
  /** Bots whose instances could not be read. */
  errors: number;
}

/** idle = nothing checked yet. */
export type Health = 'ok' | 'warn' | 'bad' | 'idle';

export function healthOf(checked: boolean, started: number, total: number, down: number, starting: number, errors = 0): Health {
  if (!checked) return 'idle';
  if (down > 0 || (total > 0 && started === 0)) return 'bad';
  if (starting > 0 || errors > 0 || started < total) return 'warn';
  return 'ok';
}

/** Group every cloud service by customer + environment, with per-bot instance details. */
export function groupBots(services: InfraCloudService[], instances: InfraInstance[]): BotGroup[] {
  const byService = new Map<string, InfraInstance[]>();
  for (const i of instances) {
    const k = `${i.subscriptionId}|${i.resourceGroup}|${i.cloudService}`.toLowerCase();
    const list = byService.get(k);
    if (list) list.push(i);
    else byService.set(k, [i]);
  }

  const groups = new Map<string, BotGroup>();
  for (const svc of services) {
    const p = parseBotName(svc.name);
    const key = `${p.customer}|${p.env}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, customer: p.customer, env: p.env, bots: [], started: 0, total: 0, down: 0, starting: 0, checkedBots: 0, errors: 0 };
      groups.set(key, g);
    }
    const checked = svc.checkedAt !== null;
    const inst = (byService.get(`${svc.subscriptionId}|${svc.resourceGroup}|${svc.name}`.toLowerCase()) ?? []).sort((a, b) =>
      a.instance.localeCompare(b.instance, undefined, { numeric: true }),
    );
    const started = inst.filter((i) => i.status === 'Started').length;
    // down = Stopped / Unresponsive (red); `starting` = Starting plus every other non-started state (yellow)
    const down = inst.filter((i) => isDownState(i.status)).length;
    const starting = inst.length - started - down;
    g.bots.push({ service: svc, region: p.region, kind: p.kind, checked, instances: inst, started, down, starting });
    if (checked) {
      g.checkedBots++;
      g.started += started;
      g.total += inst.length;
      g.down += down;
      g.starting += starting;
      if (svc.error) g.errors++;
    }
  }

  const out = [...groups.values()];
  for (const g of out) {
    g.bots.sort((a, b) => a.region.localeCompare(b.region) || a.service.name.localeCompare(b.service.name, undefined, { numeric: true }));
  }
  // Problem groups first, then healthy, then never-checked; each by customer / env.
  const rank = (g: BotGroup) => ({ bad: 0, warn: 1, ok: 2, idle: 3 })[healthOf(g.checkedBots > 0, g.started, g.total, g.down, g.starting, g.errors)];
  return out.sort((a, b) => rank(a) - rank(b) || a.customer.localeCompare(b.customer) || a.env.localeCompare(b.env));
}
