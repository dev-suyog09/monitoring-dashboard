import { test } from '@playwright/test';
import { goTab, start } from './helpers';

/**
 * Not assertions: screenshots of every theme on every tab, attached to the HTML report (`npm run e2e:report`) so a human
 * can flip through them quickly after a UI change.
 */
const THEMES = ['dark', 'calm', 'aurora', 'emerald', 'light', 'sunset'];
const TABS = ['Customers', 'Archive', 'Cloud', 'Data'] as const;

for (const theme of THEMES) {
  test(`screenshots · ${theme}`, async ({ page }, testInfo) => {
    await start(page, { theme });
    for (const t of TABS) {
      await goTab(page, t);
      await page.waitForTimeout(1200); // entry animations
      await testInfo.attach(`${theme}-${t}`, { body: await page.screenshot({ fullPage: false }), contentType: 'image/png' });
    }
  });
}
