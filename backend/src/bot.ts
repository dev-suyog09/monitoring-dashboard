import type { BotAccountResult, BotInteraction, BotStorageResult, BotTarget } from './types.js';
import { friendlyError } from './checker.js';

const FILES_PER_INTERACTION = 5;
/**
 * Stuck interactions listed per bot account in the answer. The count is always the true one; only the list is capped, newest first.
 * Without a cap one account with a thousand stuck interactions made every page load download over a megabyte.
 */
export const MAX_LISTED_INTERACTIONS = 50;
export const listed = (all: BotInteraction[]): BotInteraction[] => all.slice(0, MAX_LISTED_INTERACTIONS);
/** Safety cap on blobs read from one bot account per scan (a healthy one holds ~none). */
const MAX_BLOBS = 40_000;

export interface BotBlob {
  /** Full blob name, `{interactionId}/{file}`. */
  name: string;
  sizeBytes: number;
  lastModified: string;
}

export interface BotOptions {
  container: string;
  /** Untouched for longer than this = stuck (shorter = still being processed). */
  stuckMs: number;
  /** Only stuck interactions newer than this are reported; older ones are just counted. */
  windowMs: number;
  stuckMinutes: number;
  windowDays: number;
  timeoutMs: number;
}

/** Pure: a folder is stuck once its newest blob is older than the threshold. */
export function isStuck(newestModified: string | null, nowMs: number, stuckMs: number): boolean {
  if (!newestModified) return false; // no data left behind
  return nowMs - new Date(newestModified).getTime() > stuckMs;
}

/**
 * Pure: group blobs by interaction folder and split them into
 *  - stuck within the window (returned, newest first),
 *  - older than the window (counted only),
 *  - still in progress (ignored).
 */
export function groupBlobs(
  blobs: Iterable<BotBlob>,
  nowMs: number,
  stuckMs: number,
  windowMs: number,
): { interactions: BotInteraction[]; totalInteractions: number; olderCount: number } {
  const byId = new Map<string, BotBlob[]>();
  for (const b of blobs) {
    const slash = b.name.indexOf('/');
    if (slash <= 0) continue; // root-level blob, not an interaction folder
    const id = b.name.slice(0, slash);
    const list = byId.get(id);
    if (list) list.push({ ...b, name: b.name.slice(slash + 1) });
    else byId.set(id, [{ ...b, name: b.name.slice(slash + 1) }]);
  }

  const interactions: BotInteraction[] = [];
  let olderCount = 0;
  for (const [id, files] of byId) {
    files.sort((a, b) => b.lastModified.localeCompare(a.lastModified));
    const newest = files[0]!.lastModified;
    if (!isStuck(newest, nowMs, stuckMs)) continue;
    if (nowMs - new Date(newest).getTime() > windowMs) {
      olderCount++;
      continue;
    }
    interactions.push({
      id,
      fileCount: files.length,
      totalBytes: files.reduce((n, f) => n + f.sizeBytes, 0),
      oldestModified: files[files.length - 1]!.lastModified,
      newestModified: newest,
      stuck: true,
      files: files.slice(0, FILES_PER_INTERACTION),
    });
  }
  interactions.sort((a, b) => (b.newestModified ?? '').localeCompare(a.newestModified ?? ''));
  return { interactions, totalInteractions: byId.size, olderCount };
}

/** Pure: roll account results up into the per-SRD-location summary. */
export function summarizeBot(
  accounts: BotAccountResult[],
  opts: Pick<BotOptions, 'container' | 'stuckMinutes' | 'windowDays'>,
): BotStorageResult {
  const stuckCount = accounts.reduce((n, a) => n + a.stuckCount, 0);
  const olderCount = accounts.reduce((n, a) => n + a.olderCount, 0);
  let status: BotStorageResult['status'];
  if (accounts.length === 0) status = 'none';
  else if (stuckCount > 0) status = 'stuck';
  else if (accounts.some((a) => a.status === 'error')) status = 'error';
  else status = 'clean';
  return {
    status,
    stuckCount,
    olderCount,
    container: opts.container,
    stuckAfterMinutes: opts.stuckMinutes,
    windowDays: opts.windowDays,
    accounts,
  };
}

/** One flat listing of the whole container (a few big pages) instead of one request per folder. */
async function checkBotAccount(target: BotTarget, o: BotOptions): Promise<BotAccountResult> {
  const base = { accountName: target.accountName };
  const signal = AbortSignal.timeout(o.timeoutMs);
  try {
    const container = target.getContainer();
    const blobs: BotBlob[] = [];
    let truncated = false;
    outer: for await (const page of container.listBlobsFlat({ abortSignal: signal }).byPage({ maxPageSize: 1000 })) {
      for (const b of page.segment.blobItems) {
        blobs.push({
          name: b.name,
          sizeBytes: b.properties.contentLength ?? 0,
          lastModified: (b.properties.lastModified ?? new Date(0)).toISOString(),
        });
        if (blobs.length >= MAX_BLOBS) {
          truncated = true;
          break outer;
        }
      }
    }
    const { interactions, totalInteractions, olderCount } = groupBlobs(blobs, Date.now(), o.stuckMs, o.windowMs);
    return {
      ...base,
      status: interactions.length > 0 ? 'stuck' : 'clean',
      totalInteractions,
      stuckCount: interactions.length,
      olderCount,
      truncated,
      interactions: listed(interactions),
      error: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string })?.code ?? '';
    const empty = { totalInteractions: 0, stuckCount: 0, olderCount: 0, truncated: false, interactions: [] };
    // No container means nothing is stuck.
    if (/ContainerNotFound|The specified container does not exist/i.test(`${code} ${msg}`)) {
      return { ...base, ...empty, status: 'clean', error: null };
    }
    return { ...base, ...empty, status: 'error', error: friendlyError(err) };
  }
}

/** Per-scan memo: several SRD accounts can share a bot account, so it is listed once per scan. */
export type BotScanCache = Map<string, Promise<BotAccountResult>>;

/** Check every bot storage account tied to one SRD location (accounts run in parallel). */
export async function checkBotStorage(
  targets: BotTarget[],
  o: BotOptions,
  cache: BotScanCache = new Map(),
): Promise<BotStorageResult> {
  const accounts = await Promise.all(
    targets.map((t) => {
      let p = cache.get(t.accountName);
      if (!p) {
        p = checkBotAccount(t, o);
        cache.set(t.accountName, p);
      }
      return p;
    }),
  );
  return summarizeBot(accounts, o);
}
