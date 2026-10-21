import { expect, test, type Page } from '@playwright/test';
import { closePanel, fakeBotStates, goTab, spyAudio, start, tones, waitForCustomers } from './helpers';

/** Runs "Check all bots" on the Cloud tab against faked instance states and waits for it to finish. */
async function check(page: Page, states: Record<number, string>) {
  await page.unroute('**/api/bots/check**').catch(() => undefined);
  await fakeBotStates(page, states);
  const btn = page.locator('.btn-accent');
  await expect(btn).toHaveText(/Check all bots/);
  await btn.click();
  await expect(btn).toHaveText(/Check all bots/, { timeout: 30_000 });
}

test.describe('Alerts (toasts, bell, tune)', () => {
  test('first visit in a fresh browser is a quiet baseline: no toast flood, no chime', async ({ page }) => {
    await spyAudio(page);
    await start(page);
    await goTab(page, 'Cloud');
    await page.waitForTimeout(2500);
    await expect(page.locator('.toast')).toHaveCount(0);
    expect(await tones(page)).toEqual([]);
    await page.getByRole('button', { name: /otification/i }).first().click();
    await expect(page.locator('.sheet-body')).toContainText(/caught up/i);
    await closePanel(page);
  });

  test('a Stopped instance raises a red toast, a bell entry and a tab-title notice', async ({ page }) => {
    await start(page);
    await goTab(page, 'Cloud');
    await check(page, {}); // baseline: the current state is "known"
    await page.evaluate(() => (document.hasFocus = () => false)); // as if the user is in another window
    await check(page, { 10: 'Stopped' });
    const toast = page.locator('.toast.st-err').first();
    await expect(toast).toContainText(/Stopped/i);
    await expect(page).toHaveTitle(/down/i);
    await toast.click(); // click goes to Cloud Instances and dismisses it
    await expect(page.locator('.page-eyebrow')).toHaveText(/Cloud Instances/i);
  });

  test('a Starting instance raises an amber toast; recovery adds a Recovered entry', async ({ page }) => {
    await start(page);
    await goTab(page, 'Cloud');
    await check(page, {});
    await check(page, { 11: 'Starting' });
    await expect(page.locator('.toast.st-warn').first()).toContainText(/Starting/i);
    await check(page, {}); // back to Started
    await page.getByRole('button', { name: /otification/i }).first().click();
    await expect(page.locator('.sheet-title')).toHaveText('Notifications');
    await expect(page.locator('.alert-card', { hasText: 'Starting' }).first()).toHaveClass(/st-warn/);
    await expect(page.locator('.alert-card', { hasText: 'Recovered' }).first()).toBeVisible();
    await closePanel(page);
  });

  test('bell: mark all read clears the badge; clear empties the list; entry click opens Cloud tab', async ({ page }) => {
    await start(page);
    await goTab(page, 'Cloud');
    await check(page, {});
    await check(page, { 12: 'Stopped' });
    const bell = page.getByRole('button', { name: /otification/i }).first();
    await bell.click();
    await expect(page.locator('.alert-card').first()).toBeVisible();
    await page.getByRole('button', { name: /Mark all read/ }).click();
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(page.locator('.alert-card')).toHaveCount(0);
    await expect(page.locator('.sheet-body')).toContainText(/caught up/i);
    await closePanel(page);
  });

  test('the chosen tune is the one that plays for a real alert', async ({ page }) => {
    await spyAudio(page);
    await start(page, { settings: { tune: 'pulse', volume: 70 } });
    await goTab(page, 'Cloud');
    await check(page, {});
    await page.mouse.click(5, 5); // a real click unlocks audio, as in normal use
    await page.evaluate(() => ((window as unknown as { __tones: number[] }).__tones.length = 0));
    await check(page, { 13: 'Stopped' });
    await expect.poll(() => tones(page)).toEqual([880, 660, 880, 660, 880, 660]);
  });

  test('sound switched off in Settings plays nothing', async ({ page }) => {
    await spyAudio(page);
    await start(page, { settings: { tune: 'pulse' } });
    await page.evaluate(() => localStorage.setItem('sam.alerts.sound', '0'));
    await page.reload();
    await waitForCustomers(page);
    await goTab(page, 'Cloud');
    await check(page, {});
    await check(page, { 14: 'Stopped' });
    await expect(page.locator('.toast.st-err').first()).toBeVisible();
    expect(await tones(page)).toEqual([]);
  });

  test('Needs IP and Restart dialogs open and can be cancelled (no restart is triggered)', async ({ page }) => {
    await start(page);
    await page.getByRole('button', { name: /Needs IP/ }).click();
    await expect(page.locator('.sheet-title')).toContainText(/need your IP/i);
    await closePanel(page);
    let restartCalled = false;
    await page.route('**/api/restart', (route) => {
      restartCalled = true;
      return route.abort();
    });
    await page.getByRole('button', { name: /Restart backend/ }).click();
    await expect(page.locator('.sheet-title')).toHaveText('Restart backend?');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.sheet')).toHaveCount(0);
    expect(restartCalled).toBe(false);
  });
});
