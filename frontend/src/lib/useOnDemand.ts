import { useCallback, useEffect, useRef, useState } from 'react';

const RETRY_MS = 60_000;
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
/** A dropped connection (e.g. the backend restarting) is retried; real API errors are not. */
const isNetworkError = (e: unknown) => e instanceof TypeError || /failed to fetch|network|load failed/i.test((e as Error)?.message ?? '');

/**
 * Lazy data for a tab: `open()` lists the inventory the first time the tab is shown (cheap), and
 * `check(key, scope)` runs a live check for everything or for one item. Nothing is fetched until asked,
 * so the dashboard's start-up is not slowed down by these tabs.
 *
 * Once any check has run, a full check repeats automatically every `autoMs` (15 min by default), so the tab
 * stays current without clicking; a failed run is retried after a minute.
 */
export function useOnDemand<T, S>(
  list: (signal?: AbortSignal) => Promise<T>,
  run: (scope: S) => Promise<T>,
  allScope: S,
  autoMs = 900_000,
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false); // inventory listing
  const [checking, setChecking] = useState<string | null>(null); // key of the running check ('all' or item key)
  const [error, setError] = useState<string | null>(null);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);
  const [nextAuto, setNextAuto] = useState<Date | null>(null);
  const [fullAt, setFullAt] = useState<number | null>(null); // time of the last full ("all") check
  const loadedRef = useRef(false);
  const busyRef = useRef(false);
  const scheduledRef = useRef(false);

  /** List the inventory (first call only, unless forced). */
  const open = useCallback(
    async (force = false) => {
      if (loadedRef.current && !force) return;
      loadedRef.current = true;
      setLoading(true);
      setError(null);
      try {
        setData(await list());
      } catch (e) {
        loadedRef.current = false;
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [list],
  );

  /** Run a live check. `key` labels what is running ('all' or an item id) so its button can show a spinner. */
  const check = useCallback(
    async (key: string, scope: S) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setChecking(key);
      setError(null);
      try {
        let result: T | null = null;
        for (let attempt = 0; attempt < 3 && result === null; attempt++) {
          try {
            result = await run(scope);
          } catch (e) {
            // the backend restarts every 15 min — wait for it to come back instead of failing
            if (attempt < 2 && isNetworkError(e)) await sleep(20_000);
            else throw e;
          }
        }
        setData(result);
        const now = new Date();
        setLastCheck(now);
        // any successful check starts / moves the 15-minute schedule (it always re-runs the full check)
        setFullAt(now.getTime());
        loadedRef.current = true;
      } catch (e) {
        setError((e as Error).message);
        // a failed run must not end the schedule: if one is active (or this was a full check), retry in a minute
        if (key === 'all' || scheduledRef.current) setFullAt(Date.now() - autoMs + RETRY_MS);
      } finally {
        busyRef.current = false;
        setChecking(null);
      }
    },
    [run, autoMs],
  );

  // Auto re-check: every `autoMs` after the last check. A 15 s watchdog (instead of one long timer) keeps this
  // working through laptop sleep and background-tab throttling, which can delay or drop long timeouts.
  const scopeRef = useRef(allScope);
  scopeRef.current = allScope;
  const checkRef = useRef(check);
  checkRef.current = check;
  useEffect(() => {
    scheduledRef.current = fullAt !== null;
    if (fullAt === null) {
      setNextAuto(null);
      return;
    }
    const due = fullAt + autoMs;
    setNextAuto(new Date(due));
    const t = setInterval(() => {
      if (Date.now() >= due && !busyRef.current) void checkRef.current('all', scopeRef.current);
    }, 15_000);
    return () => clearInterval(t);
  }, [fullAt, autoMs]);

  /** Forget everything (e.g. after the backend restarted); the next `open()` lists again. */
  const reset = useCallback(() => {
    loadedRef.current = false;
    setData(null);
    setLastCheck(null);
    setFullAt(null);
    scheduledRef.current = false;
  }, []);

  return { data, loading, checking, error, lastCheck, nextAuto, open, check, reset };
}
