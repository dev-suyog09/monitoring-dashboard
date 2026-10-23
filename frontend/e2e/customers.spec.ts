import { expect, test } from '@playwright/test';
import { clearFilter, customerRows, start, trackErrors } from './helpers';

test.describe('Customers tab', () => {
  test('environment pills narrow the list', async ({ page }) => {
    await start(page);
    const total = await customerRows(page).count();
    await page.getByRole('button', { name: /^PROD \d+/ }).click();
    expect(await customerRows(page).count()).toBeLessThan(total);
    await page.getByRole('button', { name: /^PROD \d+/ }).click();
    await expect(customerRows(page)).toHaveCount(total);
  });

  test('search: typing narrows, suggestions add a chip, clearing restores', async ({ page }) => {
    await start(page);
    const total = await customerRows(page).count();
    const box = page.locator('.wl input');
    await box.click();
    await box.fill('n');
    await expect(page.locator('.wl-suggest .wl-suggest-item').first()).toBeVisible();
    expect(await customerRows(page).count()).toBeLessThan(total);
    await page.locator('.wl-suggest .wl-suggest-item').first().click();
    await expect(page.locator('.wchip')).toHaveCount(1);
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(page.locator('.wchip')).toHaveCount(0);
    await expect(customerRows(page)).toHaveCount(total);
  });

  test('groups: save, apply, persist across reload, delete', async ({ page }) => {
    await start(page);
    const box = page.locator('.wl input');
    await box.click();
    await box.fill('n');
    await page.locator('.wl-suggest .wl-suggest-item').first().click();
    await page.getByRole('button', { name: /Save group/ }).click();
    await expect(page.locator('.sheet-title')).toHaveText('Save group');
    await page.locator('.sheet input').fill('E2E group');
    await page.locator('.sheet button', { hasText: /save/i }).last().click();
    await expect(page.locator('.sheet')).toHaveCount(0);
    await page.reload();
    await page.getByRole('button', { name: /^Groups/ }).click();
    await expect(page.locator('.wl-menu')).toContainText('E2E group');
    await page.locator('.wl-menu button', { hasText: '🗑' }).first().click();
    await page.reload();
    await page.getByRole('button', { name: /^Groups/ }).click();
    await expect(page.locator('.wl-menu')).not.toContainText('E2E group');
  });

  test('column sorting reverses the order', async ({ page }) => {
    await start(page);
    const first = () => page.locator('.cust-main .dtable tbody tr .cust-short').first().innerText();
    await page.locator('.cust-main .dtable th', { hasText: /customer/i }).click();
    const a = await first();
    await page.locator('.cust-main .dtable th', { hasText: /customer/i }).click();
    expect(await first()).not.toBe(a);
  });

  test('clicking a customer shows all its details right below the row (no button, no side panel)', async ({ page }) => {
    const errors = trackErrors(page);
    await start(page);
    await expect(page.getByRole('button', { name: /open details/ })).toHaveCount(0);
    await customerRows(page).first().click();
    await expect(page.locator('.sheet')).toHaveCount(0);
    await expect(page.locator('.cd-inline .cd-kpi')).toHaveCount(4);
    await expect(page.locator('.cd-inline .cd-sec-hd h4', { hasText: 'Bots' })).toBeVisible();
    await expect(page.locator('.cd-inline .cd-sec-hd h4', { hasText: 'Databases' })).toBeVisible();
    await customerRows(page).first().click();
    await expect(page.locator('.cd-inline')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('customers are listed by their full subscription name', async ({ page }) => {
    await start(page);
    await expect(customerRows(page).first().locator('.cust-short')).toContainText(/^AZU-/);
  });

  test('a customer with several SRD accounts can switch accounts in the panel', async ({ page }) => {
    await start(page);
    const multi = page.locator('.cust-main .dtable tbody tr[title]', { hasText: /[2-9] SRD accounts/ }).first();
    test.skip((await multi.count()) === 0, 'no multi-account customer in the data');
    await multi.click();
    const pills = page.locator('.cd-accts .pill');
    expect(await pills.count()).toBeGreaterThan(1);
    await pills.nth(1).click();
    await expect(pills.nth(1)).toHaveClass(/pill-on/);
  });
});
