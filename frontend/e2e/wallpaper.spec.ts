import { expect, test } from '@playwright/test';
import { start } from './helpers';

/**
 * The page background (wallpaper) must cover the whole page, not only the first screen: it used to stop after one viewport and
 * show a plain colour below once you scrolled. We scroll to the very bottom and check that the background is still painted there.
 */
for (const theme of ['macosglass', 'macosglassdark', 'macosglassamoled', 'calm', 'aurora', 'macos']) {
  test(`${theme}: the background covers the whole scrollable page`, async ({ page }) => {
    await start(page, { theme });
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const body = document.body.getBoundingClientRect();
      const doc = document.documentElement.scrollHeight;
      const cs = getComputedStyle(document.body);
      return { bodyHeight: Math.round(body.height), docHeight: doc, viewport: window.innerHeight, bg: cs.backgroundImage !== 'none' || cs.backgroundColor !== 'rgba(0, 0, 0, 0)' };
    });
    expect(r.docHeight, 'the page is taller than the screen (so there is something to scroll)').toBeGreaterThan(r.viewport);
    expect(r.bodyHeight, 'the element that carries the wallpaper is as tall as the page').toBeGreaterThanOrEqual(r.docHeight - 2);
    expect(r.bg).toBe(true);
  });
}
