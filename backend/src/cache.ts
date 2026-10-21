import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A tiny on-disk cache for the last results, so that after a restart (the scheduled task restarts the backend every 15
 * minutes) the dashboard shows the previous results straight away, stamped with the time they were gathered, while the
 * fresh scan runs in the background. It holds the same operational data the API already serves (account and instance
 * names, states, counts) and never any key, token or connection string. The folder is git-ignored.
 */
const DIR = process.env.CACHE_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.cache');

const file = (name: string) => path.join(DIR, `${name}.json`);

/** Read a cached value, or null if there is none or it cannot be parsed (a corrupt cache is simply ignored). */
export function readCache<T>(name: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file(name), 'utf8')) as T;
  } catch {
    return null;
  }
}

const timers = new Map<string, NodeJS.Timeout>();

/** Write a value soon (coalescing bursts of writes), atomically: a half-written file is never read back. */
export function writeCacheSoon(name: string, value: unknown, delayMs = 1500): void {
  clearTimeout(timers.get(name));
  const t = setTimeout(() => {
    timers.delete(name);
    try {
      fs.mkdirSync(DIR, { recursive: true });
      const tmp = `${file(name)}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(value));
      fs.renameSync(tmp, file(name));
    } catch {
      /* a cache that cannot be written is not worth failing for */
    }
  }, delayMs);
  t.unref();
  timers.set(name, t);
}
