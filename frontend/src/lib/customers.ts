import type { BotsResponse, CheckResult, DatabasesResponse, InfraDatabase } from '../types';
import { detectEnv } from './ui';
import { envOf, type EnvName } from './watchMatch';
import { isDownState } from './instanceState';

/** One row of the Customers view = one subscription, with its SRD accounts, bots and databases. */
export interface CustomerRow {
  key: string;
  subscriptionId: string;
  name: string;
  env: EnvName;
  accounts: CheckResult[];
  /**
   * healthy / monitorable are ACCOUNT counts, exactly as on the Archive tab (healthy = at least one capture folder has
   * today's data). partialFolders counts the capture folders still empty today inside accounts that are healthy, so a
   * "healthy" customer with folders missing is never shown as fully complete.
   */
  archive: { healthy: number; monitorable: number; errors: number; folders: number; foldersToday: number; partialFolders: number };
  bots: {
    services: number;
    checked: number;
    instances: number;
    started: number;
    down: number;
    starting: number;
    unreadable: number;
    checkedAt: string | null;
  };
  dbs: { total: number; checked: number; issues: number; issueText: string[]; checkedAt: string | null };
}

const SUB_ENV_RE = /(?:^|[-_ ])(PRD|PROD|UAT|DEV|TST|TEST)(?:[-_ ]|$)/i;

function envFromSubscriptionName(name: string): EnvName | null {
  const t = SUB_ENV_RE.exec(name)?.[1]?.toUpperCase();
  if (!t) return null;
  return t === 'PRD' || t === 'PROD' ? 'PRD' : t === 'UAT' ? 'UAT' : 'DEV';
}

const later = (a: string | null, b: string | null) => (a && b ? (a > b ? a : b) : (a ?? b));

/** Why a checked database needs attention (empty = fine). */
export function dbIssues(d: InfraDatabase, storageCrit: number, dtuCrit: number): string[] {
  const out: string[] = [];
  if (d.status !== 'Online') out.push(`${d.server}/${d.name}: ${d.status}`);
  if (d.usedPct !== null && d.usedPct > storageCrit) out.push(`${d.server}/${d.name}: storage ${d.usedPct}%`);
  if (d.dtuPct !== null && d.dtuPct > dtuCrit) out.push(`${d.server}/${d.name}: DTU ${d.dtuPct}%`);
  if (d.backupChecked && !d.latestBackup) out.push(`${d.server}/${d.name}: no LTR backup`);
  return out;
}

/** Group archive accounts, bots and databases by subscription (= customer). */
export function buildCustomerRows(
  results: CheckResult[],
  bots: BotsResponse | null,
  dbs: DatabasesResponse | null,
): CustomerRow[] {
  const rows = new Map<string, CustomerRow>();
  const get = (subscriptionId: string | undefined, name: string | undefined): CustomerRow => {
    const key = (subscriptionId ?? 'unknown').toLowerCase();
    let r = rows.get(key);
    if (!r) {
      r = {
        key,
        subscriptionId: subscriptionId ?? 'unknown',
        name: name || 'Unknown subscription',
        env: 'OTHER',
        accounts: [],
        archive: { healthy: 0, monitorable: 0, errors: 0, folders: 0, foldersToday: 0, partialFolders: 0 },
        bots: { services: 0, checked: 0, instances: 0, started: 0, down: 0, starting: 0, unreadable: 0, checkedAt: null },
        dbs: { total: 0, checked: 0, issues: 0, issueText: [], checkedAt: null },
      };
      rows.set(key, r);
    }
    return r;
  };

  for (const a of results) {
    const r = get(a.subscriptionId, a.subscription);
    r.accounts.push(a);
    if (a.status !== 'no_data') r.archive.monitorable++;
    if (a.status === 'healthy') {
      r.archive.healthy++;
      r.archive.partialFolders += Math.max(0, a.capturesTotal - a.capturesWithToday);
    }
    r.archive.folders += a.capturesTotal;
    r.archive.foldersToday += a.capturesWithToday;
    if (a.status === 'error') r.archive.errors++;
  }

  for (const c of bots?.cloudServices ?? []) {
    const r = get(c.subscriptionId, c.subscription);
    r.bots.services++;
    if (c.checkedAt) {
      r.bots.checked++;
      r.bots.checkedAt = later(r.bots.checkedAt, c.checkedAt);
      if (c.error) r.bots.unreadable++;
    }
  }
  for (const i of bots?.instances ?? []) {
    const r = get(i.subscriptionId, i.subscription);
    r.bots.instances++;
    if (i.status === 'Started') r.bots.started++;
    else if (isDownState(i.status)) r.bots.down++;
    else r.bots.starting++; // Starting and every other non-started state (yellow)
  }

  const storageCrit = dbs?.storageThreshold ?? 75;
  const dtuCrit = dbs?.dtuThreshold ?? 90;
  for (const d of dbs?.databases ?? []) {
    const r = get(d.subscriptionId, d.subscription);
    r.dbs.total++;
    if (d.checkedAt) {
      r.dbs.checked++;
      r.dbs.checkedAt = later(r.dbs.checkedAt, d.checkedAt);
      const issues = dbIssues(d, storageCrit, dtuCrit);
      if (issues.length) {
        r.dbs.issues++;
        r.dbs.issueText.push(...issues);
      }
    }
  }

  // Environment: from the subscription's accounts, else its bots / databases, else the subscription name.
  const botNames = new Map<string, string>();
  for (const c of bots?.cloudServices ?? []) botNames.set(c.subscriptionId.toLowerCase(), c.name);
  const dbNames = new Map<string, string>();
  for (const d of dbs?.databases ?? []) dbNames.set(d.subscriptionId.toLowerCase(), d.server);
  for (const r of rows.values()) {
    const fromAccount = r.accounts.map((a) => detectEnv(a.accountName)).find((e) => e !== 'OTHER');
    const bn = botNames.get(r.key);
    const dn = dbNames.get(r.key);
    const fromBot = bn ? envOf(bn) : 'OTHER';
    const fromDb = dn ? envOf(dn) : 'OTHER';
    r.env =
      fromAccount ??
      (fromBot !== 'OTHER' ? fromBot : fromDb !== 'OTHER' ? fromDb : (envFromSubscriptionName(r.name) ?? 'OTHER'));
    r.accounts.sort((a, b) => a.accountName.localeCompare(b.accountName));
  }

  return [...rows.values()];
}
