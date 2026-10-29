import { expect, test, type Page } from '@playwright/test';
import { clearFilter, closePanel, customerRows, start, trackErrors } from './helpers';

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

  test('"Archive missing" card: counts customers not fully archived today, filters the table, and complements "Archive complete"', async ({ page }) => {
    await start(page);
    await page.waitForTimeout(1500); // count-up animation
    const total = await customerRows(page).count();
    const number = async (label: string) => Number(((await metric(page, label).locator('.metric-val').innerText()) || '').replace(/\D/g, ''));
    const complete = await number('Archive complete');
    const missing = await number('Archive missing');
    expect(missing).toBeGreaterThan(-1);
    await expect(metric(page, 'Archive missing')).toContainText(/of \d+ with SRD|none missing/);
    // complete + missing = every customer that has an SRD account
    await expect(page.locator('.metric-sub', { hasText: /with an SRD account/ })).toContainText(String(complete + missing));
    await metric(page, 'Archive missing').click();
    await expect(page.locator('.cust-main .banner-warm')).toContainText('archives missing today');
    await expect(customerRows(page)).toHaveCount(missing);
    expect(missing).toBeLessThan(total + 1);
    await metric(page, 'Archive missing').click(); // second click clears
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

  test('double-click opens the details panel; Esc closes it', async ({ page }) => {
    const errors = trackErrors(page);
    await start(page);
    await customerRows(page).first().dblclick();
    await expect(page.locator('.sheet')).toBeVisible();
    await expect(page.locator('.cd-kpi')).toHaveCount(4);
    await expect(page.locator('.cd-sec-hd h4', { hasText: 'Bots' })).toBeVisible();
    await expect(page.locator('.cd-sec-hd h4', { hasText: 'Databases' })).toBeVisible();
    await closePanel(page);
    expect(errors).toEqual([]);
  });

  test('single click expands SRD accounts and "open details" opens the panel', async ({ page }) => {
    await start(page);
    await customerRows(page).first().click();
    await page.getByRole('button', { name: /open details/ }).first().click();
    await expect(page.locator('.sheet')).toBeVisible();
    await page.locator('.sheet .icirc').click();
    await expect(page.locator('.sheet')).toHaveCount(0);
  });

  test('a customer with several SRD accounts can switch accounts in the panel', async ({ page }) => {
    await start(page);
    const multi = page.locator('.cust-main .dtable tbody tr[title]', { hasText: /[2-9] accts/ }).first();
    test.skip((await multi.count()) === 0, 'no multi-account customer in the data');
    await multi.dblclick();
    const pills = page.locator('.cd-accts .pill');
    expect(await pills.count()).toBeGreaterThan(1);
    await pills.nth(1).click();
    await expect(pills.nth(1)).toHaveClass(/pill-on/);
  });

  test('Needs attention: item opens details; Overall health slices filter the table', async ({ page }) => {
    await start(page);
    await page.locator('.att-item').first().click();
    await expect(page.locator('.sheet')).toBeVisible();
    await closePanel(page);

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

test.describe('Visual insights (charts) on Customers', () => {
  test('the whole bar opens and closes the charts; Enter works too', async ({ page }) => {
    await start(page);
    await expect(page.locator('.chart-grid')).toHaveCount(0);
    await page.locator('.insights .ins-text').click(); // anywhere on the bar, not just the button
    await expect(page.locator('.chart-grid')).toBeVisible();
    await expect(page.locator('.chart-grid .donut-wrap')).toHaveCount(3);
    await page.locator('.insights').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.chart-grid')).toHaveCount(0);
  });

  test('chart legend and bar segments filter the customers', async ({ page }) => {
    await start(page);
    const total = await customerRows(page).count();
    await page.locator('.insights').click();
    await page.locator('.chart-grid .donut-legend li', { hasText: 'Stopped' }).click();
    await expect(page.locator('.cust-main .banner-warm')).toContainText(/stopped/i);
    expect(await customerRows(page).count()).toBeLessThan(total);
    await clearFilter(page);
    await page.locator('.chart-grid .hbar-seg.clickable').first().click();
    await expect(page.locator('.cust-main .banner-warm')).toContainText('Showing only');
  });

  test('ring centre text is readable (>= 10px), upright and fits the ring', async ({ page }) => {
    await start(page);
    await page.locator('.insights').click();
    const label = page.locator('.chart-grid .donut-wrap .dc-label').first();
    await expect(label).toBeVisible();
    expect(await label.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(10);
    expect(((await label.textContent()) ?? '').length).toBeLessThanOrEqual(17);
  });

  test('charts are flat by default: no tilted stage, no extrusion, no pie', async ({ page }) => {
    await start(page);
    await page.locator('.insights').click();
    await expect(page.locator('html')).toHaveAttribute('data-charts', 'flat');
    const stage = page.locator('.chart-grid .stage3d').first();
    await expect(stage).toBeVisible();
    await expect(stage).toHaveClass(/flat/);
    expect(await stage.locator('.stage3d-layer.side').count()).toBe(0);
    expect(await page.locator('.chart-grid .pie3').count()).toBe(0);
  });

  test('3D charts on: exploded pie with a callout (share, name, count) for every slice', async ({ page }) => {
    await start(page, { settings: { charts3d: true } });
    await page.locator('.insights').click();
    const pie = page.locator('.chart-grid .pie3').first();
    await expect(pie).toBeVisible();
    const slices = await pie.locator('.pie3-slice').count();
    expect(slices).toBeGreaterThanOrEqual(1);
    expect(await pie.locator('.pie3-call').count()).toBe(slices);
    await expect(pie.locator('.pie3-pct').first()).toHaveText(/^\d+%$/);
    await expect(pie.locator('.pie3-sub').first()).toHaveText(/^\d+ of \d+$/);
    // hovering a slice pulls it further out
    const before = await pie.locator('.pie3-slice').first().evaluate((el) => getComputedStyle(el).transform);
    await pie.locator('.pie3-slice').first().hover();
    await expect.poll(() => pie.locator('.pie3-slice').first().evaluate((el) => getComputedStyle(el).transform)).not.toBe(before);
  });

  test('the 3D switch on the Visual insights bar flips the charts and is saved', async ({ page }) => {
    await start(page);
    await page.locator('.insights').click();
    await page.getByRole('switch', { name: '3D charts' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-charts', '3d');
    await expect(page.locator('.chart-grid .pie3').first()).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sam.settings') || '{}').charts3d)).toBe(true);
    await page.getByRole('switch', { name: '3D charts' }).click();
    await expect(page.locator('.chart-grid .pie3')).toHaveCount(0);
  });

});
