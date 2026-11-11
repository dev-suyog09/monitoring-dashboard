import { expect, test } from '@playwright/test';
import { goTab, start } from './helpers';

const now = Date.now();
const answer = (hours: number) => ({
  subscriptionId: 'sub',
  hours,
  generatedAt: new Date(now).toISOString(),
  groups: [
    {
      name: 'botAppInsightsaaa',
      resourceGroup: 'xyzprdntx-uaen-grp-rec-01',
      calls: 20,
      peak: 41,
      load: 55.5,
      lastSeen: new Date(now - 60_000).toISOString(),
      series: [{ t: 'a', v: 5 }, { t: 'b', v: 41 }],
      instances: [{ instance: 'bot_1', calls: 12, gross: 14, load: 41.2, peak: 30, avg: 10.3, lastSeen: new Date(now - 60_000).toISOString() }],
    },
  ],
});

const archiveRows = (page: import('@playwright/test').Page) => page.locator('.dtable tbody tr');

test.describe('Archive tab: double-click for the full details', () => {
  test('one click is the quick drawer, a double-click opens the full panel with concurrent calls (on demand)', async ({ page }) => {
    const calls: string[] = [];
    await page.route(/\/api\/calls\//, (route) => {
      calls.push(new URL(route.request().url()).pathname);
      return route.fulfill({ json: answer(1) });
    });
    await start(page);
    await goTab(page, 'Archive');
    await expect(archiveRows(page).first()).toBeVisible();
    const account = (await archiveRows(page).first().locator('.td-name').innerText()).trim();

    // one click: the small drawer, not the full panel
    const quick = page.getByRole('dialog', { name: `${account} details` });
    await archiveRows(page).first().click();
    await expect(quick).toBeVisible();
    await expect(page.locator('.sheet-xl')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(quick).toHaveCount(0);

    // double-click: the full panel (same as on Customers), and the small drawer never opens
    await archiveRows(page).first().dblclick();
    const panel = page.locator('.sheet-xl');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(account);
    await expect(quick).toHaveCount(0);
    await expect(panel.locator('.cd-kpis')).toContainText('Archive folders'); // the same summary strip as on Customers

    // concurrent calls: nothing is requested until the button is pressed
    const sec = page.locator('section[aria-label="Concurrent calls"]');
    await expect(sec).toBeVisible();
    expect(calls).toHaveLength(0);
    await sec.getByRole('button', { name: 'Check concurrent calls' }).click();
    await expect(sec.locator('.cc-group')).toHaveCount(1);
    expect(calls).toEqual(['/api/calls/check']);
  });

  test('the rows say what a click and a double-click do', async ({ page }) => {
    await start(page);
    await goTab(page, 'Archive');
    await expect(archiveRows(page).first()).toHaveAttribute('title', /double-click/i);
  });
});

test.describe('Restart backend is a hard reset', () => {
  test('old bell entries and pop-ups are gone once the backend is back, and nothing old comes back as new', async ({ page }) => {
    await start(page);
    // an old alert in the bell, as if an instance had gone down earlier
    await page.evaluate(() => {
      const item = { id: 'old-1', kind: 'down', at: new Date().toISOString(), status: 'Stopped', instance: 'svc.role_IN_0', cloudService: 'svc', subscription: 'sub', read: false };
      localStorage.setItem('sam.alerts', JSON.stringify({ items: [item], red: { 'sub|svc|svc.role_in_0': 'Stopped' } }));
    });
    await page.reload();
    const bell = page.getByRole('button', { name: /otification/i }).first();
    await expect(bell).toBeVisible();
    await bell.click();
    await expect(page.locator('.alert-card', { hasText: 'svc' })).toHaveCount(1); // other entries may be there too: real instances that are not Started
    await page.keyboard.press('Escape');

    // the restart itself is faked (nothing is really restarted): new process = a different start time
    let health = 0;
    await page.route('**/api/health', (route) => route.fulfill({ json: { status: 'ok', accounts: 1, container: 'archive', ready: true, startedAt: health++ === 0 ? 'before' : 'after' } }));
    await page.route('**/api/restart', (route) => route.fulfill({ status: 202, json: { restarting: true } }));
    await page.getByRole('button', { name: /Restart backend/ }).click();
    await page.getByRole('button', { name: /Restart now/ }).click();
    await expect(page.getByText(/Restarting backend|first scan/).first()).toBeVisible();
    await expect(page.getByText(/Restarting backend|first scan/)).toHaveCount(0, { timeout: 60_000 });

    await bell.click();
    await expect(page.locator('.alert-card')).toHaveCount(0);
    await expect(page.locator('.sheet-body')).toContainText(/caught up/i);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sam.alerts') || '{}').items)).toEqual([]);
    await expect(page.locator('.toast')).toHaveCount(0);
  });
});
