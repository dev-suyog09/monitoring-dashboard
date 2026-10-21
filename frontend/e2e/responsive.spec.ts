import { expect, test, type Page } from '@playwright/test';
import { goTab, openSettings, closePanel, start, trackErrors } from './helpers';

const noSidewaysScroll = async (page: Page) => {
  const { sw, w } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  expect(sw).toBeLessThanOrEqual(w + 2);
};

for (const [name, size] of [
  ['phone', { width: 375, height: 812 }],
  ['tablet', { width: 768, height: 1024 }],
] as const) {
  test.describe(`${name} layout`, () => {
    test.use({ viewport: size });

    test('no sideways page scroll on any tab; bottom navigation is pinned', async ({ page }) => {
      const errors = trackErrors(page);
      await start(page);
      for (const t of ['Customers', 'Archive', 'Cloud', 'Data'] as const) {
        await goTab(page, t);
        await page.waitForTimeout(600);
        await noSidewaysScroll(page);
        const nav = await page.locator('.side-nav').boundingBox();
        expect(nav!.y + nav!.height).toBeGreaterThanOrEqual(size.height - 2);
        expect(nav!.width).toBeGreaterThanOrEqual(size.width - 4);
      }
      expect(errors).toEqual([]);
    });

    test('settings and details panels fit the screen', async ({ page }) => {
      await start(page);
      await openSettings(page);
      const sheet = await page.locator('.sheet').boundingBox();
      expect(sheet!.width).toBeLessThanOrEqual(size.width + 1);
      await closePanel(page);
      await page.locator('.cust-main .dtable tbody tr[title]').first().dblclick();
      await expect(page.locator('.sheet')).toBeVisible();
      expect((await page.locator('.sheet').boundingBox())!.width).toBeLessThanOrEqual(size.width + 1);
      await closePanel(page);
    });

    test('charts open and stay inside the screen', async ({ page }) => {
      await start(page);
      await page.locator('.insights').click();
      await expect(page.locator('.chart-grid')).toBeVisible();
      await page.waitForTimeout(700);
      await noSidewaysScroll(page);
    });
  });
}

test.describe('desktop sidebar vs content', () => {
  test('pinned sidebar never overlaps the page content', async ({ page }) => {
    await start(page);
    const nav = await page.locator('.side-nav').boundingBox();
    const dash = await page.locator('.dash').boundingBox();
    expect(dash!.x).toBeGreaterThanOrEqual(nav!.x + nav!.width - 1);
  });
});
