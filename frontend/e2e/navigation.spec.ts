import { expect, test } from '@playwright/test';
import { goTab, start, trackErrors } from './helpers';

test.describe('shell and navigation', () => {
  test('loads with greeting, profile, sidebar and metrics', async ({ page }) => {
    const errors = trackErrors(page);
    await start(page);
    await expect(page.locator('h1')).toContainText(/Good (morning|afternoon|evening), \w+!/);
    await expect(page.locator('.hdr-user')).toBeVisible();
    await expect(page.locator('.side-item')).toHaveCount(7); // 6 tabs (incl. calls and checklist) + settings
    await expect(page.locator('.mstrip .metric')).toHaveCount(5);
    expect(errors).toEqual([]);
  });

  test('every tab opens and shows its own content', async ({ page }) => {
    const errors = trackErrors(page);
    await start(page);
    await goTab(page, 'Archive');
    await expect(page.locator('.stat')).toHaveCount(5);
    await goTab(page, 'Cloud');
    await expect(page.locator('.mstrip .metric')).toHaveCount(5);
    await goTab(page, 'Data');
    await expect(page.locator('.mstrip .metric')).toHaveCount(6);
    await goTab(page, 'Customers');
    await expect(page.locator('.mstrip .metric')).toHaveCount(5);
    expect(errors).toEqual([]);
  });

  test('tab switch starts at the top of the page', async ({ page }) => {
    await start(page);
    await page.evaluate(() => window.scrollTo(0, 600));
    await goTab(page, 'Archive');
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(5);
  });

  test('tab switch cross-fades (View Transition) when motion is allowed', async ({ page }) => {
    await start(page);
    const supported = await page.evaluate(() => 'startViewTransition' in document);
    test.skip(!supported, 'View Transitions are not supported by this browser');
    const flagged = page.evaluate(
      () =>
        new Promise<boolean>((res) => {
          const root = document.documentElement;
          const mo = new MutationObserver(() => {
            if (root.classList.contains('vt')) {
              mo.disconnect();
              res(true);
            }
          });
          mo.observe(root, { attributes: true, attributeFilter: ['class'] });
          setTimeout(() => res(false), 4000);
        }),
    );
    await page.locator('.side-item', { hasText: 'Cloud' }).first().click();
    expect(await flagged).toBe(true);
    await expect(page.locator('html')).not.toHaveClass(/\bvt\b/, { timeout: 5000 });
  });

  test('header icon buttons are all present and labelled', async ({ page }) => {
    await start(page);
    for (const name of [/Switch theme/, /Settings/, /full screen/i, /otification/i]) {
      await expect(page.getByRole('button', { name }).first()).toBeVisible();
    }
  });

  test('Ctrl+K focuses the search box', async ({ page }) => {
    await start(page);
    await page.keyboard.press('Control+k');
    await expect(page.locator('.wl input')).toBeFocused();
  });
});
