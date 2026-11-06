import type { ContainerClient } from '@azure/storage-blob';
import type { ShareClient } from '@azure/storage-file-share';
import { checkBotStorage } from './bot.js';
import type { BotOptions, BotScanCache } from './bot.js';
import type { AccountClient, ArchiveSource, CaptureFolder, CheckResult, Status } from './types.js';

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
  captures: { name: string; dates: string[]; source?: ArchiveSource }[],
  today: string,
): { captureFolders: CaptureFolder[]; status: Status; capturesWithToday: number } {
  const captureFolders: CaptureFolder[] = captures.map(({ name, dates, source }) => {
    const valid = dates.filter((d) => DATE_RE.test(d)).sort((a, b) => b.localeCompare(a));
    return {
      name,
      ...(source ? { source } : {}),
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

/**
 * Merge what the blob container and the file share each found: one entry per capture name,
 * with the union of its date folders and a note of which storage(s) it came from.
 */
export function mergeCaptures(
  blob: { name: string; dates: string[] }[],
  share: { name: string; dates: string[] }[],
): { name: string; dates: string[]; source: ArchiveSource }[] {
  const merged = new Map<string, { dates: Set<string>; blob: boolean; share: boolean }>();
  const add = (list: { name: string; dates: string[] }[], where: 'blob' | 'share') => {
    for (const { name, dates } of list) {
      const m = merged.get(name) ?? { dates: new Set<string>(), blob: false, share: false };
      for (const d of dates) m.dates.add(d);
      m[where] = true;
      merged.set(name, m);
    }
  };
  add(blob, 'blob');
  add(share, 'share');
  return [...merged.entries()]
    .map(([name, m]) => ({
      name,
      dates: [...m.dates],
      source: (m.blob && m.share ? 'both' : m.share ? 'file-share' : 'blob') as ArchiveSource,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The overall source of an account's archive, from its capture folders. */
export function overallSource(captures: { source?: ArchiveSource }[]): ArchiveSource | undefined {
  const blob = captures.some((c) => c.source === 'blob' || c.source === 'both');
  const share = captures.some((c) => c.source === 'file-share' || c.source === 'both');
  return blob && share ? 'both' : share ? 'file-share' : blob ? 'blob' : undefined;
}

/** List the immediate sub-directories of `dir` (a path inside the share; '' = its root). */
async function listShareFolders(share: ShareClient, dir: string, abortSignal?: AbortSignal): Promise<string[]> {
  const folders: string[] = [];
  for await (const item of share.getDirectoryClient(dir).listFilesAndDirectories({ abortSignal })) {
    if (item.kind === 'directory') folders.push(item.name);
  }
  return folders;
}

/** Same capture → date-folder walk as the blob container, on a classic file share. */
async function readShareCaptures(share: ShareClient, signal: AbortSignal): Promise<{ name: string; dates: string[] }[]> {
  const captureNames = await listShareFolders(share, '', signal);
  return Promise.all(captureNames.map(async (name) => ({ name, dates: await listShareFolders(share, name, signal) })));
}

/** Read the blob container's capture folders. */
async function readBlobCaptures(container: ContainerClient, signal: AbortSignal): Promise<{ name: string; dates: string[] }[]> {
  const captureNames = await listSubfolders(container, '', signal);
  return Promise.all(captureNames.map(async (name) => ({ name, dates: await listSubfolders(container, `${name}/`, signal) })));
}

/** True when the error only means "this container / share does not exist" (nothing archived there). */
export function isNotFound(err: unknown): boolean {
  const code = (err as { code?: string })?.code ?? '';
  const msg = err instanceof Error ? err.message : String(err);
  return /ContainerNotFound|ShareNotFound|ResourceNotFound|The specified (container|share) does not exist/i.test(`${code} ${msg}`);
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
  if (/ShareNotFound|The specified share does not exist/.test(hay))
    return "No 'archive' file share found on this account.";
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
  // Archived calls can sit in the blob container or in a classic file share; read both side by side.
  const [blob, share] = await Promise.allSettled([
    Promise.resolve().then(() => readBlobCaptures(client.getArchiveContainer(), signal)),
    client.getArchiveShare ? Promise.resolve().then(() => readShareCaptures(client.getArchiveShare!(), signal)) : Promise.resolve([]),
  ]);

  // A missing container / share is not a failure: the account simply has no archive in that place.
  const found = (r: PromiseSettledResult<{ name: string; dates: string[] }[]>) => (r.status === 'fulfilled' ? r.value : []);
  const failure = [blob, share].find((r): r is PromiseRejectedResult => r.status === 'rejected' && !isNotFound(r.reason));

  const captures = mergeCaptures(found(blob), found(share));
  const { captureFolders, status, capturesWithToday } = summarize(captures, today);

  // One place unreadable (firewall, permissions, timeout) and nothing found today in the other:
  // "missing" cannot be asserted, so report the error instead of a misleading status.
  if (failure && capturesWithToday === 0) {
    return { ...base, status: 'error', capturesWithToday: 0, capturesTotal: 0, captureFolders: [], error: friendlyError(failure.reason) };
  }
  return {
    ...base,
    status,
    capturesWithToday,
    capturesTotal: captureFolders.length,
    captureFolders,
    error: null,
    ...(overallSource(captureFolders) ? { source: overallSource(captureFolders) } : {}),
  };
}
