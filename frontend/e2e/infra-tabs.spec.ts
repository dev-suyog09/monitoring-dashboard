import { expect, test, type Page } from '@playwright/test';
import { clearFilter, goTab, start, trackErrors } from './helpers';

const metric = (page: Page, label: string | RegExp) => page.locator('.mstrip .metric', { hasText: label });
const banner = (page: Page) => page.locator('.banner-warm').first();

test.describe('Cloud Instances tab', () => {
  test('layout: 5 metrics, attention list and health donut', async ({ page }) => {
    const errors = trackErrors(page);
    await start(page);
    await goTab(page, 'Cloud');
    await expect(page.locator('.mstrip .metric')).toHaveCount(5);
    await expect(page.locator('.insights')).toHaveCount(0);
    await expect(page.locator('.att-item').first()).toBeVisible();
    await expect(page.locator('.cust-side .donut-wrap')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('metric cards, attention items and the donut apply filters that can be cleared', async ({ page }) => {
    await start(page);
    await goTab(page, 'Cloud');
    await metric(page, 'Stopped / unresponsive').click();
    await expect(banner(page)).toContainText(/stopped/i);
    await clearFilter(page);
    await metric(page, 'Starting / other').click();
    await expect(banner(page)).toContainText(/starting/i);
    await clearFilter(page);
    await page.locator('.att-item').first().click();
    await expect(banner(page)).toContainText('Showing only');
    await clearFilter(page);
    await page.locator('.cust-side .donut-legend li', { hasText: 'Started' }).click();
    await expect(banner(page)).toContainText(/started/i);
    await clearFilter(page);
    await expect(page.locator('.banner-warm', { hasText: 'Showing only' })).toHaveCount(0);
  });

  test('env pills filter the metrics', async ({ page }) => {
    await start(page);
    await goTab(page, 'Cloud');
    const before = await metric(page, 'Cloud services').innerText();
    await page.getByRole('button', { name: /^UAT \d+/ }).click();
    await expect.poll(() => metric(page, 'Cloud services').innerText()).not.toBe(before);
    await page.getByRole('button', { name: /^UAT \d+/ }).click();
  });
});

test.describe('Databases tab', () => {
  test('layout: 6 metrics, attention list and storage donut', async ({ page }) => {
    const errors = trackErrors(page);
    await start(page);
    await goTab(page, 'Data');
    await expect(page.locator('.mstrip .metric')).toHaveCount(6);
    await expect(page.locator('.att-item').first()).toBeVisible();
    await expect(page.locator('.cust-side .donut-wrap')).toHaveCount(1);
    expect(await page.locator('.dtable tbody tr').count()).toBeGreaterThan(50);
    expect(errors).toEqual([]);
  });

  test('every metric card filters the table', async ({ page }) => {
    await start(page);
    await goTab(page, 'Data');
    const total = await page.locator('.dtable tbody tr').count();
    for (const label of [/storage/, /watch/, /DTU/, /LTR backup/]) {
      const card = metric(page, label).first();
      const value = (await card.locator('.metric-val').innerText()).trim();
      if (value === '0' || value === '—') continue; // nothing in that bucket right now
      await card.click();
      await expect.poll(() => page.locator('.dtable tbody tr').count()).toBeLessThan(total);
      await page.getByRole('button', { name: /Clear filter/ }).click();
      await expect.poll(() => page.locator('.dtable tbody tr').count()).toBe(total);
    }
  });

  test('attention item narrows to that one server, and the search box clears', async ({ page }) => {
    await start(page);
    await goTab(page, 'Data');
    const total = await page.locator('.dtable tbody tr').count();
    await page.locator('.att-item').first().click();
    await expect.poll(() => page.locator('.dtable tbody tr').count()).toBeLessThan(15);
    const search = page.getByPlaceholder(/Filter databases/i);
    await search.fill('');
    await expect.poll(() => page.locator('.dtable tbody tr').count()).toBe(total);
  });

  test('storage donut filters the table', async ({ page }) => {
    await start(page);
    await goTab(page, 'Data');
    const total = await page.locator('.dtable tbody tr').count();
    await page.locator('.cust-side .donut-legend li', { hasText: 'Critical' }).click();
    await expect.poll(() => page.locator('.dtable tbody tr').count()).toBeLessThan(total);
    await page.getByRole('button', { name: /Clear filter/ }).click();
  });

  test('per-row Check button is present', async ({ page }) => {
    await start(page);
    await goTab(page, 'Data');
    await expect(page.locator('.dtable tbody button', { hasText: /heck/ }).first()).toBeVisible();
  });
});

test.describe('Cloud Instances and Databases: table on the left, Needs attention + health in a scrolling side column (as on Customers)', () => {
  for (const [tabName, healthTitle, mainSelector] of [
    ['Cloud', 'Instance health', '.panel, .dtable'],
    ['Data', 'Storage health', '.dtable'],
  ] as const) {
    test(`${tabName}: layout, side column content and wheel scrolling`, async ({ page }) => {
      await start(page);
      await goTab(page, tabName);
      const main = page.locator('.cust-main');
      const side = page.locator('.cust-side');
      await expect(main).toBeVisible();
      await expect(side).toBeVisible();
      await expect(main.locator(mainSelector).first()).toBeVisible();
      await expect(side.locator('.att-item').first()).toBeVisible();
      await expect(side.locator('.panel-hd h3', { hasText: healthTitle })).toHaveCount(1);
      await expect(side.locator('.donut-wrap')).toHaveCount(1);
      // side by side: the main column is to the left of the side column, and the side column is the narrow one
      const m = (await main.boundingBox())!;
      const s = (await side.boundingBox())!;
      expect(s.x).toBeGreaterThan(m.x + m.width - 2);
      expect(s.width).toBeLessThan(m.width);
      // the page still scrolls when the pointer is over the side column
      await page.mouse.move(s.x + 40, s.y + 60);
      await page.mouse.wheel(0, 500);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    });

    test(`${tabName}: an attention item still applies its filter from the side column`, async ({ page }) => {
      await start(page);
      await goTab(page, tabName);
      await page.locator('.cust-side .att-item').first().click();
      if (tabName === 'Cloud') await expect(page.locator('.banner-warm').first()).toContainText('Showing only');
      else await expect.poll(() => page.locator('.dtable tbody tr').count()).toBeLessThan(15);
    });
  }
});

test.describe('Archive tab', () => {
  test('5 stat cards filter the accounts table and reset', async ({ page }) => {
    const errors = trackErrors(page);
    await start(page);
    await goTab(page, 'Archive');
    const cards = page.locator('.stat');
    await expect(cards).toHaveCount(5);
    const total = await page.locator('.dtable tbody tr').count();
    expect(total).toBeGreaterThan(50);
    for (const i of [1, 2, 3, 4]) {
      await cards.nth(i).click();
      await expect.poll(() => page.locator('.dtable tbody tr').count()).toBeLessThan(total);
      await cards.nth(0).click();
      await expect.poll(() => page.locator('.dtable tbody tr').count()).toBe(total);
    }
    expect(errors).toEqual([]);
  });

  test('coverage chart draws a smooth curve; health gauge and env pills work', async ({ page }) => {
    await start(page);
    await goTab(page, 'Archive');
    await expect(page.locator('.cov-wrap path.cov-line')).toHaveCount(1);
    const d = await page.locator('.cov-wrap path.cov-line').getAttribute('d');
    expect(d).toMatch(/C/); // cubic Bézier segments, not straight lines
    const total = await page.locator('.dtable tbody tr').count();
    await page.getByRole('button', { name: /^UAT \d+/ }).click();
    await expect.poll(() => page.locator('.dtable tbody tr').count()).toBeLessThan(total);
  });

  test('clicking an account opens the detail drawer; Esc closes it', async ({ page }) => {
    await start(page);
    await goTab(page, 'Archive');
    await page.locator('.dtable tbody tr').first().click();
    await expect(page.locator('.drawer')).toBeVisible();
    // a reachable account lists its capture folders; an unreachable one explains why instead
    await expect(page.locator('.drawer')).toContainText(/Capture folders|coverage|Timed out|allowlisted|unreachable|not found/i);
    await page.keyboard.press('Escape');
    await expect(page.locator('.drawer')).toHaveCount(0);
  });
});
