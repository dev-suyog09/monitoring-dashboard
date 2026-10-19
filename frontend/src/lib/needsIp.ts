import type { CheckResult } from '../types';

/** Firewall rejections read "…isn't allowlisted…"; timeouts and other errors are not an IP problem. */
const FIREWALL_RE = /allowlisted/i;

export interface NeedsIp {
  /** SRD storage accounts rejected by their firewall. */
  srd: string[];
  /** Bot storage accounts rejected by their firewall (deduplicated across SRD locations). */
  bot: string[];
}

/** Accounts that are blocked by the storage firewall and would need this machine's IP added. */
export function findNeedsIp(results: CheckResult[]): NeedsIp {
  const srd = results
    .filter((r) => r.status === 'error' && FIREWALL_RE.test(r.error ?? ''))
    .map((r) => r.accountName);

  const bot = new Set<string>();
  for (const r of results) {
    for (const a of r.bot?.accounts ?? []) {
      if (a.status === 'error' && FIREWALL_RE.test(a.error ?? '')) bot.add(a.accountName);
    }
  }
  return { srd: srd.sort(), bot: [...bot].sort() };
}
