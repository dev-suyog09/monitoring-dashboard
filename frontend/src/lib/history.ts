import type { CheckResult } from '../types';

export interface DayPoint {
  date: string;
  /** Accounts (with SRD) whose archive had a folder for this date. */
  covered: number;
  /** monitorable − covered. */
  missing: number;
}

/** Last `n` calendar dates ending on `today` (YYYY-MM-DD), oldest first. */
export function lastDates(today: string, n: number): string[] {
  const out: string[] = [];
  const base = new Date(`${today}T00:00:00`);
  if (Number.isNaN(base.getTime())) return out;
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

/** An account is "monitorable" if it actually has SRD data to archive. */
export function isMonitorable(r: CheckResult): boolean {
  return r.status !== 'no_data';
}

/**
 * Daily coverage over the last `n` days, derived from each account's
 * `recentDates` (the backend keeps the 7 most recent date-folders per capture).
 * An account counts as "covered" on day D if any capture folder has D.
 *
 * NOTE: accurate only as far back as `recentDates` reaches (7 days), so keep n ≤ 7.
 */
export function coverageSeries(results: CheckResult[], today: string, n = 7): DayPoint[] {
  const dates = lastDates(today, n);
  const monitorable = results.filter(isMonitorable);
  return dates.map((date) => {
    let covered = 0;
    for (const r of monitorable) {
      if (r.captureFolders.some((cf) => cf.recentDates.includes(date))) covered++;
    }
    return { date, covered, missing: monitorable.length - covered };
  });
}
