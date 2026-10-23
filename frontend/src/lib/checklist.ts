import { useCallback, useEffect, useRef, useState } from 'react';
import type { WatchGroup } from './watchlist';

/** The daily health-check checklist (see backend/src/checklist.ts): ticks, the reminder email and its times live on the backend. */
export interface ChecklistList {
  name: string;
  members: string[];
  /** Members ticked today. */
  done: string[];
}

export interface Notice {
  at: string;
  ok: boolean;
  slot: string;
  error?: string;
}

export interface ChecklistData {
  today: string;
  email: string;
  enabled: boolean;
  times: string[];
  repeat: boolean;
  repeatMinutes: number;
  /** Lists that are reminded about; null = all. */
  tracked: string[] | null;
  lists: ChecklistList[];
  smtp: { configured: boolean; from: string };
  lastMail: Notice | null;
  /** Whether a Teams webhook is saved (the address itself never comes back to the browser). */
  teams: { configured: boolean };
  lastTeams: Notice | null;
  nextReminder: string | null;
}

async function call<T>(method: 'GET' | 'PUT' | 'POST', url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'X-SAM-Request': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

/** A saved group is a checklist: its name is the list, its search terms are the members. */
export const listsFrom = (groups: WatchGroup[]) => groups.map((g) => ({ name: g.name, members: g.terms }));

let syncTimer: number | undefined;
/** Tell the backend which lists exist, so it knows what to remind about (debounced; failures are not worth bothering anyone). */
export function syncLists(groups: WatchGroup[], immediate = false): Promise<ChecklistData | null> {
  window.clearTimeout(syncTimer);
  const run = () => call<ChecklistData>('PUT', '/api/checklist/lists', { lists: listsFrom(groups) }).catch(() => null);
  if (immediate) {
    // opening the dashboard in a browser that has no groups (a new profile) must not wipe the lists saved earlier
    return groups.length === 0 ? call<ChecklistData>('GET', '/api/checklist').catch(() => null) : run();
  }
  return new Promise((resolve) => {
    syncTimer = window.setTimeout(() => void run().then(resolve), 600);
  });
}

export function useChecklist(groups: WatchGroup[]) {
  const [data, setData] = useState<ChecklistData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const d = await call<ChecklistData>('GET', '/api/checklist');
      if (alive.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Could not load the checklist.');
    }
  }, []);

  // the backend has to know the current lists before the first read, then it is re-read now and then (a new day starts unticked)
  const sig = JSON.stringify(listsFrom(groups));
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    void syncLists(groups, true).then((d) => {
      if (cancelled) return;
      if (d) setData(d);
      else void refresh();
    });
    const t = window.setInterval(() => void refresh(), 60_000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      alive.current = false;
      window.clearInterval(t);
      window.removeEventListener('focus', onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, refresh]);

  const apply = useCallback(async <T extends ChecklistData | { ok: boolean }>(p: Promise<T>) => {
    const r = await p;
    if ('lists' in r && alive.current) setData(r);
    return r;
  }, []);

  /** Tick or untick one member (instant on screen, then confirmed by the backend). */
  const toggle = useCallback(
    async (list: string, member: string | null, done: boolean) => {
      setData((d) =>
        d
          ? {
              ...d,
              lists: d.lists.map((l) =>
                l.name !== list ? l : { ...l, done: member === null ? (done ? [...l.members] : []) : done ? [...new Set([...l.done, member])] : l.done.filter((m) => m !== member) },
              ),
            }
          : d,
      );
      try {
        await apply(call<ChecklistData>('POST', '/api/checklist/mark', { list, member, done }));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save.');
        void refresh();
      }
    },
    [apply, refresh],
  );

  const saveSettings = useCallback(
    (patch: Partial<Pick<ChecklistData, 'email' | 'enabled' | 'times' | 'repeat' | 'repeatMinutes' | 'tracked'>> & { teamsUrl?: string }) => apply(call<ChecklistData>('PUT', '/api/checklist/settings', patch)),
    [apply],
  );

  const testMail = useCallback(() => call<{ ok: boolean }>('POST', '/api/checklist/test-mail'), []);
  const testTeams = useCallback(() => call<{ ok: boolean }>('POST', '/api/checklist/test-teams'), []);

  return { data, error, toggle, saveSettings, testMail, testTeams, refresh };
}

/** Reminder times every `hours` hours from `from` ("HH:MM") until midnight: 3 from 00:00 -> 00:00, 03:00, ... 21:00. */
export function everyHours(hours: number, from = '00:00'): string[] {
  const [h, m] = from.split(':').map(Number) as [number, number];
  const out: string[] = [];
  for (let t = h * 60 + m; t < 24 * 60; t += hours * 60) out.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
  return out;
}

export const REPEAT_CHOICES: { minutes: number; label: string }[] = [
  { minutes: 15, label: '15 minutes' },
  { minutes: 30, label: '30 minutes' },
  { minutes: 60, label: 'hour' },
  { minutes: 90, label: '90 minutes' },
  { minutes: 120, label: '2 hours' },
  { minutes: 180, label: '3 hours' },
  { minutes: 240, label: '4 hours' },
];

/** "3:00 AM" from "03:00". */
export function clock(t: string): string {
  const [h, m] = t.split(':').map(Number) as [number, number];
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
