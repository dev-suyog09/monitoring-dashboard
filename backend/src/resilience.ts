import type { CheckResponse, CheckResult } from './types.js';

/**
 * When the laptop drops off the VPN (or the network changes), nearly every account fails at once. That says something about
 * the network, not about the accounts, so the dashboard must not treat it as their real state: it is not saved for the next
 * restart, not shown again after a restart, and the scan is retried within a minute instead of 15.
 */

/** This share of accounts failing in one scan means "the network is down", not "these accounts are broken". */
export const TROUBLE_SHARE = 0.25;
/** Below this many accounts a share means nothing (a single failing account is just that account). */
export const TROUBLE_MIN_ACCOUNTS = 4;
/** After a bad scan: look again this soon, and give up (until the normal timer) after this many tries in a row. */
export const QUICK_RETRY_MS = 60_000;
export const MAX_QUICK_RETRIES = 10;

export const errorCount = (results: CheckResult[]): number => results.filter((r) => r.status === 'error').length;

/** True when so many accounts failed together that the network (VPN) is the likely cause. */
export function networkTrouble(results: CheckResult[]): boolean {
  return results.length >= TROUBLE_MIN_ACCOUNTS && errorCount(results) / results.length >= TROUBLE_SHARE;
}

/**
 * The part of a saved scan that is safe to show straight after a restart: only accounts that were read successfully.
 * Accounts that had failed are left out, so they show up once the fresh scan has really looked at them. Null = nothing usable.
 */
export function restorable(saved: CheckResponse): CheckResponse | null {
  if (!Array.isArray(saved.results)) return null;
  const results = saved.results.filter((r) => r.status !== 'error');
  return results.length > 0 ? { ...saved, results } : null;
}

/** A heavy account (many capture folders) can take longer than the normal limit under load: it gets one more try with this much more time. */
export const SLOW_RETRY_FACTOR = 3;

/**
 * Accounts that only timed out, to be tried once more with more time. Empty during a network-wide failure (then the VPN is the
 * cause and a longer wait would only slow the scan down); an account blocked by a firewall is not a timeout and is not retried.
 */
export function slowAccounts(results: CheckResult[]): CheckResult[] {
  if (networkTrouble(results)) return [];
  return results.filter((r) => r.status === 'error' && /timed out/i.test(r.error ?? ''));
}

/** Milliseconds until the next quick re-scan, or null when the scan was fine (or the quick tries are used up). */
export function nextQuickRetry(results: CheckResult[], attempts: number): number | null {
  return networkTrouble(results) && attempts < MAX_QUICK_RETRIES ? QUICK_RETRY_MS : null;
}
