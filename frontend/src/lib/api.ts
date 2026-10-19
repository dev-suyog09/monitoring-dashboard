import type { BotsResponse, CheckResponse, DatabasesResponse, FilesResponse } from '../types';

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
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
  const res = await fetch('/api/restart', { method: 'POST' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `HTTP ${res.status}`);
  }
}

export function fetchCheck(signal?: AbortSignal, fresh = false): Promise<CheckResponse> {
  return getJson<CheckResponse>(`/api/check${fresh ? '?fresh=1' : ''}`, signal);
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
  const res = await fetch(url, { method: 'POST' });
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
export const fetchBots = (signal?: AbortSignal) => getJson<BotsResponse>('/api/bots', signal);
/** Live-check bots: no scope = all; customer(+env) = one customer; service = one bot. */
export const checkBots = (scope: { customer?: string; env?: string; service?: string; subscriptionId?: string } = {}) =>
  postJson<BotsResponse>(`/api/bots/check${qs(scope)}`);

/** SQL database inventory + whatever has been checked so far (cheap). */
export const fetchDatabases = (signal?: AbortSignal) => getJson<DatabasesResponse>('/api/databases', signal);
/** Live-check databases: no scope = all; server = one server; server+db = one database. */
export const checkDatabases = (scope: { server?: string; db?: string; subscriptionId?: string } = {}) =>
  postJson<DatabasesResponse>(`/api/databases/check${qs(scope)}`);
