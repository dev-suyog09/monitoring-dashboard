/**
 * Customer matching for the shared watchlist / groups on every tab (Archive, Cloud Instances, Databases).
 *
 * Every resource name starts with a customer code followed by an environment, e.g.
 *   adcprduaensasrd01 · adcprdntx-uaen-cs-bot-01 · adcprdntx-uaen-sql-dsm-l1-01  ->  customer "adc", env "prd".
 * A term matches when it IS the customer code ("adc"), or when it is a longer prefix that includes the
 * environment ("adcprd", "mseprd"). It never matches by substring, and "db" does not pull in "dbs" customers.
 */
const CUSTOMER_RE = /^([a-z0-9]+?)(?:prd|uat|dev|tst|stg|poc)/i;

/** "adcprduaensasrd01" -> "adc"; falls back to the text before the first separator. */
export function customerOf(name: string): string {
  const m = CUSTOMER_RE.exec(name);
  return (m ? m[1]! : name.split(/[-_.]/)[0]!).toLowerCase();
}

export type EnvName = 'PRD' | 'UAT' | 'DEV' | 'OTHER';

/** Environment from a resource name: prd -> PRD, uat -> UAT, dev / tst -> DEV (same grouping as the Archive tab). */
export function envOf(name: string): EnvName {
  const m = /^[a-z0-9]+?(prd|uat|dev|tst|stg|poc)/i.exec(name);
  switch (m?.[1]?.toLowerCase()) {
    case 'prd':
      return 'PRD';
    case 'uat':
      return 'UAT';
    case 'dev':
    case 'tst':
      return 'DEV';
    default:
      return 'OTHER';
  }
}

export function matchesTerm(name: string, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return false;
  const n = name.toLowerCase();
  // "n*" = every name starting with "n" (what you get while typing, or by pressing Enter on a partial name)
  if (t.endsWith('*')) {
    const prefix = t.slice(0, -1);
    return prefix.length > 0 && n.startsWith(prefix);
  }
  const customer = customerOf(n);
  if (t === customer) return true;
  return t.length > customer.length && n.startsWith(t);
}

/**
 * Chips (OR) narrowed by what is being typed (AND), so typing inside a group searches AMONG its customers.
 * A trailing space ("db ") means "exactly this customer"; otherwise the text is a prefix ("n" = everything starting with n).
 */
export function matchesFilter(name: string, terms: string[], draft: string): boolean {
  if (!matchesWatch(name, terms)) return false;
  const d = draft.trim().toLowerCase().replace(/\*+$/, '');
  if (!d) return true;
  if (/\s$/.test(draft)) return customerOf(name) === d || matchesTerm(name, d);
  return name.toLowerCase().startsWith(d);
}

/** No terms = everything; otherwise the name must match at least one term. */
export function matchesWatch(name: string, terms: string[]): boolean {
  return terms.length === 0 || terms.some((t) => matchesTerm(name, t));
}
