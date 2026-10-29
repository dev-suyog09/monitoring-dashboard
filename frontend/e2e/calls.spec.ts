import { expect, test, type Page } from '@playwright/test';
import { closePanel, customerRows, start } from './helpers';

/** Concurrent calls (Application Insights) are ON DEMAND: nothing may be requested until the button is pressed. */
const now = Date.now();
const iso = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();

const answer = (hours: number) => ({
  subscriptionId: 'sub',
  hours,
  generatedAt: new Date().toISOString(),
  groups: [
    {
      name: 'botAppInsightsaaa',
      resourceGroup: 'xyzprdntx-uaen-grp-rec-01',
      calls: 20,
      peak: 41,
      load: 55.5,
      lastSeen: iso(1),
      series: [{ t: 'a', v: 5 }, { t: 'b', v: 41 }, { t: 'c', v: 20 }],
      instances: [
        { instance: 'bot_1', calls: 12, gross: 14, load: 41.2, peak: 30, avg: 10.3, lastSeen: iso(1) },
        { instance: 'bot_2', calls: 8, gross: null, load: 55.5, peak: 25, avg: 7, lastSeen: iso(1) },
      ],
    },
    { name: 'botAppInsightsbbb', resourceGroup: 'xyzprdntx-uaen-grp-rec-02', calls: 0, peak: 3, load: 0, lastSeen: iso(45), series: [], instances: Array.from({ length: 12 }, (_, n) => ({ instance: `bot_${n}`, calls: 12 - n, gross: 0, load: 0, peak: 3, avg: 0.1, lastSeen: iso(45) })) },
    { name: 'botAppInsightsccc', resourceGroup: 'xyzprdntx-uaen-grp-rec-03', calls: null, peak: null, load: null, lastSeen: null, series: [], instances: [] },
    { name: 'botAppInsightsddd', resourceGroup: 'xyzprdntx-uaen-grp-rec-04', calls: null, peak: null, load: null, lastSeen: null, series: [], instances: [], error: 'No permission to read this Application Insights.' },
  ],
});

async function spy(page: Page, status = 200) {
  const calls: string[] = [];
  await page.route(/\/api\/calls\//, (route) => {
    const u = new URL(route.request().url());
    calls.push(`${route.request().method()} ${u.pathname}?${u.searchParams.toString()}`);
    if (status !== 200) return route.fulfill({ status, json: { error: 'Could not read the concurrent calls right now.' } });
    return route.fulfill({ json: answer(Number(u.searchParams.get('hours'))) });
  });
  return calls;
}

test.describe('Concurrent calls (on demand)', () => {
  test('nothing is requested at start-up, on any tab, or when the details panel opens', async ({ page }) => {
    const calls = await spy(page);
    await start(page);
    await customerRows(page).first().dblclick();
    await expect(page.locator('.sheet')).toBeVisible();
    await expect(page.getByLabel('Concurrent calls')).toContainText('Not loaded');
    await page.waitForTimeout(1500);
    expect(calls).toEqual([]);
    await closePanel(page);
    for (const t of ['Archive', 'Cloud', 'Data']) await page.locator('.side-item', { hasText: t }).first().click();
    await page.waitForTimeout(800);
    expect(calls).toEqual([]);
  });

  test('pressing the button asks once for this customer and shows calls, peak, load, trend and instances', async ({ page }) => {
    const calls = await spy(page);
    await start(page);
    await customerRows(page).first().dblclick();
    const sec = page.getByLabel('Concurrent calls');
    await sec.getByRole('button', { name: 'Check concurrent calls' }).click();
    await expect(sec.locator('.cc-group')).toHaveCount(4);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^POST \/api\/calls\/check\?subscriptionId=[^&]+&hours=1$/);
    const first = sec.locator('.cc-group').first();
    await expect(first).toContainText('rec-01');
    await expect(first.locator('.cc-nums b').nth(0)).toHaveText('20');
    await expect(first.locator('.cc-nums b').nth(1)).toHaveText('41');
    await expect(first.locator('.cc-nums b').nth(2)).toHaveText('56%');
    await expect(sec.locator('.cc-chart .ch-svg')).toBeVisible();
    await expect(sec.locator('.cc-stat')).toHaveCount(4);
    await expect(first.locator('.cc-inst tbody tr')).toHaveCount(2);
    await expect(first.locator('.cc-seen.cc-warn')).toHaveCount(0);
    // a bot that has gone quiet is flagged; one with no readings and one without permission say so
    await expect(sec.locator('.cc-group').nth(1).locator('.cc-seen.cc-warn')).toHaveCount(1);
    await expect(sec.locator('.cc-group').nth(2)).toContainText('no concurrent-call readings');
    await expect(sec.locator('.cc-group').nth(3)).toContainText('No permission');
    // a group with many bot instances shows the busiest few first
    const many = sec.locator('.cc-group').nth(1);
    await expect(many.locator('.cc-inst tbody tr')).toHaveCount(6);
    await many.getByRole('button', { name: 'Show all 12 bot instances' }).click();
    await expect(many.locator('.cc-inst tbody tr')).toHaveCount(12);
    // re-check and a longer period
    await sec.getByRole('radio', { name: '24 hours' }).click();
    await sec.getByRole('button', { name: /Re-check/ }).click();
    await expect.poll(() => calls.length).toBe(2);
    expect(calls[1]).toMatch(/hours=24$/);
    await expect(sec).toContainText('Last 24 hours');
  });

  test('a failure is shown in the panel and nothing is retried by itself', async ({ page }) => {
    const calls = await spy(page, 502);
    await start(page);
    await customerRows(page).first().dblclick();
    const sec = page.getByLabel('Concurrent calls');
    await sec.getByRole('button', { name: 'Check concurrent calls' }).click();
    await expect(sec.locator('.cd-err')).toContainText('Could not read');
    await page.waitForTimeout(1500);
    expect(calls).toHaveLength(1);
  });

  test('closing the panel drops the result: reopening starts "Not loaded" again', async ({ page }) => {
    const calls = await spy(page);
    await start(page);
    await customerRows(page).first().dblclick();
    await page.getByLabel('Concurrent calls').getByRole('button', { name: 'Check concurrent calls' }).click();
    await expect(page.locator('.cc-group').first()).toBeVisible();
    await closePanel(page);
    await customerRows(page).first().dblclick();
    await expect(page.getByLabel('Concurrent calls')).toContainText('Not loaded');
    expect(calls).toHaveLength(1);
  });
});
