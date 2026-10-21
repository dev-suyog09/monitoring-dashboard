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

// ---- Subscription-name matching (chips are full subscription names, e.g. "azu-nvm-fmc-ncc-prd-db") ----

const lastSegment = (n: string) => n.split(/[-_ ]/).pop() ?? n;
/** True when `p` starts the name or any dash-separated part of it ("db", "prd-d", "ncc-prd" all find azu-nvm-fmc-ncc-prd-db). */
const subPrefix = (n: string, p: string) => {
  for (let i = 0; i < n.length; i++) if ((i === 0 || /[-_ ]/.test(n[i - 1]!)) && n.startsWith(p, i)) return true;
  return false;
};

/** Key a resource is filtered by: its subscription name, or (if unknown) its customer code. */
export function scopeKey(subscription: string | undefined, resource: string): string {
  return (subscription || customerOf(resource)).toLowerCase();
}

/** True when `typed` should suggest / match this subscription (prefix of the name or of its last segment). */
export function subSuggestHit(sub: string, typed: string): boolean {
  return subPrefix(sub.toLowerCase(), typed.toLowerCase());
}

function subMatchesTerm(sub: string, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return false;
  const n = sub.toLowerCase();
  if (t.endsWith('*')) {
    const p = t.slice(0, -1);
    return p.length > 0 && subPrefix(n, p);
  }
  return t === n || t === lastSegment(n); // last segment keeps older saved groups ("snc", "db") working
}

/** Chips (OR) narrowed by what is typed (AND); a trailing space means "exactly this subscription". */
export function subMatchesFilter(sub: string, terms: string[], draft: string): boolean {
  if (terms.length > 0 && !terms.some((t) => subMatchesTerm(sub, t))) return false;
  const d = draft.trim().toLowerCase().replace(/\*+$/, '');
  if (!d) return true;
  const n = sub.toLowerCase();
  if (/\s$/.test(draft)) return n === d || lastSegment(n) === d;
  return subPrefix(n, d);
}

export function subMatchesWatch(sub: string, terms: string[]): boolean {
  return terms.length === 0 || terms.some((t) => subMatchesTerm(sub, t));
}
