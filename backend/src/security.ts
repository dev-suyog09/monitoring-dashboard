import type { NextFunction, Request, Response } from 'express';

/**
 * Request guards for the dashboard API.
 *
 * The dashboard is a single-user tool that talks to Azure with the signed-in user's own identity, so the real risk is
 * not "another user" but *another website or another machine reaching it*:
 *   - a web page you open can send requests to http://localhost:3001 (CSRF) or read its answers (CORS),
 *   - a DNS-rebinding page can make your browser treat an attacker's name as localhost,
 *   - a server listening on every network interface can be reached from the LAN.
 * These guards close those paths without adding accounts or passwords the tool has no use for.
 */

const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/** True for localhost / 127.0.0.1 / [::1] (any port), or a host listed in ALLOWED_HOSTS. */
export function isAllowedHost(host: string | undefined, extra: readonly string[] = []): boolean {
  if (!host) return false;
  if (LOCAL_HOST_RE.test(host)) return true;
  const h = host.toLowerCase();
  return extra.some((e) => e.toLowerCase() === h || e.toLowerCase() === h.replace(/:\d+$/, ''));
}

/** Rejects requests whose Host header is not ours: stops DNS-rebinding pages from using the API as "localhost". */
export function hostGuard(extra: readonly string[] = []) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!isAllowedHost(req.headers.host, extra)) {
      res.status(403).json({ error: 'Unexpected Host header. Open the dashboard at http://localhost:<port>.' });
      return;
    }
    next();
  };
}

/** Name of the header every dashboard request carries. A browser cannot add it to a cross-site request without a CORS preflight, which we never approve. */
export const CSRF_HEADER = 'x-sam-request';

/**
 * CSRF protection for anything that changes or triggers work (POST / PUT / PATCH / DELETE):
 *   1. a custom header must be present (cross-site pages cannot send it without a rejected preflight),
 *   2. if the browser says where the request came from (Origin), it must be this same site (or this machine),
 *   3. if the browser reports Sec-Fetch-Site, it must be same-origin (or "none" for the address bar).
 */
export function csrfGuard(extraHosts: readonly string[] = []) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const origin = req.headers.origin;
    let originOk = true;
    if (origin) {
      try {
        const o = new URL(origin).host.toLowerCase();
        // same site, or another port on this machine (the Vite dev server proxies the dashboard from :3000 to :3001)
        originOk = o === (req.headers.host ?? '').toLowerCase() || isAllowedHost(o, extraHosts);
      } catch {
        originOk = false;
      }
    }
    const site = req.headers['sec-fetch-site'];
    const siteOk = !site || site === 'same-origin' || site === 'none';
    if (req.headers[CSRF_HEADER] !== '1' || !originOk || !siteOk) {
      res.status(403).json({ error: 'Cross-site request blocked.' });
      return;
    }
    next();
  };
}

/** Defensive response headers: CSP (no inline script, no other origins), no framing, no MIME sniffing, no caching of API data. */
export function securityHeaders() {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // React sets inline style attributes
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  };
}

export interface RateRule {
  /** Which requests this rule counts. */
  match: (req: Request) => boolean;
  windowMs: number;
  max: number;
}

/** Fixed-window, in-memory limiter per client IP and rule. Small on purpose: one process, one user, no extra dependency. */
export function rateLimiter(rules: RateRule[], now: () => number = Date.now) {
  const hits = new Map<string, { start: number; n: number }>();
  const sweep = setInterval(() => {
    const t = now();
    for (const [k, v] of hits) if (t - v.start > 10 * 60_000) hits.delete(k);
  }, 60_000);
  sweep.unref();
  return (req: Request, res: Response, next: NextFunction) => {
    const t = now();
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i]!;
      if (!rule.match(req)) continue;
      const key = `${i}|${req.socket.remoteAddress ?? 'unknown'}`;
      const cur = hits.get(key);
      if (!cur || t - cur.start >= rule.windowMs) hits.set(key, { start: t, n: 1 });
      else if (++cur.n > rule.max) {
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil((cur.start + rule.windowMs - t) / 1000))));
        res.status(429).json({ error: 'Too many requests — slow down and try again in a moment.' });
        return;
      }
    }
    next();
  };
}

/** Escapes a value for use inside a single-quoted Kusto (Resource Graph) string literal. */
export function kqlString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** Storage-account-name fragments (a suffix or prefix) may only contain what Azure allows in names. */
export function safeNameFragment(value: string, label: string): string {
  if (!/^[a-z0-9-]{0,24}$/i.test(value)) throw new Error(`${label} may only contain letters, digits and "-" (got "${value}").`);
  return value;
}
