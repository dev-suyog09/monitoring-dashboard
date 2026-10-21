import { expect, test, type Page } from '@playwright/test';

/**
 * Load-time and weight budgets. They run against the real, running dashboard and fail if a change makes the page
 * noticeably heavier or slower: "optimised once" should stay optimised.
 *
 * The numbers are deliberately generous (CI machines and corporate laptops vary); what they catch is a regression such as
 * compression switched off, a huge new dependency in the first bundle, or a new request waterfall.
 */

interface Load {
  firstContentfulPaint: number;
  domContentLoaded: number;
  tableVisible: number;
  transferredKB: number;
  jsKB: number;
  cssKB: number;
  apiKB: number;
  requests: number;
  encoded: boolean;
}

async function measure(page: Page, cold = true): Promise<Load> {
  if (cold) {
    const client = await page.context().newCDPSession(page);
    await client.send('Network.enable');
    await client.send('Network.setCacheDisabled', { cacheDisabled: true });
  }
  const t0 = Date.now();
  await page.goto('/');
  await page.locator('.cust-main .dtable tbody tr').first().waitFor({ state: 'visible', timeout: 60_000 });
  const tableVisible = Date.now() - t0;
  await page.waitForTimeout(800); // let late requests finish
  // what the browser really received (transferSize = bytes on the wire, after compression)
  const m = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0;
    const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const sum = (f: (r: PerformanceResourceTiming) => boolean) => res.filter(f).reduce((n, r) => n + r.transferSize, 0);
    const big = res.filter((r) => /\.(js|css)(\?|$)/.test(r.name) || r.name.includes('/api/')).filter((r) => r.decodedBodySize > 2000);
    return {
      fcp,
      dcl: nav.domContentLoadedEventEnd,
      total: nav.transferSize + sum(() => true),
      js: sum((r) => /\.js(\?|$)/.test(r.name)),
      css: sum((r) => /\.css(\?|$)/.test(r.name)),
      api: sum((r) => r.name.includes('/api/')),
      requests: res.length + 1,
      encoded: big.every((r) => r.encodedBodySize < r.decodedBodySize * 0.8),
    };
  });
  return {
    firstContentfulPaint: Math.round(m.fcp),
    domContentLoaded: Math.round(m.dcl),
    tableVisible,
    transferredKB: Math.round(m.total / 1024),
    jsKB: Math.round(m.js / 1024),
    cssKB: Math.round(m.css / 1024),
    apiKB: Math.round(m.api / 1024),
    requests: m.requests,
    encoded: m.encoded,
  };
}

test.describe('performance budgets', () => {
  test('cold load: weight, compression and timing', async ({ page }, testInfo) => {
    const m = await measure(page);
    console.log('COLD LOAD', JSON.stringify(m));
    await testInfo.attach('cold-load.json', { body: JSON.stringify(m, null, 2), contentType: 'application/json' });
    expect(m.encoded, 'JS, CSS and API answers are compressed').toBe(true);
    expect(m.jsKB, 'JavaScript sent on first load').toBeLessThan(110);
    expect(m.cssKB, 'CSS sent on first load').toBeLessThan(50);
    expect(m.apiKB, 'API data sent on first load').toBeLessThan(120);
    expect(m.transferredKB, 'everything sent on first load').toBeLessThan(350);
    expect(m.firstContentfulPaint, 'first contentful paint (ms)').toBeLessThan(2500);
    expect(m.tableVisible, 'customers table visible (ms)').toBeLessThan(6000);
  });

  test('repeat visit: files fetched on the first visit come from the browser cache', async ({ page }) => {
    await page.goto('/');
    await page.locator('.cust-main .dtable tbody tr').first().waitFor({ state: 'visible', timeout: 60_000 });
    await page.waitForTimeout(1000);
    const first = await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => e.name.includes('/assets/')).map((e) => e.name));
    expect(first.length).toBeGreaterThan(0);
    await page.reload();
    await page.locator('.cust-main .dtable tbody tr').first().waitFor({ state: 'visible', timeout: 60_000 });
    await page.waitForTimeout(500);
    const again = await page.evaluate(() =>
      performance.getEntriesByType('resource').filter((e) => e.name.includes('/assets/')).map((e) => ({ name: e.name, transfer: (e as PerformanceResourceTiming).transferSize })),
    );
    for (const a of again.filter((x) => first.includes(x.name))) expect(a.transfer, `${a.name} should not be re-downloaded`).toBe(0);
  });

  test('asset caching headers: hashed files are immutable, the page itself is revalidated', async ({ request }) => {
    const html = await (await request.get('/')).text();
    const js = /src="(\/assets\/[^"]+\.js)"/.exec(html)![1]!;
    const asset = (await request.get(js)).headers();
    expect(asset['cache-control']).toMatch(/max-age=31536000/);
    expect(asset['cache-control']).toMatch(/immutable/);
    const page = (await request.get('/')).headers();
    expect(page['cache-control']).toMatch(/no-cache|max-age=0/);
  });

  test('switching tabs is fast and does not re-download code that was already loaded', async ({ page }) => {
    await page.goto('/');
    await page.locator('.cust-main .dtable tbody tr').first().waitFor({ state: 'visible', timeout: 60_000 });
    for (const t of ['Archive', 'Cloud', 'Data', 'Customers']) {
      const t0 = Date.now();
      await page.locator('.side-item', { hasText: t }).first().click();
      await page.locator('.page-eyebrow').waitFor();
      expect(Date.now() - t0, `${t} tab switch (ms)`).toBeLessThan(2500);
    }
  });

  test('big tables stay light: no more than a screenful of animated rows', async ({ page }) => {
    await page.goto('/');
    await page.locator('.cust-main .dtable tbody tr').first().waitFor({ state: 'visible', timeout: 60_000 });
    await page.locator('.side-item', { hasText: 'Data' }).first().click();
    await page.locator('.dtable tbody tr').first().waitFor({ state: 'visible' });
    const animated = await page.evaluate(
      () => [...document.querySelectorAll('.dtable tbody tr')].filter((r) => getComputedStyle(r).animationName !== 'none').length,
    );
    expect(animated).toBeLessThanOrEqual(24);
  });
});
