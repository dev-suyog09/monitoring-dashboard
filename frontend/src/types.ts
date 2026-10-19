export type AuthMode = 'runtime-key' | 'identity' | 'connection-string';
export type Status = 'healthy' | 'missing_today' | 'no_data' | 'error';

export interface CaptureFolder {
  name: string;
  todayExists: boolean;
  latestDate: string | null;
  recentDates: string[];
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
  bot?: BotStorageResult;
}

export interface BotFile {
  name: string;
  sizeBytes: number;
  lastModified: string;
}

export interface BotInteraction {
  id: string;
  fileCount: number;
  totalBytes: number;
  oldestModified: string | null;
  newestModified: string | null;
  stuck: boolean;
  files: BotFile[];
}

export interface BotAccountResult {
  accountName: string;
  status: 'clean' | 'stuck' | 'error';
  totalInteractions: number;
  stuckCount: number;
  olderCount: number;
  truncated: boolean;
  interactions: BotInteraction[];
  error: string | null;
}

export interface BotStorageResult {
  status: 'none' | 'clean' | 'stuck' | 'error';
  stuckCount: number;
  olderCount: number;
  container: string;
  stuckAfterMinutes: number;
  windowDays: number;
  accounts: BotAccountResult[];
}

export interface CheckResponse {
  today: string;
  generatedAt: string;
  container: string;
  results: CheckResult[];
  warming?: boolean;
  egressIp?: string | null;
  dateOverride?: boolean;
}

export type FileKind = 'chat' | 'media' | 'other';

export interface ArchiveFile {
  name: string;
  kind: FileKind;
  sizeBytes: number;
  lastModified: string;
}

export interface FilesResponse {
  accountName: string;
  capture: string;
  date: string;
  generatedAt: string;
  cached: boolean;
  totals: Record<FileKind, number>;
  chat: ArchiveFile[];
  media: ArchiveFile[];
  other: ArchiveFile[];
}

// ---- bot instances + SQL databases (on demand) ----
export interface InfraCloudService {
  subscriptionId: string;
  subscription: string;
  resourceGroup: string;
  name: string;
  running: number;
  total: number;
  /** null = listed but never checked. */
  checkedAt: string | null;
  error: string | null;
}

export interface InfraInstance {
  subscriptionId: string;
  subscription: string;
  resourceGroup: string;
  cloudService: string;
  instance: string;
  status: string;
}

export interface InfraDatabase {
  subscriptionId: string;
  subscription: string;
  resourceGroup: string;
  server: string;
  location: string;
  name: string;
  status: string;
  totalGB: number;
  tier: string;
  /** True for DTU-model databases — only these report DTU utilization. */
  isDtu: boolean;
  /** null = listed but never checked. */
  checkedAt: string | null;
  latestBackup: string | null;
  backupChecked: boolean;
  usedGB: number | null;
  usedPct: number | null;
  /** Current DTU utilization (%): the latest one-minute reading; null = not checked / vCore / no data. */
  dtuPct: number | null;
  /** ISO time of that reading. */
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
  dtuThreshold: number;
  dtuLookbackMinutes: number;
  databases: InfraDatabase[];
}
