import { expect, test } from '@playwright/test';
import { start, trackErrors } from './helpers';

/** Security checks against the running dashboard: what a hostile web page, another machine or a bad input can and cannot do. */

const SECRET_RE = /AccountKey|SharedAccessSignature|[?&]sig=|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.|"password"|"secret"|client_secret|DefaultEndpointsProtocol/i;

test.describe('cross-site access (CORS, CSRF, DNS rebinding)', () => {
  test('no CORS headers: another website cannot read the API from a browser', async ({ request }) => {
    const res = await request.get('/api/health', { headers: { Origin: 'https://evil.example.com' } });
    expect(res.status()).toBe(200);
    expect(res.headers()['access-control-allow-origin']).toBeUndefined();
    const preflight = await request.fetch('/api/bots/check', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example.com', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-sam-request' },
    });
    expect(preflight.headers()['access-control-allow-origin']).toBeUndefined(); // a preflight is never approved
  });

  test('a request for the wrong Host name is refused (DNS rebinding)', async ({ request }) => {
    const res = await request.get('/api/health', { headers: { Host: 'attacker.example.com' } });
    expect(res.status()).toBe(403);
  });

  test('POST without the dashboard header is refused (CSRF)', async ({ request }) => {
    expect((await request.post('/api/bots/check?service=none')).status()).toBe(403);
    expect((await request.post('/api/databases/check?server=none')).status()).toBe(403);
    expect((await request.post('/api/restart')).status()).toBe(403);
  });

  test('POST from a foreign Origin or a cross-site fetch is refused even with the header', async ({ request }) => {
    const h = { 'X-SAM-Request': '1' };
    expect((await request.post('/api/bots/check?service=none', { headers: { ...h, Origin: 'https://evil.example.com' } })).status()).toBe(403);
    expect((await request.post('/api/bots/check?service=none', { headers: { ...h, Origin: 'null' } })).status()).toBe(403);
    expect((await request.post('/api/bots/check?service=none', { headers: { ...h, 'Sec-Fetch-Site': 'cross-site' } })).status()).toBe(403);
  });

  test('the dashboard itself can still POST (header + same origin)', async ({ page }) => {
    await start(page);
    const status = await page.evaluate(async () => {
      // an invalid name is answered with 400 straight away (no Azure work), but only after the guards let the request in
      const r = await fetch('/api/bots/check?service=not%20valid', { method: 'POST', headers: { 'X-SAM-Request': '1' } });
      return r.status;
    });
    expect(status).toBe(400); // 403 would mean the CSRF guard blocked the dashboard's own request; 429 the rate limit
  });
});

test.describe('input validation (injection, traversal)', () => {
  const h = { 'X-SAM-Request': '1' };
  test('query values with quotes, spaces or path characters are rejected before any Azure call', async ({ request }) => {
    for (const bad of ["x' or 1=1", 'a b', '../../etc/passwd', 'x;drop', '<script>', 'a'.repeat(200)]) {
      const q = encodeURIComponent(bad);
      expect((await request.post(`/api/bots/check?service=${q}`, { headers: h })).status(), `bots service=${bad}`).toBe(400);
      expect((await request.post(`/api/databases/check?server=${q}`, { headers: h })).status(), `databases server=${bad}`).toBe(400);
    }
  });

  test('/api/files only serves known accounts, single folder names and real dates', async ({ request }) => {
    expect((await request.get('/api/files?account=nope&capture=a&date=2026-01-01')).status()).toBe(404);
    expect((await request.get('/api/files?account=x&capture=..%2F..&date=2026-01-01')).status()).toBe(400);
    expect((await request.get('/api/files?account=x&capture=a%5Cb&date=2026-01-01')).status()).toBe(400);
    expect((await request.get('/api/files?account=x&capture=a&date=2026-01-01%27%3B--')).status()).toBe(400);
  });
});

test.describe('browser protections (XSS, CSP, headers)', () => {
  test('security headers are on the page and on API answers', async ({ request }) => {
    for (const url of ['/', '/api/health']) {
      const h = (await request.get(url)).headers();
      expect(h['content-security-policy'], url).toContain("script-src 'self'");
      expect(h['content-security-policy'], url).toContain("frame-ancestors 'none'");
      expect(h['x-frame-options'], url).toBe('DENY');
      expect(h['x-content-type-options'], url).toBe('nosniff');
      expect(h['referrer-policy'], url).toBe('no-referrer');
      expect(h['x-powered-by'], url).toBeUndefined();
    }
    expect((await request.get('/api/health')).headers()['cache-control']).toBe('no-store');
  });

  test('the app runs cleanly under the strict CSP (no violations)', async ({ page }) => {
    const errors = trackErrors(page);
    await start(page);
    await page.waitForTimeout(1500);
    expect(errors.filter((e) => /Content Security Policy|CSP/i.test(e))).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('an inline script is blocked by the CSP (the browser reports the violation and does not run it)', async ({ page }) => {
    await start(page);
    const result = await page.evaluate(
      () =>
        new Promise<{ violated: string | null; ran: boolean }>((resolve) => {
          const w = window as unknown as { __inline?: number };
          document.addEventListener('securitypolicyviolation', (e) => resolve({ violated: e.violatedDirective, ran: w.__inline === 1 }), { once: true });
          const s = document.createElement('script');
          s.textContent = 'window.__inline = 1';
          document.head.appendChild(s);
          setTimeout(() => resolve({ violated: null, ran: w.__inline === 1 }), 2000);
        }),
    );
    expect(result.violated).toMatch(/script-src/);
    expect(result.ran).toBe(false);
  });

  test('markup in stored data is shown as plain text, never executed', async ({ page }) => {
    await start(page);
    await page.evaluate(() => {
      localStorage.setItem('sam.watchgroups', JSON.stringify([{ name: '<img src=x onerror="window.__xss=1">', terms: ['<b>x</b>'] }]));
    });
    await page.reload();
    await page.getByRole('button', { name: /^Groups/ }).click();
    await expect(page.locator('.wl-menu')).toContainText('<img src=x onerror=');
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss ?? null)).toBeNull();
    expect(await page.locator('.wl-menu img').count()).toBe(0);
  });

  test('no source maps are published', async ({ request }) => {
    const html = await (await request.get('/')).text();
    const js = /src="(\/assets\/[^"]+\.js)"/.exec(html)![1]!;
    const bundle = await (await request.get(js)).text();
    expect(bundle).not.toMatch(/sourceMappingURL/);
    const map = await request.get(`${js}.map`);
    expect(map.status()).toBe(404);
    expect(map.headers()['content-type'] ?? '').not.toContain('json');
  });
});

test.describe('secrets stay on the server', () => {
  test('API answers contain no keys, tokens, signatures or passwords', async ({ request }) => {
    for (const url of ['/api/health', '/api/me', '/api/check', '/api/bots', '/api/databases']) {
      const body = await (await request.get(url)).text();
      expect(body, url).not.toMatch(SECRET_RE);
    }
  });

  test('the browser stores only preferences: no tokens or keys in localStorage / sessionStorage', async ({ page }) => {
    await start(page);
    await page.getByRole('button', { name: /Settings/ }).first().click();
    await page.keyboard.press('Escape');
    const dump = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
    expect(dump).not.toMatch(SECRET_RE);
    expect(dump).not.toMatch(/token|bearer|authorization/i);
    const keys = await page.evaluate(() => Object.keys(localStorage));
    for (const k of keys) expect(k, 'unexpected storage key').toMatch(/^sam\./);
  });

  test('the page does not set cookies', async ({ page, context }) => {
    await start(page);
    expect(await context.cookies()).toEqual([]);
  });
});

test.describe('abuse protection (rate limiting)', () => {
  test('the restart endpoint is limited to a few requests per minute', async ({ request }) => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      // a foreign Origin makes each request fail with 403 (nothing is restarted), but it still counts against the limit
      codes.push((await request.post('/api/restart', { headers: { 'X-SAM-Request': '1', Origin: 'https://evil.example.com' } })).status());
    }
    expect(codes.every((c) => c === 403 || c === 429), `statuses: ${codes}`).toBe(true); // never an actual restart (202)
    expect(codes, 'the 4th request within a minute is refused').toContain(429);
    expect(codes.indexOf(429)).toBeGreaterThanOrEqual(0);
    const blocked = await request.post('/api/restart', { headers: { 'X-SAM-Request': '1', Origin: 'https://evil.example.com' } });
    expect(blocked.headers()['retry-after']).toBeDefined();
  });
});
