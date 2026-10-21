import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Request, Response } from 'express';
import { csrfGuard, hostGuard, isAllowedHost, kqlString, rateLimiter, safeNameFragment, securityHeaders } from './security.js';

/** Minimal stand-ins for Express request / response objects. */
function fake(init: { method?: string; headers?: Record<string, string>; url?: string; ip?: string } = {}) {
  const req = {
    method: init.method ?? 'GET',
    headers: { host: 'localhost:3001', ...(init.headers ?? {}) },
    originalUrl: init.url ?? '/api/health',
    path: init.url ?? '/api/health',
    socket: { remoteAddress: init.ip ?? '127.0.0.1' },
  } as unknown as Request;
  const out = { status: 200, body: undefined as unknown, headers: {} as Record<string, string>, next: false };
  const res = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(b: unknown) {
      out.body = b;
      return res;
    },
    setHeader(k: string, v: string) {
      out.headers[k.toLowerCase()] = v;
    },
  } as unknown as Response;
  return { req, res, out, next: () => (out.next = true) };
}

test('host guard: only localhost names (and ALLOWED_HOSTS) are accepted — blocks DNS rebinding', () => {
  for (const ok of ['localhost:3001', 'localhost', '127.0.0.1:3001', '[::1]:3001']) assert.equal(isAllowedHost(ok), true, ok);
  for (const bad of ['evil.example.com', 'evil.example.com:3001', '192.168.1.20:3001', 'localhost.evil.com', '', undefined])
    assert.equal(isAllowedHost(bad as string | undefined), false, String(bad));
  assert.equal(isAllowedHost('monitor.corp:3001', ['monitor.corp']), true);
  const { req, res, out, next } = fake({ headers: { host: 'attacker.test' } });
  hostGuard()(req, res, next);
  assert.equal(out.status, 403);
  assert.equal(out.next, false);
});

test('csrf guard: POST needs the custom header, a same-site Origin and a same-origin fetch', () => {
  const guard = csrfGuard();
  const run = (init: Parameters<typeof fake>[0]) => {
    const f = fake(init);
    guard(f.req, f.res, f.next);
    return f.out;
  };
  assert.equal(run({ method: 'GET' }).next, true, 'GET is not a state change');
  assert.equal(run({ method: 'POST', headers: { 'x-sam-request': '1' } }).next, true, 'the dashboard itself');
  assert.equal(run({ method: 'POST', headers: { 'x-sam-request': '1', origin: 'http://localhost:3001', 'sec-fetch-site': 'same-origin' } }).next, true);
  assert.equal(run({ method: 'POST' }).status, 403, 'no custom header (a form or a plain cross-site POST)');
  assert.equal(run({ method: 'POST', headers: { 'x-sam-request': '1', origin: 'http://localhost:3000' } }).next, true, 'dev server on another local port');
  assert.equal(run({ method: 'POST', headers: { 'x-sam-request': '1', origin: 'https://evil.example.com' } }).status, 403, 'foreign Origin');
  assert.equal(run({ method: 'POST', headers: { 'x-sam-request': '1', origin: 'https://localhost.evil.com' } }).status, 403, 'look-alike host');
  assert.equal(run({ method: 'POST', headers: { 'x-sam-request': '1', origin: 'null' } }).status, 403, 'opaque Origin');
  assert.equal(run({ method: 'POST', headers: { 'x-sam-request': '1', 'sec-fetch-site': 'cross-site' } }).status, 403, 'browser says cross-site');
  assert.equal(run({ method: 'DELETE' }).status, 403);
});

test('security headers: strict CSP, no framing, no sniffing, API answers are not cached', () => {
  const f = fake({ url: '/api/bots' });
  securityHeaders()(f.req, f.res, f.next);
  assert.equal(f.out.next, true);
  assert.match(f.out.headers['content-security-policy']!, /default-src 'self'/);
  const scriptSrc = f.out.headers['content-security-policy']!.split('; ').find((d) => d.startsWith('script-src'))!;
  assert.equal(scriptSrc, "script-src 'self'", 'scripts only from this site: no inline, no eval, no other origin');
  assert.match(f.out.headers['content-security-policy']!, /frame-ancestors 'none'/);
  assert.equal(f.out.headers['x-frame-options'], 'DENY');
  assert.equal(f.out.headers['x-content-type-options'], 'nosniff');
  assert.equal(f.out.headers['cache-control'], 'no-store');
  const page = fake({ url: '/' });
  securityHeaders()(page.req, page.res, page.next);
  assert.equal(page.out.headers['cache-control'], undefined, 'the app shell itself may be cached');
});

test('rate limiter: blocks past the limit, answers 429 with Retry-After, and recovers when the window passes', () => {
  let t = 1_000_000;
  const limit = rateLimiter([{ match: () => true, windowMs: 60_000, max: 3 }], () => t);
  const hit = (ip = '10.0.0.1') => {
    const f = fake({ ip });
    limit(f.req, f.res, f.next);
    return f.out;
  };
  assert.equal(hit().next, true);
  assert.equal(hit().next, true);
  assert.equal(hit().next, true);
  const blocked = hit();
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers['retry-after']) >= 1);
  assert.equal(hit('10.0.0.2').next, true, 'another client has its own budget');
  t += 61_000;
  assert.equal(hit().next, true, 'a new window starts');
});

test('rate limiter: each rule counts only its own requests', () => {
  const limit = rateLimiter([
    { match: (r) => r.method === 'POST', windowMs: 60_000, max: 1 },
    { match: () => true, windowMs: 60_000, max: 100 },
  ]);
  const go = (method: string) => {
    const f = fake({ method });
    limit(f.req, f.res, f.next);
    return f.out;
  };
  assert.equal(go('POST').next, true);
  assert.equal(go('POST').status, 429);
  assert.equal(go('GET').next, true, 'GETs are not affected by the POST rule');
});

test('Kusto (Resource Graph) literals cannot be broken out of', () => {
  assert.equal(kqlString('abc'), "'abc'");
  assert.equal(kqlString("x' | take 1 //"), "'x\\' | take 1 //'");
  assert.equal(kqlString('a\\b'), "'a\\\\b'");
  assert.equal(safeNameFragment('srd01', 'x'), 'srd01');
  assert.equal(safeNameFragment('', 'x'), '');
  assert.throws(() => safeNameFragment("srd01' or 1==1", 'DISCOVER_SUFFIX'), /DISCOVER_SUFFIX/);
  assert.throws(() => safeNameFragment('a b', 'x'));
});
