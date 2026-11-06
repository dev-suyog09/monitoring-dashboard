import type { ContainerClient } from '@azure/storage-blob';
import type { ShareClient } from '@azure/storage-file-share';
import type { ArchiveFile, FileKind } from './types.js';

export const LATEST_CAP = 5;

/** Media = recordings (.mp3 primarily; other audio/video kept for completeness). */
const MEDIA_EXT = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'wma', 'flac', 'mp4', 'webm', 'mkv', 'avi', 'mov']);
/** Chat = .chat transcripts only. The sibling .json files are metadata, not chat. */
const CHAT_EXT = new Set(['chat']);
const HEX = '0123456789abcdef'.split('');

/** Classify a blob by extension: .chat → chat, .mp3/audio/video → media, anything else (e.g. .json metadata) → other. */
export function classifyFile(name: string): FileKind {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (MEDIA_EXT.has(ext)) return 'media';
  if (CHAT_EXT.has(ext)) return 'chat';
  return 'other';
}

/** Bounded "top N newest" buffer so we never hold the whole folder in memory. */
class TopN {
  private items: ArchiveFile[] = [];
  constructor(private readonly n: number) {}
  push(f: ArchiveFile): void {
    const last = this.items[this.items.length - 1];
    if (this.items.length >= this.n && last && f.lastModified <= last.lastModified) return;
    this.items.push(f);
    this.items.sort((a, b) => b.lastModified.localeCompare(a.lastModified) || a.name.localeCompare(b.name));
    if (this.items.length > this.n) this.items.length = this.n;
  }
  get(): ArchiveFile[] {
    return [...this.items];
  }
}

export interface LatestFiles {
  /** True when only the newest part of the day was read (a share day holds many time folders). */
  partial?: boolean;
  totals: Record<FileKind, number>;
  chat: ArchiveFile[];
  media: ArchiveFile[];
  other: ArchiveFile[];
}

/**
 * Pure reducer: given every file in a folder, return the newest `cap` of each
 * kind plus per-kind totals. Exported so it can be unit-tested without Azure.
 */
export function pickLatest(files: Iterable<ArchiveFile>, cap = LATEST_CAP): LatestFiles {
  const totals: Record<FileKind, number> = { chat: 0, media: 0, other: 0 };
  const top: Record<FileKind, TopN> = { chat: new TopN(cap), media: new TopN(cap), other: new TopN(cap) };
  for (const f of files) {
    totals[f.kind]++;
    top[f.kind].push(f);
  }
  return { totals, chat: top.chat.get(), media: top.media.get(), other: top.other.get() };
}

async function* listPrefix(
  container: ContainerClient,
  prefix: string,
  folderPrefix: string,
  abortSignal?: AbortSignal,
): AsyncGenerator<ArchiveFile> {
  for await (const page of container.listBlobsFlat({ prefix, abortSignal }).byPage({ maxPageSize: 5000 })) {
    for (const b of page.segment.blobItems) {
      const name = b.name.slice(folderPrefix.length);
      if (!name || name.includes('/')) continue; // only direct children
      yield {
        name,
        kind: classifyFile(name),
        sizeBytes: b.properties.contentLength ?? 0,
        lastModified: (b.properties.lastModified ?? new Date(0)).toISOString(),
      };
    }
  }
}

/**
 * List the newest files directly under `archive/{capture}/{date}/`.
 *
 * A single day can hold tens of thousands of blobs and Azure returns them in
 * name order only, so a plain listing takes ~25s. File names are GUIDs, so we
 * fan out 16 listings (one per leading hex digit) in parallel. If that finds
 * nothing (non-GUID naming), fall back to one sequential listing.
 */
export async function listLatestFiles(
  container: ContainerClient,
  capture: string,
  date: string,
  abortSignal?: AbortSignal,
  cap = LATEST_CAP,
): Promise<LatestFiles> {
  const folder = `${capture}/${date}/`;

  const partial = await Promise.all(
    HEX.map(async (h) => {
      const files: ArchiveFile[] = [];
      for await (const f of listPrefix(container, folder + h, folder, abortSignal)) files.push(f);
      return files;
    }),
  );
  let all = partial.flat();

  if (all.length === 0) {
    all = [];
    for await (const f of listPrefix(container, folder, folder, abortSignal)) all.push(f);
  }

  return pickLatest(all, cap);
}

/** On a file share a day is split into HH_MM time folders; this many of the newest are read per request. */
export const SHARE_TIME_FOLDERS = 60;
const SHARE_CONCURRENCY = 8;

/**
 * Latest files for a day on a classic file share: `{capture}/{date}/{HH_MM}/{guid}.json|.mp4`.
 * Reads the newest time folders (and any files sitting directly in the date folder); when the day has
 * more time folders than that, the result is flagged `partial` so the totals read as "at least".
 */
export async function listLatestFilesShare(
  share: ShareClient,
  capture: string,
  date: string,
  abortSignal?: AbortSignal,
  cap = LATEST_CAP,
): Promise<LatestFiles> {
  const dir = share.getDirectoryClient(`${capture}/${date}`);
  const direct: ArchiveFile[] = [];
  const timeFolders: string[] = [];
  for await (const item of dir.listFilesAndDirectories({ abortSignal })) {
    if (item.kind === 'directory') timeFolders.push(item.name);
    else direct.push(toArchiveFile(item.name, item.properties.contentLength, item.properties.lastWriteTime ?? item.properties.lastModified));
  }
  timeFolders.sort((a, b) => b.localeCompare(a));
  const wanted = timeFolders.slice(0, SHARE_TIME_FOLDERS);

  const all: ArchiveFile[] = [...direct];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(SHARE_CONCURRENCY, wanted.length) }, async () => {
      while (i < wanted.length) {
        const folder = wanted[i++]!;
        const sub = dir.getDirectoryClient(folder);
        for await (const item of sub.listFilesAndDirectories({ abortSignal, includeTimestamps: true })) {
          if (item.kind === 'file') all.push(toArchiveFile(item.name, item.properties.contentLength, item.properties.lastWriteTime ?? item.properties.lastModified));
        }
      }
    }),
  );
  return { ...pickLatest(all, cap), ...(timeFolders.length > wanted.length ? { partial: true } : {}) };
}

function toArchiveFile(name: string, size: number | undefined, modified: Date | undefined): ArchiveFile {
  return { name, kind: classifyFile(name), sizeBytes: size ?? 0, lastModified: (modified ?? new Date(0)).toISOString() };
}
