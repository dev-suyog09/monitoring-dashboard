import { expect, test, type Page } from '@playwright/test';
import { clearFilter, customerRows, start, trackErrors } from './helpers';

const metric = (page: Page, label: string) => page.locator('.mstrip .metric', { hasText: label });

test.describe('Customers tab', () => {
  test('metric cards filter the table and toggle off', async ({ page }) => {
    await start(page);
    const total = await customerRows(page).count();
    expect(total).toBeGreaterThan(20);

    await metric(page, 'Archive complete').click();
    await expect(page.locator('.cust-main .banner-warm')).toContainText('Showing only');
    expect(await customerRows(page).count()).toBeLessThan(total);

    await metric(page, 'Archive complete').click(); // a second click clears it
    await expect(customerRows(page)).toHaveCount(total);

    await metric(page, 'Databases healthy').click();
    expect(await customerRows(page).count()).toBeLessThan(total);
    await page.locator('.cust-main .banner-warm .pill').click();
    await expect(customerRows(page)).toHaveCount(total);
  });

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

  test('open details shows archive, bots and databases inline', async ({ page }) => {
    const errors = trackErrors(page);
    await start(page);
    await customerRows(page).first().click();
    await page.getByRole('button', { name: /open details/ }).first().click();
    await expect(page.locator('.cd-inline .cd-kpi')).toHaveCount(4);
    await expect(page.locator('.cd-inline .cd-sec-hd h4', { hasText: 'Bots' })).toBeVisible();
    await expect(page.locator('.cd-inline .cd-sec-hd h4', { hasText: 'Databases' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('single click expands SRD accounts and "open details" opens them right below the row', async ({ page }) => {
    await start(page);
    await customerRows(page).first().click();
    await page.getByRole('button', { name: /open details/ }).first().click();
    await expect(page.locator('.sheet')).toHaveCount(0); // no side panel
    await expect(page.locator('.cd-inline .cd-kpi')).toHaveCount(4);
    await page.getByRole('button', { name: /hide details/ }).first().click();
    await expect(page.locator('.cd-inline')).toHaveCount(0);
  });

  test('a customer with several SRD accounts can switch accounts in the panel', async ({ page }) => {
    await start(page);
    const multi = page.locator('.cust-main .dtable tbody tr[title]', { hasText: /[2-9] accts/ }).first();
    test.skip((await multi.count()) === 0, 'no multi-account customer in the data');
    await multi.click();
    await page.getByRole('button', { name: /open details/ }).first().click();
    const pills = page.locator('.cd-accts .pill');
    expect(await pills.count()).toBeGreaterThan(1);
    await pills.nth(1).click();
    await expect(pills.nth(1)).toHaveClass(/pill-on/);
  });

  test('Needs attention: item opens details inline; Overall health slices filter the table', async ({ page }) => {
    await start(page);
    await page.locator('.att-item').first().click();
    await expect(page.locator('.cd-inline')).toBeVisible();

    const total = await customerRows(page).count();
    for (const label of ['Healthy', 'Critical']) {
      const li = page.locator('.cust-side .donut-legend li', { hasText: label });
      const n = Number(await li.locator('b').innerText());
      await li.click();
      await expect(page.locator('.cust-main .banner-warm')).toContainText('Showing only');
      await expect(customerRows(page)).toHaveCount(n);
      await clearFilter(page);
      await expect(customerRows(page)).toHaveCount(total);
    }
  });

  test('side column does not trap the mouse wheel (the page still scrolls over it)', async ({ page }) => {
    await start(page);
    const box = await page.locator('.cust-side').boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + 40, box!.y + 60);
    await page.mouse.wheel(0, 500);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  });
});
