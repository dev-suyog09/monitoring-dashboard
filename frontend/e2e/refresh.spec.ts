import { expect, test, type Page } from '@playwright/test';
import { goTab, start } from './helpers';

/** Counts the automatic full checks the page runs by itself; the responses are the real inventory (fast, no Azure work). */
async function countChecks(page: Page) {
  const calls = { bots: 0, dbs: 0 };
  await page.route('**/api/bots/check**', async (route) => {
    calls.bots++;
    await route.fulfill({ json: await (await page.request.get('/api/bots')).json() });
  });
  await page.route('**/api/databases/check**', async (route) => {
    calls.dbs++;
    await route.fulfill({ json: await (await page.request.get('/api/databases')).json() });
  });
  return calls;
}

test.describe('Auto re-check follows the interval chosen in Settings', () => {
  // 0.05 minutes = 3 seconds, so the test does not have to wait minutes (the Settings panel offers 5 minutes and up)
  test('bots and databases re-check on their own, repeatedly, without anyone pressing Check', async ({ page }) => {
    const calls = await countChecks(page);
    await start(page, { settings: { autoMinutes: 0.05 } });
    await expect.poll(() => calls.bots, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
    await expect.poll(() => calls.dbs, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  });

  test('it also runs while you are looking at a different tab', async ({ page }) => {
    const calls = await countChecks(page);
    await start(page, { settings: { autoMinutes: 0.05 } });
    await goTab(page, 'Archive');
    const before = calls.bots + calls.dbs;
    await expect.poll(() => calls.bots + calls.dbs, { timeout: 30_000 }).toBeGreaterThan(before + 1);
  });

  test('"Off" in Settings stops the automatic checks', async ({ page }) => {
    const calls = await countChecks(page);
    await start(page, { settings: { autoMinutes: 0 } });
    await page.waitForTimeout(8000);
    expect(calls.bots + calls.dbs).toBe(0);
  });

  test('changing the interval in Settings takes effect without a reload', async ({ page }) => {
    const calls = await countChecks(page);
    await start(page, { settings: { autoMinutes: 0 } });
    await page.waitForTimeout(4000);
    expect(calls.bots).toBe(0);
    await page.evaluate(() => {
      localStorage.setItem('sam.settings', JSON.stringify({ autoMinutes: 0.05 }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'sam.settings' }));
    });
    await expect.poll(() => calls.bots, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  });

  test('the Cloud and Databases tabs show when the next automatic check happens', async ({ page }) => {
    await start(page, { settings: { autoMinutes: 15 } });
    await goTab(page, 'Cloud');
    await expect(page.getByText(/Auto re-check of all bots every 15 min/)).toBeVisible();
    await goTab(page, 'Data');
    await expect(page.getByText(/Auto re-check of all databases .* every 15 min/)).toBeVisible();
  });

  test('the wording follows the chosen interval (5 min, off)', async ({ page }) => {
    await start(page, { settings: { autoMinutes: 5 } });
    await expect(page.locator('.dash-foot')).toContainText('every 5 min');
    await goTab(page, 'Cloud');
    await expect(page.getByText(/Auto re-check of all bots every 5 min/)).toBeVisible();
    await page.evaluate(() => {
      localStorage.setItem('sam.settings', JSON.stringify({ autoMinutes: 0 }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'sam.settings' }));
    });
    await expect(page.locator('.dash-foot')).toContainText('re-check off');
    await expect(page.getByText(/Auto re-check of all bots/)).toHaveCount(0);
  });

  test('the Settings panel offers the intervals', async ({ page }) => {
    await start(page);
    await page.getByRole('button', { name: 'Settings' }).first().click();
    const options = await page.locator('.set-select').nth(1).locator('option').allInnerTexts();
    expect(options).toEqual(['Off', 'Every 5 minutes', 'Every 10 minutes', 'Every 15 minutes', 'Every 30 minutes', 'Every hour']);
  });
});
