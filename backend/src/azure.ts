import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';
import { AzureCliCredential, DefaultAzureCredential } from '@azure/identity';
import type { AccessToken, TokenCredential } from '@azure/identity';
import { StorageManagementClient } from '@azure/arm-storage';
import { ResourceGraphClient } from '@azure/arm-resourcegraph';
import type { AppConfig } from './config.js';
import type { AccountClient, BotTarget } from './types.js';
import { friendlyError } from './checker.js';
import { kqlString, safeNameFragment } from './security.js';

/**
 * Management-plane credential (resolving accounts + reading keys). Locally this
 * is your `az login` session â€” exactly what the Azure Portal uses for "Access
 * key". Set USE_MANAGED_IDENTITY=true in a deployment to use a managed identity.
 */
let shared: TokenCredential | null = null;
export function mgmtCredential(): TokenCredential {
  // ONE credential for the whole process: its token cache is what saves the ~4 s `az` sign-in on every request
  return (shared ??= cachedCredential(
    process.env.USE_MANAGED_IDENTITY === 'true' ? new DefaultAzureCredential() : new AzureCliCredential(),
  ));
}

/** Parallel key fetches (ARM calls); raise/lower with KEY_CONCURRENCY. */
const KEY_CONCURRENCY = Math.max(1, Number(process.env.KEY_CONCURRENCY ?? 32));

/**
 * AzureCliCredential shells out to `az` for every token request (~1-2s each). Cache the
 * token (and share in-flight requests) so a few hundred key fetches reuse one token.
 */
function cachedCredential(inner: TokenCredential): TokenCredential {
  const cache = new Map<string, Promise<AccessToken | null>>();
  return {
    async getToken(scopes, options) {
      const key = Array.isArray(scopes) ? scopes.join(' ') : scopes;
      const hit = cache.get(key);
      if (hit) {
        const t = await hit.catch(() => null);
        if (t && t.expiresOnTimestamp - Date.now() > 5 * 60_000) return t;
        cache.delete(key);
      }
      const p = inner.getToken(scopes, options);
      cache.set(key, p);
      p.catch(() => cache.delete(key));
      return p;
    },
  };
}

interface Location {
  name: string;
  subscriptionId?: string;
  resourceGroup?: string;
}

/** Run a Resource Graph query, following pagination. */
export async function graphAll(
  graph: ResourceGraphClient,
  query: string,
  subscriptions: string[],
): Promise<Array<Record<string, string>>> {
  const rows: Array<Record<string, string>> = [];
  let skip = 0;
  for (;;) {
    const req = subscriptions.length ? { subscriptions, query } : { query };
    const res = await graph.resources({ ...req, options: { resultFormat: 'objectArray', top: 1000, skip } });
    const batch = (Array.isArray(res.data) ? res.data : []) as Array<Record<string, string>>;
    rows.push(...batch);
    if (batch.length < 1000) break;
    skip += 1000;
  }
  return rows;
}

/** Auto-discover storage accounts whose name ends with the configured suffix. */
async function discoverLocations(cred: TokenCredential, cfg: AppConfig): Promise<Location[]> {
  const graph = new ResourceGraphClient(cred);
  const query =
    `resources ` +
    `| where type =~ 'microsoft.storage/storageAccounts' and name endswith ${kqlString(safeNameFragment(cfg.discoverSuffix, 'DISCOVER_SUFFIX'))} ` +
    `| project name, subscriptionId, resourceGroup`;
  const rows = await graphAll(graph, query, cfg.scopeSubscriptions);
  return rows
    .map((r) => ({ name: r.name!, subscriptionId: r.subscriptionId, resourceGroup: r.resourceGroup }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** subscriptionId (lower-case) -> display name. */
async function fetchSubscriptionNames(cred: TokenCredential, cfg: AppConfig): Promise<Map<string, string>> {
  const graph = new ResourceGraphClient(cred);
  const rows = await graphAll(
    graph,
    `resourcecontainers | where type =~ 'microsoft.resources/subscriptions' | project subscriptionId, name`,
    cfg.scopeSubscriptions,
  );
  return new Map(rows.map((r) => [r.subscriptionId!.toLowerCase(), r.name!]));
}

/** Auto-discover bot storage accounts (name prefix, e.g. "botstorage"). */
async function discoverBotLocations(cred: TokenCredential, cfg: AppConfig): Promise<Location[]> {
  const graph = new ResourceGraphClient(cred);
  const query =
    `resources ` +
    `| where type =~ 'microsoft.storage/storageAccounts' and name startswith ${kqlString(safeNameFragment(cfg.botPrefix, 'BOT_ACCOUNT_PREFIX'))} ` +
    `| project name, subscriptionId, resourceGroup`;
  const rows = await graphAll(graph, query, cfg.scopeSubscriptions);
  return rows.map((r) => ({ name: r.name!, subscriptionId: r.subscriptionId, resourceGroup: r.resourceGroup }));
}

/**
 * Tenant/region key shared by an SRD account and its bot storage:
 * "adcprdntx-uaen-grp-srd-01" and "adcprdntx-uaen-grp-rec-02" both -> "adcprdntx-uaen".
 */
export function groupKey(resourceGroup?: string): string | null {
  const m = /^(.+)-grp-(?:srd|rec)-\d+$/i.exec(resourceGroup ?? '');
  // Some tenants are spelled "ntrx" in one resource group and "ntx" in another (dbprdntx-gewc vs dbprdntrx-gewc).
  return m ? m[1]!.toLowerCase().replace(/ntrx|ntx|ntr(?=-)/, 'nt') : null;
}

/** Resolve subscription + resource group for an explicit list of account names. */
async function resolveNamedLocations(cred: TokenCredential, names: string[]): Promise<Location[]> {
  const graph = new ResourceGraphClient(cred);
  const list = names.map((n) => kqlString(n)).join(',');
  const query =
    `resources ` +
    `| where type =~ 'microsoft.storage/storageAccounts' and name in (${list}) ` +
    `| project name, subscriptionId, resourceGroup`;
  const rows = await graphAll(graph, query, []);
  const found = new Map(rows.map((r) => [r.name, r]));
  return names.map((name) => {
    const r = found.get(name);
    return { name, subscriptionId: r?.subscriptionId, resourceGroup: r?.resourceGroup };
  });
}

/** Read the first account key at runtime (management-plane listKeys). */
async function fetchAccountKey(cred: TokenCredential, loc: Required<Location>): Promise<string> {
  const mgmt = new StorageManagementClient(cred, loc.subscriptionId);
  const result = await mgmt.storageAccounts.listKeys(loc.resourceGroup, loc.name);
  const key = result.keys?.[0]?.value;
  if (!key) throw new Error('listKeys returned no usable key for this account.');
  return key;
}

function erroredClient(accountName: string, message: string): AccountClient {
  return {
    accountName,
    auth: 'runtime-key',
    getArchiveContainer: () => {
      throw new Error(message);
    },
  };
}

/** Run an async fn over items with bounded concurrency. */
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

/**
 * Find the bot storage accounts that belong with each SRD account (same resource-group
 * prefix) and hang their audio-video containers off the SRD client. Failures here never
 * affect the archive check — they surface as an error on the bot result instead.
 */
async function attachBotTargets(
  cred: TokenCredential,
  cfg: AppConfig,
  srdLocations: Location[],
): Promise<Map<string, BotTarget[]>> {
  const targetsByGroup = new Map<string, BotTarget[]>();
  let botLocs: Location[] = [];
  try {
    botLocs = await discoverBotLocations(cred, cfg);
  } catch (err) {
    console.error(`Bot storage discovery failed: ${friendlyError(err)}`);
    return targetsByGroup;
  }

  const wanted = new Set(srdLocations.map((l) => groupKey(l.resourceGroup)).filter((k): k is string => !!k));
  await pMap(
    botLocs.filter((b) => {
      const k = groupKey(b.resourceGroup);
      return k && wanted.has(k) && b.subscriptionId && b.resourceGroup;
    }),
    KEY_CONCURRENCY,
    async (loc) => {
      let target: BotTarget;
      try {
        const key = await fetchAccountKey(cred, loc as Required<Location>);
        const service = new BlobServiceClient(
          `https://${loc.name}.blob.core.windows.net`,
          new StorageSharedKeyCredential(loc.name, key),
        );
        target = { accountName: loc.name, getContainer: () => service.getContainerClient(cfg.botContainer) };
      } catch (err) {
        const message = friendlyError(err);
        target = {
          accountName: loc.name,
          getContainer: () => {
            throw new Error(message);
          },
        };
      }
      const k = groupKey(loc.resourceGroup)!;
      targetsByGroup.set(k, [...(targetsByGroup.get(k) ?? []), target]);
    },
  );

  return targetsByGroup;
}

/**
 * Build a queryable client per account. Accounts come from (in order):
 *   1. Auto-discovery (STORAGE_DISCOVER=true) â€” all "*<suffix>" accounts.
 *   2. Explicit STORAGE_ACCOUNTS names.
 *   3. STORAGE_CONN_* connection strings (fallback; keys on disk).
 * (1) and (2) read keys at runtime via your identity â€” nothing stored on disk.
 */
export async function buildAccountClients(cfg: AppConfig): Promise<AccountClient[]> {
  const byName = new Map<string, AccountClient>();

  if (cfg.discover || cfg.identityAccounts.length > 0) {
    const cred = mgmtCredential();
    const t0 = Date.now();
    const lap = (what: string) => console.log(`[startup] ${what} +${((Date.now() - t0) / 1000).toFixed(1)}s`);
    let locations: Location[] = [];
    try {
      locations = cfg.discover
        ? await discoverLocations(cred, cfg)
        : await resolveNamedLocations(cred, cfg.identityAccounts);
    } catch (err) {
      const msg = `Account discovery failed: ${friendlyError(err)}`;
      console.error(msg);
      for (const name of cfg.identityAccounts) byName.set(name, erroredClient(name, msg));
    }

    lap(`discovered ${locations.length} SRD accounts`);
    // Bot-storage discovery + key fetches run alongside the SRD key fetches.
    const botPromise = cfg.botPrefix ? attachBotTargets(cred, cfg, locations) : Promise.resolve(null);
    // Subscription names, so the dashboard can group accounts by customer subscription.
    const namesPromise = fetchSubscriptionNames(cred, cfg).catch(() => new Map<string, string>());
    await pMap(locations, KEY_CONCURRENCY, async (loc) => {
      if (byName.has(loc.name)) return;
      if (!loc.subscriptionId || !loc.resourceGroup) {
        byName.set(loc.name, erroredClient(loc.name, 'Account not found in any subscription you can access.'));
        return;
      }
      try {
        const key = await fetchAccountKey(cred, loc as Required<Location>);
        const shared = new StorageSharedKeyCredential(loc.name, key);
        const service = new BlobServiceClient(`https://${loc.name}.blob.core.windows.net`, shared);
        byName.set(loc.name, {
          accountName: loc.name,
          auth: 'runtime-key',
          getArchiveContainer: () => service.getContainerClient(cfg.container),
        });
      } catch (err) {
        byName.set(loc.name, erroredClient(loc.name, friendlyError(err)));
      }
    });

    lap('SRD keys done');
    const subNames = await namesPromise;
    for (const loc of locations) {
      const client = byName.get(loc.name);
      if (client && loc.subscriptionId) {
        client.subscriptionId = loc.subscriptionId;
        client.subscription = subNames.get(loc.subscriptionId.toLowerCase()) ?? loc.subscriptionId;
      }
    }
    const botTargets = await botPromise;
    lap('bot keys done');
    if (botTargets) {
      for (const loc of locations) {
        const client = byName.get(loc.name);
        const k = groupKey(loc.resourceGroup);
        if (client && k) {
          client.botTargets = (botTargets.get(k) ?? []).sort((a, b) => a.accountName.localeCompare(b.accountName));
        }
      }
    }
  }

  for (const conn of cfg.connectionStrings) {
    const accountName = /AccountName=([^;]+)/i.exec(conn)?.[1] ?? 'unknown';
    if (byName.has(accountName)) continue;
    const service = BlobServiceClient.fromConnectionString(conn);
    byName.set(accountName, {
      accountName,
      auth: 'connection-string',
      getArchiveContainer: () => service.getContainerClient(cfg.container),
    });
  }

  return [...byName.values()].sort((a, b) => a.accountName.localeCompare(b.accountName));
}
