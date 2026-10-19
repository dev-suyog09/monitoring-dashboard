/**
 * App configuration, read once from the environment.
 *
 * Two ways to point the app at storage accounts:
 *   1. STORAGE_ACCOUNTS  — comma-separated account NAMES (keyless, uses your
 *                          Azure identity / managed identity). Preferred.
 *   2. STORAGE_CONN_1..N  — full connection strings (fallback; contains keys).
 *
 * You can use either or both. Identity-based accounts are preferred and win
 * on name collisions.
 */
export interface AppConfig {
  port: number;
  container: string;
  identityAccounts: string[];
  connectionStrings: string[];
  /** Max time to spend querying a single account before marking it errored. */
  checkTimeoutMs: number;
  /** Auto-discover storage accounts by name suffix via Resource Graph. */
  discover: boolean;
  /** Suffix to match when discovering (e.g. "srd01"). */
  discoverSuffix: string;
  /** Optional subscription-ID allowlist to scope discovery (empty = all). */
  scopeSubscriptions: string[];
  /** Override the "today" date (YYYY-MM-DD) for testing a historical day. */
  checkDate: string | null;
  /** Bot storage check: container holding per-interaction folders (should normally be empty). */
  botContainer: string;
  /** Name prefix of bot storage accounts (e.g. "botstorage"). Empty string disables the check. */
  botPrefix: string;
  /** An interaction folder untouched for this long counts as stuck. */
  botStuckMinutes: number;
  /** Only stuck interactions newer than this many days are reported. */
  botWindowDays: number;
  /** Max time to list one bot storage account. */
  botTimeoutMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const identityAccounts = (env.STORAGE_ACCOUNTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const connectionStrings: string[] = [];
  for (let i = 1; ; i++) {
    const conn = env[`STORAGE_CONN_${i}`]?.trim();
    if (!conn) break;
    connectionStrings.push(conn);
  }

  const scopeSubscriptions = (env.SUBSCRIPTIONS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    port: Number(env.PORT ?? 3001),
    container: (env.ARCHIVE_CONTAINER ?? 'archive').trim(),
    identityAccounts,
    connectionStrings,
    checkTimeoutMs: Number(env.CHECK_TIMEOUT_MS ?? 15000),
    discover: env.STORAGE_DISCOVER === 'true',
    discoverSuffix: (env.DISCOVER_SUFFIX ?? 'srd01').trim(),
    scopeSubscriptions,
    botContainer: (env.BOT_CONTAINER ?? 'audio-video').trim(),
    botPrefix: (env.BOT_ACCOUNT_PREFIX ?? 'botstorage').trim(),
    botStuckMinutes: Number(env.BOT_STUCK_MINUTES ?? 60),
    botWindowDays: Number(env.BOT_WINDOW_DAYS ?? 3),
    botTimeoutMs: Number(env.BOT_TIMEOUT_MS ?? 60_000),
    checkDate: /^\d{4}-\d{2}-\d{2}$/.test((env.CHECK_DATE ?? '').trim()) ? env.CHECK_DATE!.trim() : null,
  };
}
