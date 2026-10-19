/**
 * Bot instances + SQL databases health (the dashboard version of Bot_Database_Multiple_Subscription_HC_Optimized.ps1).
 * Everything runs ON DEMAND — nothing is scanned at startup:
 *  - the tabs list the inventory (one cheap Resource Graph query per type), and
 *  - a check reads the live state: role-instance status for bots; status / latest LTR backup / storage for databases.
 * A check can cover everything or just one customer / bot / server / database.
 */
import type { TokenCredential } from '@azure/identity';
import { ResourceGraphClient } from '@azure/arm-resourcegraph';
import type { AppConfig } from './config.js';
import type { BotsResponse, DatabasesResponse, InfraCloudService, InfraDatabase, InfraInstance } from './types.js';
import { graphAll, mgmtCredential } from './azure.js';

const ARM = 'https://management.azure.com';
/** % used above which a database is critical / on watch (same thresholds as the PowerShell script). */
export const STORAGE_THRESHOLD = 75;
export const WARN_THRESHOLD = 60;
/** DTU utilization (%) above which a DTU-model database is flagged; the reading is the latest one-minute value. */
export const DTU_THRESHOLD = Number(process.env.DTU_THRESHOLD ?? 90);
/** Azure Monitor lags a minute or two, so look back this far for the newest datapoint. */
export const DTU_LOOKBACK_MINUTES = Math.max(5, Number(process.env.DTU_LOOKBACK_MINUTES ?? 15));
/** How long a Resource Graph inventory is reused before a view re-lists it. */
const INVENTORY_TTL_MS = 10 * 60_000;

// ---------------------------------------------------------------- pure helpers (unit-tested)

/** "RoleState/RoleStateStarted" -> "Started". Anything unrecognised -> "Unknown". */
export function parseRoleState(statuses: Array<{ code?: string; displayStatus?: string }> | undefined): string {
  const first = statuses?.[0];
  const text = `${first?.code ?? ''} ${first?.displayStatus ?? ''}`;
  const m = /RoleState(\w+)/.exec(text);
  return m ? m[1]! : 'Unknown';
}

/** Latest non-zero "Maximum" datapoint from an Azure Monitor timeseries (bytes), or 0 when there is none. */
export function latestMaximum(data: Array<{ timeStamp?: string; maximum?: number }> | undefined): number {
  const pts = (data ?? []).filter((d) => d.maximum);
  pts.sort((a, b) => (b.timeStamp ?? '').localeCompare(a.timeStamp ?? ''));
  return pts[0]?.maximum ?? 0;
}

/** Newest backup time per database name from an LTR listing. */
export function latestBackupByDb(
  backups: Array<{ properties?: { databaseName?: string; backupTime?: string } }>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const b of backups) {
    const name = b.properties?.databaseName?.toLowerCase();
    const time = b.properties?.backupTime;
    if (!name || !time) continue;
    const cur = out.get(name);
    if (!cur || time > cur) out.set(name, time);
  }
  return out;
}

/** Used % rounded to 2 dp, or null when either figure is missing (shown as N/A). */
export function usedPercent(usedBytes: number, maxBytes: number): number | null {
  if (!usedBytes || !maxBytes) return null;
  const usedGB = round2(usedBytes / 2 ** 30);
  const maxGB = round2(maxBytes / 2 ** 30);
  if (usedGB === 0 || maxGB === 0) return null;
  return round2((usedGB / maxGB) * 100);
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Basic / Standard / Premium are DTU-model tiers; GeneralPurpose, BusinessCritical, Hyperscale are vCore. */
export function isDtuTier(tier: string | undefined): boolean {
  return /^(basic|standard|premium)$/i.test((tier ?? '').trim());
}

/** Newest datapoint that has an "average" value (a 0 is a real reading), or nulls when there is none. */
export function latestReading(
  data: Array<{ timeStamp?: string; average?: number }> | undefined,
): { value: number | null; at: string | null } {
  const pts = (data ?? []).filter((d) => typeof d.average === 'number');
  pts.sort((a, b) => (b.timeStamp ?? '').localeCompare(a.timeStamp ?? ''));
  const p = pts[0];
  return p ? { value: round2(p.average!), at: p.timeStamp ?? null } : { value: null, at: null };
}

/** `<customer><env>ntx-<region>-cs-<kind>` -> customer + env (same parsing as the dashboard's grouping). */
const BOT_NAME_RE = /^([a-z0-9]+?)(prd|uat|dev|tst|stg|poc)(?:ntx|ntrx|ntr)?-([a-z0-9]+)-cs-(.+)$/i;
export function parseBotName(name: string): { customer: string; env: string } {
  const m = BOT_NAME_RE.exec(name);
  return m ? { customer: m[1]!.toLowerCase(), env: m[2]!.toLowerCase() } : { customer: name.split('-')[0]!.toLowerCase(), env: 'other' };
}

export interface BotScope {
  customer?: string;
  env?: string;
  service?: string;
  subscriptionId?: string;
}
export interface DbScope {
  server?: string;
  db?: string;
  subscriptionId?: string;
}

/** Pure: which inventory entries does a scope select? An empty scope selects everything. */
export function selectBots(all: InfraCloudService[], scope: BotScope): InfraCloudService[] {
  const { customer, env, service, subscriptionId } = scope;
  return all.filter((c) => {
    if (service && c.name.toLowerCase() !== service.toLowerCase()) return false;
    if (subscriptionId && c.subscriptionId.toLowerCase() !== subscriptionId.toLowerCase()) return false;
    if (customer || env) {
      const p = parseBotName(c.name);
      if (customer && p.customer !== customer.toLowerCase()) return false;
      if (env && p.env !== env.toLowerCase()) return false;
    }
    return true;
  });
}

export function selectDbs(all: InfraDatabase[], scope: DbScope): InfraDatabase[] {
  const { server, db, subscriptionId } = scope;
  return all.filter(
    (d) =>
      (!server || d.server.toLowerCase() === server.toLowerCase()) &&
      (!db || d.name.toLowerCase() === db.toLowerCase()) &&
      (!subscriptionId || d.subscriptionId.toLowerCase() === subscriptionId.toLowerCase()),
  );
}

// ---------------------------------------------------------------- ARM REST helper

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET an ARM url (path or absolute) with retries on throttling / 5xx. Returns null on any failure. */
async function armGet<T>(cred: TokenCredential, url: string): Promise<T | null> {
  const full = url.startsWith('http') ? url : ARM + url;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const token = await cred.getToken(`${ARM}/.default`);
      if (!token) return null;
      const res = await fetch(full, {
        headers: { Authorization: `Bearer ${token.token}` },
        signal: AbortSignal.timeout(45_000),
      });
      if (res.status === 429 || res.status >= 500) {
        const wait = Number(res.headers.get('retry-after')) * 1000 || 1500 * 2 ** attempt;
        await sleep(Math.min(wait, 20_000));
        continue;
      }
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      await sleep(1000 * (attempt + 1));
    }
  }
  return null;
}

/** Follow `nextLink` paging; returns every `value` item, or null if the first page failed. */
async function armList<T>(cred: TokenCredential, url: string): Promise<T[] | null> {
  const all: T[] = [];
  let next: string | undefined = url;
  for (let page = 0; next && page < 50; page++) {
    const body: { value?: T[]; nextLink?: string } | null = await armGet(cred, next);
    if (!body) return page === 0 ? null : all;
    all.push(...(body.value ?? []));
    next = body.nextLink;
  }
  return all;
}

async function pMap<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
}

// ---------------------------------------------------------------- inventory (Resource Graph)

interface GraphRow {
  [k: string]: string;
}

const CONCURRENCY = Math.max(1, Number(process.env.INFRA_CONCURRENCY ?? 24));

let subNames: { at: number; map: Map<string, string> } | null = null;
async function subscriptionNames(graph: ResourceGraphClient, cfg: AppConfig): Promise<Map<string, string>> {
  if (subNames && Date.now() - subNames.at < 3_600_000) return subNames.map;
  const rows = await graphAll(
    graph,
    `resourcecontainers | where type =~ 'microsoft.resources/subscriptions' | project subscriptionId, name`,
    cfg.scopeSubscriptions,
  );
  subNames = { at: Date.now(), map: new Map(rows.map((r) => [r.subscriptionId!.toLowerCase(), r.name!])) };
  return subNames.map;
}

async function discoverBots(cfg: AppConfig, cred: TokenCredential): Promise<InfraCloudService[]> {
  const graph = new ResourceGraphClient(cred);
  const [names, rows] = await Promise.all([
    subscriptionNames(graph, cfg),
    graphAll(
      graph,
      `resources | where type =~ 'microsoft.compute/cloudservices' | project name, resourceGroup, subscriptionId`,
      cfg.scopeSubscriptions,
    ),
  ]);
  return rows.map((r) => ({
    subscriptionId: r.subscriptionId!,
    subscription: names.get(r.subscriptionId!.toLowerCase()) ?? r.subscriptionId!,
    resourceGroup: r.resourceGroup!,
    name: r.name!,
    running: 0,
    total: 0,
    checkedAt: null,
    error: null,
  }));
}

async function discoverDatabases(cfg: AppConfig, cred: TokenCredential): Promise<InfraDatabase[]> {
  const graph = new ResourceGraphClient(cred);
  const [names, rows] = await Promise.all([
    subscriptionNames(graph, cfg),
    graphAll(
      graph,
      `resources | where type =~ 'microsoft.sql/servers/databases' and name !~ 'master' ` +
        `| project id, name, resourceGroup, subscriptionId, location, status=tostring(properties.status), ` +
        `maxSizeBytes=tolong(properties.maxSizeBytes), tier=tostring(sku.tier)`,
      cfg.scopeSubscriptions,
    ),
  ]);
  return (rows as GraphRow[]).map((r) => ({
    subscriptionId: r.subscriptionId!,
    subscription: names.get(r.subscriptionId!.toLowerCase()) ?? r.subscriptionId!,
    resourceGroup: r.resourceGroup!,
    server: r.id!.split('/')[8]!,
    location: r.location!,
    name: r.name!,
    status: r.status || 'Unknown',
    totalGB: round2((Number(r.maxSizeBytes) || 0) / 2 ** 30),
    tier: r.tier || '',
    isDtu: isDtuTier(r.tier),
    checkedAt: null,
    latestBackup: null,
    backupChecked: false,
    usedGB: null,
    usedPct: null,
    dtuPct: null,
    dtuAt: null,
  }));
}

// ---------------------------------------------------------------- live checks

/** Read the role instances (and their states) of the given cloud services. */
async function checkBotServices(
  cred: TokenCredential,
  services: InfraCloudService[],
): Promise<Array<{ service: InfraCloudService; instances: InfraInstance[] }>> {
  const out: Array<{ service: InfraCloudService; instances: InfraInstance[] }> = [];
  await pMap(services, CONCURRENCY, async (cs) => {
    const base =
      `/subscriptions/${cs.subscriptionId}/resourceGroups/${cs.resourceGroup}` +
      `/providers/Microsoft.Compute/cloudServices/${cs.name}/roleInstances`;
    const list = await armList<{ name: string }>(cred, `${base}?api-version=2022-04-04`);
    const instances: InfraInstance[] = [];
    await pMap(list ?? [], 8, async (ri) => {
      const view = await armGet<{ statuses?: Array<{ code?: string; displayStatus?: string }> }>(
        cred,
        `${base}/${ri.name}/instanceView?api-version=2022-04-04`,
      );
      instances.push({
        subscriptionId: cs.subscriptionId,
        subscription: cs.subscription,
        resourceGroup: cs.resourceGroup,
        cloudService: cs.name,
        instance: ri.name,
        status: view ? parseRoleState(view.statuses) : 'Unknown',
      });
    });
    instances.sort((a, b) => a.instance.localeCompare(b.instance, undefined, { numeric: true }));
    out.push({
      service: {
        ...cs,
        running: instances.filter((i) => i.status === 'Started').length,
        total: instances.length,
        checkedAt: new Date().toISOString(),
        error: list ? null : 'Could not list role instances (no access, or the call failed).',
      },
      instances,
    });
  });
  return out;
}

/** Read latest LTR backup (per server) and storage usage (per database) for the given databases. */
async function checkDatabaseRows(cred: TokenCredential, dbs: InfraDatabase[]): Promise<InfraDatabase[]> {
  const servers = new Map<string, InfraDatabase>();
  for (const d of dbs) servers.set(`${d.subscriptionId}|${d.server}`.toLowerCase(), d);

  const backups = new Map<string, Map<string, string> | null>();
  await pMap([...servers.entries()], CONCURRENCY, async ([key, d]) => {
    const list = await armList<{ properties?: { databaseName?: string; backupTime?: string } }>(
      cred,
      `/subscriptions/${d.subscriptionId}/providers/Microsoft.Sql/locations/${d.location}` +
        `/longTermRetentionServers/${d.server}/longTermRetentionBackups?api-version=2021-11-01&onlyLatestPerDatabase=true`,
    );
    backups.set(key, list ? latestBackupByDb(list) : null);
  });

  const now = Date.now();
  const window = (days: number) =>
    `${new Date(now - days * 864e5).toISOString().slice(0, 19)}Z/${new Date(now).toISOString().slice(0, 19)}Z`;
  const out: InfraDatabase[] = [];
  await pMap(dbs, CONCURRENCY, async (d) => {
    const id =
      `/subscriptions/${d.subscriptionId}/resourceGroups/${d.resourceGroup}` +
      `/providers/Microsoft.Sql/servers/${d.server}/databases/${d.name}`;
    let bytes = 0;
    for (const days of [1, 7]) {
      // short window first, widen only when there is no data (same as the script)
      const m = await armGet<{ value?: Array<{ timeseries?: Array<{ data?: Array<{ timeStamp?: string; maximum?: number }> }> }> }>(
        cred,
        `${id}/providers/microsoft.insights/metrics?api-version=2018-01-01&metricnames=storage` +
          `&aggregation=Maximum&interval=PT1H&timespan=${window(days)}`,
      );
      bytes = latestMaximum(m?.value?.[0]?.timeseries?.[0]?.data);
      if (bytes) break;
    }
    // Current DTU utilization: the latest one-minute reading (DTU-model databases only; vCore has no such metric).
    let dtu: { value: number | null; at: string | null } = { value: null, at: null };
    if (d.isDtu) {
      const span = `${new Date(now - DTU_LOOKBACK_MINUTES * 60_000).toISOString().slice(0, 19)}Z/${new Date(now).toISOString().slice(0, 19)}Z`;
      const m = await armGet<{ value?: Array<{ timeseries?: Array<{ data?: Array<{ timeStamp?: string; average?: number }> }> }> }>(
        cred,
        `${id}/providers/microsoft.insights/metrics?api-version=2018-01-01&metricnames=dtu_consumption_percent` +
          `&aggregation=Average&interval=PT1M&timespan=${span}`,
      );
      dtu = latestReading(m?.value?.[0]?.timeseries?.[0]?.data);
    }
    const bk = backups.get(`${d.subscriptionId}|${d.server}`.toLowerCase());
    const maxBytes = d.totalGB * 2 ** 30;
    out.push({
      ...d,
      checkedAt: new Date().toISOString(),
      latestBackup: bk?.get(d.name.toLowerCase()) ?? null,
      backupChecked: bk !== null && bk !== undefined,
      usedGB: round2(bytes / 2 ** 30),
      usedPct: usedPercent(bytes, maxBytes),
      dtuPct: dtu.value,
      dtuAt: dtu.at,
    });
  });
  return out;
}

// ---------------------------------------------------------------- in-memory store (nothing runs until asked)

const botKey = (c: { subscriptionId: string; resourceGroup: string; name: string }) =>
  `${c.subscriptionId}|${c.resourceGroup}|${c.name}`.toLowerCase();
const dbKey = (d: { subscriptionId: string; server: string; name: string }) =>
  `${d.subscriptionId}|${d.server}|${d.name}`.toLowerCase();

/** Serialises checks so two clicks can't hammer Azure at once; later calls simply run after the earlier one. */
function serial() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const p = tail.then(fn, fn);
    tail = p.catch(() => undefined);
    return p;
  };
}

export class InfraStore {
  private cred: TokenCredential | null = null;
  private botInv: { at: number; list: InfraCloudService[] } | null = null;
  private dbInv: { at: number; list: InfraDatabase[] } | null = null;
  private botChecked = new Map<string, { service: InfraCloudService; instances: InfraInstance[] }>();
  private dbChecked = new Map<string, InfraDatabase>();
  private botLock = serial();
  private dbLock = serial();

  constructor(private readonly cfg: AppConfig) {}

  private credential(): TokenCredential {
    return (this.cred ??= mgmtCredential());
  }

  private async bots(force = false): Promise<InfraCloudService[]> {
    if (!force && this.botInv && Date.now() - this.botInv.at < INVENTORY_TTL_MS) return this.botInv.list;
    const list = await discoverBots(this.cfg, this.credential());
    this.botInv = { at: Date.now(), list };
    const keep = new Set(list.map(botKey));
    for (const k of this.botChecked.keys()) if (!keep.has(k)) this.botChecked.delete(k);
    return list;
  }

  private async dbs(force = false): Promise<InfraDatabase[]> {
    if (!force && this.dbInv && Date.now() - this.dbInv.at < INVENTORY_TTL_MS) return this.dbInv.list;
    const list = await discoverDatabases(this.cfg, this.credential());
    this.dbInv = { at: Date.now(), list };
    const keep = new Set(list.map(dbKey));
    for (const k of this.dbChecked.keys()) if (!keep.has(k)) this.dbChecked.delete(k);
    return list;
  }

  private botsResponse(inv: InfraCloudService[]): BotsResponse {
    const cloudServices = inv.map((c) => this.botChecked.get(botKey(c))?.service ?? c);
    const instances = inv.flatMap((c) => this.botChecked.get(botKey(c))?.instances ?? []);
    return { generatedAt: new Date().toISOString(), cloudServices, instances };
  }

  private dbsResponse(inv: InfraDatabase[]): DatabasesResponse {
    return {
      generatedAt: new Date().toISOString(),
      storageThreshold: STORAGE_THRESHOLD,
      warnThreshold: WARN_THRESHOLD,
      dtuThreshold: DTU_THRESHOLD,
      dtuLookbackMinutes: DTU_LOOKBACK_MINUTES,
      databases: inv.map((d) => this.dbChecked.get(dbKey(d)) ?? d),
    };
  }

  /** Inventory plus whatever has been checked so far (cheap — no per-resource calls). */
  async getBots(): Promise<BotsResponse> {
    return this.botsResponse(await this.bots());
  }
  async getDatabases(): Promise<DatabasesResponse> {
    return this.dbsResponse(await this.dbs());
  }

  /** Check the bots in `scope` (empty scope = all) and return the updated view. */
  checkBots(scope: BotScope): Promise<BotsResponse> {
    return this.botLock(async () => {
      const everything = !scope.customer && !scope.env && !scope.service && !scope.subscriptionId;
      const inv = await this.bots(everything);
      const targets = selectBots(inv, scope);
      for (const r of await checkBotServices(this.credential(), targets)) this.botChecked.set(botKey(r.service), r);
      return this.botsResponse(inv);
    });
  }

  checkDatabases(scope: DbScope): Promise<DatabasesResponse> {
    return this.dbLock(async () => {
      const everything = !scope.server && !scope.db && !scope.subscriptionId;
      const inv = await this.dbs(everything);
      const targets = selectDbs(inv, scope);
      for (const d of await checkDatabaseRows(this.credential(), targets)) this.dbChecked.set(dbKey(d), d);
      return this.dbsResponse(inv);
    });
  }
}
