import type { ContainerClient } from '@azure/storage-blob';
import { checkBotStorage } from './bot.js';
import type { BotOptions, BotScanCache } from './bot.js';
import type { AccountClient, CaptureFolder, CheckResult, Status } from './types.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RECENT_CAP = 7;

/** This host's public egress IP, filled in at startup — shown in firewall errors. */
let egressIp: string | null = null;
export function setEgressIp(ip: string | null): void {
  egressIp = ip;
}

/** Local date as YYYY-MM-DD (matches how archive folders are named). */
export function todayStr(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Pure summary of the check — no Azure involved, so it is trivially unit-testable.
 * Input: for each capture folder, the raw list of date-folder names found under it.
 */
export function summarize(
  captures: { name: string; dates: string[] }[],
  today: string,
): { captureFolders: CaptureFolder[]; status: Status; capturesWithToday: number } {
  const captureFolders: CaptureFolder[] = captures.map(({ name, dates }) => {
    const valid = dates.filter((d) => DATE_RE.test(d)).sort((a, b) => b.localeCompare(a));
    return {
      name,
      todayExists: valid.includes(today),
      latestDate: valid[0] ?? null,
      recentDates: valid.slice(0, RECENT_CAP),
    };
  });

  const capturesWithToday = captureFolders.filter((c) => c.todayExists).length;

  let status: Status;
  if (captureFolders.length === 0) status = 'no_data';
  else if (capturesWithToday > 0) status = 'healthy';
  else status = 'missing_today';

  return { captureFolders, status, capturesWithToday };
}

/** List immediate virtual subdirectories under `prefix` inside a container. */
async function listSubfolders(
  container: ContainerClient,
  prefix: string,
  abortSignal?: AbortSignal,
): Promise<string[]> {
  const folders: string[] = [];
  for await (const item of container.listBlobsByHierarchy('/', { prefix, abortSignal })) {
    if (item.kind === 'prefix') {
      const name = item.name.slice(prefix.length).replace(/\/$/, '');
      if (name) folders.push(name);
    }
  }
  return folders;
}

/** Turn a raw Azure error into something an operator can act on. */
export function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const name = (err as { name?: string })?.name ?? '';
  const code = (err as { code?: string })?.code ?? '';
  const hay = `${msg} ${name} ${code}`;

  if (/AbortError|TimeoutError|aborted/.test(hay))
    return "Timed out — no response in time. The account likely has public network access disabled or is unreachable from this network (run from the corporate VPN or in Azure).";
  if (/KeyBasedAuthenticationNotPermitted/.test(hay))
    return 'Shared-key auth is disabled on this account — use keyless access (`az login` / managed identity).';
  if (/AuthorizationPermissionMismatch/.test(hay))
    return "Signed in, but no data access — the identity needs the 'Storage Blob Data Reader' role on this account.";
  if (/AuthorizationFailure/.test(hay))
    return (
      `Blocked by the storage account's firewall — this machine's IP` +
      `${egressIp ? ` (${egressIp})` : ''} isn't allowlisted. ` +
      `Run the monitor from the corporate network/VPN or in Azure, or have an admin add the IP under the account's Networking settings.`
    );
  if (/AuthenticationFailed|401|InvalidAuthenticationInfo/.test(hay))
    return 'Authentication failed — the account key is wrong/expired, or run `az login` for keyless.';
  if (/credential|DefaultAzureCredential|CredentialUnavailable/.test(hay))
    return 'No Azure credential found — run `az login`, or assign a managed identity.';
  if (/Forbidden|\b403\b/.test(hay)) return 'Access denied (403) by the storage account.';
  if (/ContainerNotFound|The specified container does not exist/.test(hay))
    return "No 'archive' container found on this account.";
  if (/ENOTFOUND|getaddrinfo|ETIMEDOUT|ECONNREFUSED/.test(hay))
    return 'Network error reaching the storage account.';
  if (/<!DOCTYPE html|<html/i.test(msg))
    return 'Unexpected HTML response — a proxy or firewall is likely intercepting requests to this account.';
  // Collapse any multi-line / oversized body into a single trimmed line.
  return msg.split('\n')[0]!.slice(0, 200);
}

/** Run the today-folder check for a single storage account. */
export async function checkAccount(
  client: AccountClient,
  today: string,
  timeoutMs = 15000,
  bot?: { options: BotOptions; cache: BotScanCache },
): Promise<CheckResult> {
  // Archive and bot-storage checks are independent — run them side by side.
  const [result, botResult] = await Promise.all([
    checkArchive(client, today, timeoutMs),
    bot && client.botTargets ? checkBotStorage(client.botTargets, bot.options, bot.cache) : undefined,
  ]);
  if (botResult) result.bot = botResult;
  return result;
}

async function checkArchive(client: AccountClient, today: string, timeoutMs: number): Promise<CheckResult> {
  const base = {
    accountName: client.accountName,
    auth: client.auth,
    today,
    subscriptionId: client.subscriptionId,
    subscription: client.subscription,
  };

  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const container = client.getArchiveContainer();
    const captureNames = await listSubfolders(container, '', signal);
    const captures = await Promise.all(
      captureNames.map(async (name) => ({
        name,
        dates: await listSubfolders(container, `${name}/`, signal),
      })),
    );

    const { captureFolders, status, capturesWithToday } = summarize(captures, today);
    return {
      ...base,
      status,
      capturesWithToday,
      capturesTotal: captureFolders.length,
      captureFolders,
      error: null,
    };
  } catch (err) {
    // "No archive container" isn't a failure — the location simply has no SRD.
    const code = (err as { code?: string })?.code ?? '';
    const msg = err instanceof Error ? err.message : String(err);
    const noContainer = /ContainerNotFound|The specified container does not exist/i.test(`${code} ${msg}`);
    return {
      ...base,
      status: noContainer ? 'no_data' : 'error',
      capturesWithToday: 0,
      capturesTotal: 0,
      captureFolders: [],
      error: noContainer ? null : friendlyError(err),
    };
  }
}
