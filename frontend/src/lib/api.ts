import type { BotsResponse, CheckResponse, DatabasesResponse, FilesResponse } from '../types';

/** Every request carries this header: the backend refuses mutating requests without it, and a page on another site cannot add it (CSRF). */
const SAM_HEADERS = { 'X-SAM-Request': '1' };

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, headers: SAM_HEADERS });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export interface Me {
  email: string | null;
  name: string | null;
}

export function fetchMe(signal?: AbortSignal): Promise<Me> {
  return getJson<Me>('/api/me', signal);
}

/** "suyog.kulkarni@nice.com" -> "Suyog" (the token's given name wins when there is one). */
export function firstName(me: Me | null): string | null {
  if (!me) return null;
  const raw = me.name?.trim() || me.email?.split('@')[0]?.split(/[._\-+]/)[0] || '';
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase() : null;
}

export interface Health {
  status: string;
  ready: boolean;
  /** Backend process start time; changes after a restart. */
  startedAt: string;
}

export function fetchHealth(signal?: AbortSignal): Promise<Health> {
  return getJson<Health>('/api/health', signal);
}

/** Ask the backend to restart itself (via the scheduled task). Resolves once the restart is triggered. */
export async function restartBackend(): Promise<void> {
  const res = await fetch('/api/restart', { method: 'POST', headers: SAM_HEADERS });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `HTTP ${res.status}`);
  }
}

/** The page's first data requests are started by /boot.js before the bundle has even loaded; each answer is used once. */
function takeEarly<T>(key: 'check' | 'bots' | 'databases'): Promise<T> | null {
  const w = window as unknown as { __early?: Partial<Record<string, Promise<T>>> };
  const p = w.__early?.[key] ?? null;
  if (w.__early) delete w.__early[key];
  return p;
}

export function fetchCheck(signal?: AbortSignal, fresh = false): Promise<CheckResponse> {
  const url = `/api/check${fresh ? '?fresh=1' : ''}`;
  const early = fresh ? null : takeEarly<CheckResponse>('check');
  return early ? early.catch(() => getJson<CheckResponse>(url, signal)) : getJson<CheckResponse>(url, signal);
}

/** Latest chat / media files inside archive/{capture}/{date}/ for one account. */
export function fetchFiles(
  account: string,
  capture: string,
  date: string,
  signal?: AbortSignal,
  fresh = false,
): Promise<FilesResponse> {
  const q = new URLSearchParams({ account, capture, date });
  if (fresh) q.set('fresh', '1');
  return getJson<FilesResponse>(`/api/files?${q.toString()}`, signal);
}

async function postJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: SAM_HEADERS });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

const qs = (params: Record<string, string | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const t = q.toString();
  return t ? `?${t}` : '';
};

/** Cloud service inventory + whatever has been checked so far (cheap). */
export const fetchBots = (signal?: AbortSignal) => {
  const early = takeEarly<BotsResponse>('bots');
  return early ? early.catch(() => getJson<BotsResponse>('/api/bots', signal)) : getJson<BotsResponse>('/api/bots', signal);
};
/** Live-check bots: no scope = all; customer(+env) = one customer; service = one bot. */
export const checkBots = (scope: { customer?: string; env?: string; service?: string; subscriptionId?: string } = {}) =>
  postJson<BotsResponse>(`/api/bots/check${qs(scope)}`);

/** SQL database inventory + whatever has been checked so far (cheap). */
export const fetchDatabases = (signal?: AbortSignal) => {
  const early = takeEarly<DatabasesResponse>('databases');
  return early ? early.catch(() => getJson<DatabasesResponse>('/api/databases', signal)) : getJson<DatabasesResponse>('/api/databases', signal);
};
/** Live-check databases: no scope = all; server = one server; server+db = one database. */
export const checkDatabases = (scope: { server?: string; db?: string; subscriptionId?: string } = {}) =>
  postJson<DatabasesResponse>(`/api/databases/check${qs(scope)}`);
