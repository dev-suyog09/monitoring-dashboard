import { expect, test, type Page } from '@playwright/test';
import { customerRows, start } from './helpers';

/** The Concurrent Calls tab against a stand-in for the series endpoint. Nothing may be read until Load is pressed. */
const T0 = Date.now() - 60 * 60_000;
const times = Array.from({ length: 12 }, (_, i) => new Date(T0 + i * 5 * 60_000).toISOString());

function group(rg: string, bots: number, quietLast = false) {
  const instances = Array.from({ length: bots }, (_, i) => `MicrosoftTeams.RecordingService_IN_${i}`);
  const cells: [number, number, number][] = [];
  instances.forEach((_, ii) => times.forEach((_t, ti) => cells.push([ti, ii, (ii % 4) + (ti % 3) + (ii === 0 ? 5 : 0)])));
  return {
    name: `botAppInsights${rg}`,
    resourceGroup: rg,
    instances,
    lastSeen: instances.map((_, i) => (quietLast && i === bots - 1 ? new Date(Date.now() - 45 * 60_000).toISOString() : new Date(Date.now() - 60_000).toISOString())),
    times,
    cells,
  };
}

async function fake(page: Page) {
  const calls: string[] = [];
  await page.route(/\/api\/calls\//, (route) => {
    const u = new URL(route.request().url());
    calls.push(`${u.pathname}?${u.searchParams.toString()}`);
    return route.fulfill({
      json: {
        subscriptionId: u.searchParams.get('subscriptionId'),
        hours: Number(u.searchParams.get('hours')),
        bin: 5,
        metric: u.searchParams.get('metric'),
        agg: u.searchParams.get('agg'),
        generatedAt: new Date().toISOString(),
        groups: [group('xyzprdntx-uaen-grp-rec-01', 6), group('xyzprdntx-uaen-grp-rec-02', 4, true)],
      },
    });
  });
  return calls;
}

/** The main chart card (its label must not be confused with 'Chart settings' or the svg's own label). */
const chartCard = (page: Page) => page.locator('section[aria-label="Chart"]');

async function openTab(page: Page) {
  await page.locator('.side-item', { hasText: 'Calls' }).first().click();
  await expect(page.locator('.page-eyebrow')).toHaveText(/Concurrent Calls/i);
}

async function pickFirstCustomer(page: Page) {
  await page.locator('.cv-pick-btn').click();
  await page.getByRole('listbox', { name: 'Customers' }).locator('label').first().click();
  await page.keyboard.press('Escape');
}

test.describe('Concurrent Calls tab (on demand)', () => {
  test('opening the tab, and changing every control, reads nothing until Load is pressed', async ({ page }) => {
    const calls = await fake(page);
    await start(page);
    await openTab(page);
    await expect(page.getByLabel('Not loaded')).toContainText('on demand');
    await pickFirstCustomer(page);
    await page.getByLabel('Metric').selectOption('load');
    await page.getByLabel('Aggregation').selectOption('avg');
    await page.getByRole('radio', { name: '24 hours' }).click();
    await page.waitForTimeout(1200);
    expect(calls).toEqual([]);
    await expect(page.getByRole('button', { name: /Load/ })).toBeEnabled();
  });

  test('Load asks once per customer with the chosen settings and draws KPIs, chart, groups, heatmap and table', async ({ page }) => {
    const calls = await fake(page);
    await start(page);
    await openTab(page);
    await expect(page.getByRole('button', { name: /Load/ })).toBeDisabled(); // no customer yet
    await pickFirstCustomer(page);
    await page.getByRole('button', { name: /Load/ }).click();
    await expect(page.locator('.cv-kpi')).toHaveCount(6);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^\/api\/calls\/series\?subscriptionId=[^&]+&hours=6&metric=calls&agg=avg$/);
    await expect(page.getByLabel('What stands out').locator('li')).toHaveCount(4); // written insights, not only charts
    await expect(page.getByLabel('What stands out')).toContainText('bots');
    await expect(chartCard(page).locator('.ch-svg')).toBeVisible();
    await expect(chartCard(page).locator('.ch-legend button')).toHaveCount(2); // split by recording group by default
    await expect(page.getByLabel('Recording groups').locator('.ch-bars li')).toHaveCount(2);
    await expect(page.getByLabel('Heatmap').locator('.ch-svg rect').first()).toBeVisible();
    await expect(page.getByLabel('Bot instances').locator('tbody tr')).toHaveCount(10);
    await expect(page.locator('.cv-count')).toHaveText('10 of 10 bots');
    await expect(page.locator('.cv-kpi', { hasText: 'Bots reporting' })).toContainText('9/10'); // one bot has been quiet for 45 minutes
    await expect(page.getByLabel('Bot instances').locator('tr.quiet')).toHaveCount(1);
  });

  test('after the first Load, changing metric, aggregation or range re-reads', async ({ page }) => {
    const calls = await fake(page);
    await start(page);
    await openTab(page);
    await pickFirstCustomer(page);
    await page.getByRole('button', { name: /Load/ }).click();
    await expect(page.locator('.cv-kpi').first()).toBeVisible();
    await page.getByLabel('Metric').selectOption('load');
    await expect.poll(() => calls.length).toBe(2);
    expect(calls[1]).toMatch(/metric=load/);
    await page.getByRole('radio', { name: '7 days' }).click();
    await expect.poll(() => calls.length).toBe(3);
    expect(calls[2]).toMatch(/hours=168/);
    await page.getByLabel('Aggregation').selectOption('min');
    await expect.poll(() => calls.length).toBe(4);
    expect(calls[3]).toMatch(/agg=min/);
  });

  test('filters narrow what is shown without any new request', async ({ page }) => {
    const calls = await fake(page);
    await start(page);
    await openTab(page);
    await pickFirstCustomer(page);
    await page.getByRole('button', { name: /Load/ }).click();
    await expect(page.locator('.cv-count')).toHaveText('10 of 10 bots');
    const n = calls.length;
    await page.getByRole('button', { name: /rec-02/ }).first().click(); // switch a recording group off
    await expect(page.locator('.cv-count')).toHaveText('6 of 10 bots');
    await page.getByRole('button', { name: /Clear filters/ }).click();
    await page.getByLabel('Bot instance contains').fill('IN_3');
    await expect(page.locator('.cv-count')).toHaveText('2 of 10 bots');
    await page.getByRole('button', { name: /Clear filters/ }).click();
    await page.getByLabel(/Only bots that reported/).check();
    await expect(page.locator('.cv-count')).toHaveText('9 of 10 bots');
    expect(calls.length).toBe(n);
  });

  test('split by bot instance shows the busiest bots as separate lines; a legend entry can be switched off', async ({ page }) => {
    await fake(page);
    await start(page);
    await openTab(page);
    await pickFirstCustomer(page);
    await page.getByLabel('Split by').selectOption('instance');
    await page.getByRole('button', { name: /Load/ }).click();
    const legend = chartCard(page).locator('.ch-legend button');
    await expect(legend).toHaveCount(10);
    await legend.first().click();
    await expect(legend.first()).toHaveAttribute('aria-pressed', 'false');
    await page.getByLabel('Split by').selectOption('none');
    await expect(chartCard(page).locator('.ch-legend')).toHaveCount(0);
  });

  test('hovering the chart shows the values at that moment', async ({ page }) => {
    await fake(page);
    await start(page);
    await openTab(page);
    await pickFirstCustomer(page);
    await page.getByRole('button', { name: /Load/ }).click();
    await chartCard(page).locator('.ch-svg rect').first().hover(); // scrolls the chart into view first
    await expect(page.locator('.ch-tip')).toBeVisible();
    await expect(page.locator('.ch-tip')).toContainText('rec-0');
  });

  test('sorting the table, showing all rows, and exporting a CSV', async ({ page }) => {
    await fake(page);
    await start(page);
    await openTab(page);
    await pickFirstCustomer(page);
    await page.getByRole('button', { name: /Load/ }).click();
    const rows = page.getByLabel('Bot instances').locator('tbody tr');
    await expect(rows).toHaveCount(10);
    await page.getByLabel('Bot instances').getByRole('button', { name: /^Bot/ }).click();
    await expect(page.getByLabel('Bot instances').locator('th[aria-sort="descending"]')).toHaveCount(1);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /CSV/ }).click()]);
    expect(download.suggestedFilename()).toMatch(/^concurrent-calls-calls-.*\.csv$/);
  });

  test('"Full view" in a customer panel opens this tab with the customer chosen, still unloaded', async ({ page }) => {
    const calls = await fake(page);
    await start(page);
    await customerRows(page).first().dblclick();
    await page.getByLabel('Concurrent calls').getByRole('button', { name: /Full view/ }).click();
    await expect(page.locator('.page-eyebrow')).toHaveText(/Concurrent Calls/i);
    await expect(page.locator('.cv-pick-btn .cv-chip')).toHaveCount(1);
    await expect(page.getByLabel('Not loaded')).toBeVisible();
    await page.waitForTimeout(800);
    expect(calls).toEqual([]);
  });
});
