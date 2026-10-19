import type { ContainerClient } from '@azure/storage-blob';

/** How we authenticated to a given storage account. */
export type AuthMode = 'runtime-key' | 'identity' | 'connection-string';

/** A resolved storage account we can query, plus how we got to it. */
export interface AccountClient {
  accountName: string;
  auth: AuthMode;
  /** Returns a client for the archive container (lazily, per request). */
  getArchiveContainer: () => ContainerClient;
  /** Bot storage accounts belonging to the same tenant/region (matched by resource-group prefix). */
  botTargets?: BotTarget[];
  /** Subscription the storage account lives in (from discovery), for the per-customer view. */
  subscriptionId?: string;
  subscription?: string;
}

/** One bot storage account's audio-video container (or why we couldn't reach it). */
export interface BotTarget {
  accountName: string;
  getContainer: () => ContainerClient;
}

export type Status =
  | 'healthy'          // at least one capture folder has today's date folder
  | 'missing_today'    // capture folders exist, but none has today's date folder
  | 'no_data'          // no capture folders at all
  | 'error';           // could not read the account (auth / network / missing container)

/** One "capture" folder sitting at the root of the archive container. */
export interface CaptureFolder {
  name: string;
  todayExists: boolean;
  latestDate: string | null;
  recentDates: string[]; // newest first, capped
}

export interface CheckResult {
  accountName: string;
  auth: AuthMode;
  status: Status;
  today: string;
  capturesWithToday: number;
  capturesTotal: number;
  captureFolders: CaptureFolder[];
  error: string | null;
  /** Subscription (customer) the account belongs to. */
  subscriptionId?: string;
  subscription?: string;
  /** Bot-storage leftovers check (independent of the archive status above). */
  bot?: BotStorageResult;
}

/** A blob inside a stuck interaction folder. */
export interface BotFile {
  name: string;
  sizeBytes: number;
  lastModified: string;
}

/** One interaction folder sitting in the bot storage `audio-video` container. */
export interface BotInteraction {
  id: string;
  fileCount: number;
  totalBytes: number;
  oldestModified: string | null;
  newestModified: string | null;
  /** True when nothing in the folder changed for longer than the stuck threshold. */
  stuck: boolean;
  /** Up to a handful of files, newest first. */
  files: BotFile[];
}

export interface BotAccountResult {
  accountName: string;
  status: 'clean' | 'stuck' | 'error';
  /** Interaction folders found (may exceed `interactions.length` when capped). */
  totalInteractions: number;
  /** Stuck interactions within the reporting window (these are the ones listed). */
  stuckCount: number;
  /** Stuck interactions older than the window — counted, not listed. */
  olderCount: number;
  /** True when the container was too large to read fully this scan. */
  truncated: boolean;
  interactions: BotInteraction[];
  error: string | null;
}

export interface BotStorageResult {
  /** none = no bot storage account matched this SRD location. */
  status: 'none' | 'clean' | 'stuck' | 'error';
  stuckCount: number;
  olderCount: number;
  container: string;
  stuckAfterMinutes: number;
  /** Only stuck interactions from the last N days are listed. */
  windowDays: number;
  accounts: BotAccountResult[];
}

export interface CheckResponse {
  today: string;
  generatedAt: string;
  container: string;
  results: CheckResult[];
  /** True while the first background scan is still running. */
  warming?: boolean;
  /** This host's public egress IP — the address Azure firewalls see. */
  egressIp?: string | null;
  /** True when the date is overridden for testing (not the live "today"). */
  dateOverride?: boolean;
}

/** What kind of archive file a blob is, inferred from its extension. */
export type FileKind = 'chat' | 'media' | 'other';

/** One blob inside a capture's date folder. */
export interface ArchiveFile {
  /** File name only (no capture/date prefix). */
  name: string;
  kind: FileKind;
  sizeBytes: number;
  /** ISO timestamp of the blob's last modification. */
  lastModified: string;
}

/** Latest files inside `archive/{capture}/{date}/` for one account. */
export interface FilesResponse {
  accountName: string;
  capture: string;
  date: string;
  generatedAt: string;
  /** True when served from the short-lived cache rather than a live listing. */
  cached: boolean;
  /** Total blobs seen in the folder, by kind. */
  totals: Record<FileKind, number>;
  /** Newest-first, capped (default 5 each). */
  chat: ArchiveFile[];
  media: ArchiveFile[];
  other: ArchiveFile[];
}

// ------------------------------------------------------------------ bot instances + SQL databases (on demand)

/** One cloud service (bot) with how many of its role instances are Started. */
export interface InfraCloudService {
  subscriptionId: string;
  subscription: string;
  resourceGroup: string;
  name: string;
  running: number;
  total: number;
  /** ISO time of the last instance check; null = listed but never checked. */
  checkedAt: string | null;
  /** Set when the role instances could not be listed. */
  error: string | null;
}

/** One cloud service role instance and its state (Started / Starting / Stopped / Unknown ...). */
export interface InfraInstance {
  subscriptionId: string;
  subscription: string;
  resourceGroup: string;
  cloudService: string;
  instance: string;
  status: string;
}

/** One SQL database: status, latest long-term-retention backup, storage used vs max size. */
export interface InfraDatabase {
  subscriptionId: string;
  subscription: string;
  resourceGroup: string;
  server: string;
  location: string;
  name: string;
  status: string;
  /** Max size from the resource inventory (known before any check). */
  totalGB: number;
  /** Service tier from the inventory (Basic / Standard / Premium = DTU model; GeneralPurpose etc. = vCore). */
  tier: string;
  /** True for DTU-model databases — only these report DTU utilization. */
  isDtu: boolean;
  /** ISO time of the last storage/backup check; null = listed but never checked. */
  checkedAt: string | null;
  /** ISO time of the newest LTR backup, or null when none exists. */
  latestBackup: string | null;
  /** False when the backup listing failed or was never run, so "no backup" can't be asserted. */
  backupChecked: boolean;
  /** null until checked. */
  usedGB: number | null;
  /** null = N/A (not checked, no metric data, or no max size). */
  usedPct: number | null;
  /** Current DTU utilization (%): the latest one-minute reading; null = not checked / vCore / no data. */
  dtuPct: number | null;
  /** ISO time of that reading (Azure Monitor lags a minute or two). */
  dtuAt: string | null;
}

export interface BotsResponse {
  generatedAt: string;
  cloudServices: InfraCloudService[];
  instances: InfraInstance[];
}

export interface DatabasesResponse {
  generatedAt: string;
  storageThreshold: number;
  warnThreshold: number;
  /** DTU utilization (%) above which a database is flagged. */
  dtuThreshold: number;
  /** How far back the latest DTU reading is looked for (minutes). */
  dtuLookbackMinutes: number;
  databases: InfraDatabase[];
}
