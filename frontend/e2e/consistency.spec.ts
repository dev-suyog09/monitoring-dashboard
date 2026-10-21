import { expect, test, type Page } from '@playwright/test';
import { customerRows, goTab, start } from './helpers';

/**
 * The same customer must tell the same story on every tab. These tests take /api/check (what the backend actually
 * found) as the single source of truth and compare it with what the Customers tab, its details panel and the Archive
 * tab show — so a customer can never again look "missing" in one place and "available" in another.
 */

interface Account {
  accountName: string;
  subscription?: string;
  status: 'healthy' | 'missing_today' | 'error' | 'no_data';
  capturesWithToday: number;
  capturesTotal: number;
}

const CUSTOMER_RE = /^([a-z0-9]+?)(?:prd|uat|dev|tst|stg|poc)/i;
const customerCode = (name: string) => (CUSTOMER_RE.exec(name)?.[1] ?? name.split(/[-_.]/)[0]!).toLowerCase();

async function truth(page: Page): Promise<Account[]> {
  return (await (await page.request.get('/api/check')).json()).results as Account[];
}

/** What the backend says for one subscription, in the numbers the UI shows. */
function expected(accounts: Account[]) {
  const monitorable = accounts.filter((a) => a.status !== 'no_data');
  const healthy = accounts.filter((a) => a.status === 'healthy');
  const partialFolders = healthy.reduce((n, a) => n + Math.max(0, a.capturesTotal - a.capturesWithToday), 0);
  return { healthy: healthy.length, monitorable: monitorable.length, partialFolders };
}

test.describe('cross-tab consistency of the archive numbers', () => {
  test('every customer row on the Customers tab matches the backend, including empty folders', async ({ page }) => {
    await start(page);
    const accounts = await truth(page);
    const bySub = new Map<string, Account[]>();
    for (const a of accounts) bySub.set(a.subscription ?? '', [...(bySub.get(a.subscription ?? '') ?? []), a]);

    const rows = customerRows(page);
    const n = await rows.count();
    expect(n).toBeGreaterThan(20);
    let compared = 0;
    for (let i = 0; i < n; i++) {
      const row = rows.nth(i);
      const sub = ((await row.locator('.cust-full').innerText()).split('·')[0] ?? '').trim();
      const mine = bySub.get(sub);
      if (!mine?.length) continue; // a customer with no SRD account
      const exp = expected(mine);
      const archiveCell = row.locator('td').nth(2);
      if (exp.monitorable === 0) {
        await expect(archiveCell).toContainText('no SRD');
      } else {
        await expect(archiveCell, `${sub}: archive chip`).toContainText(`${exp.healthy}/${exp.monitorable} today`);
      }
      const pill = archiveCell.locator('.chip-mini');
      if (exp.partialFolders > 0) await expect(pill, `${sub}: empty-folders pill`).toContainText(String(exp.partialFolders));
      else await expect(pill, `${sub}: no pill expected`).toHaveCount(0);
      compared++;
    }
    expect(compared).toBeGreaterThan(20);
  });

  test('two customers with the same short name (e.g. CAC in UAT and PRD) are told apart by an environment tag', async ({ page }) => {
    await start(page);
    const labels = await customerRows(page).locator('.cust-short').allInnerTexts();
    const clean = labels.map((l) => l.replace(/\s+/g, ' ').trim());
    expect(new Set(clean).size, `duplicate labels: ${clean.filter((l, i) => clean.indexOf(l) !== i).join(', ')}`).toBe(clean.length);
  });

  test('while the archive scan is warming up, the Customers tab says so instead of showing "missing" or "all archived"', async ({ page }) => {
    await page.route('**/api/check**', (route) =>
      route.fulfill({ json: { today: '2026-10-21', generatedAt: new Date().toISOString(), container: 'archive', results: [], warming: true, egressIp: null } }),
    );
    await start(page);
    await expect(page.locator('.cust-main .dtable tbody tr[title]').first()).toBeVisible();
    await expect(page.locator('.banner-warm', { hasText: 'warming up' }).first()).toBeVisible();
    await expect(page.locator('.mstrip .metric', { hasText: 'Archive complete' })).toContainText('scanning archive');
    await expect(page.locator('.mstrip .metric', { hasText: 'Archive complete' })).not.toContainText('all archived');
    const chips = await page.locator('.cust-main .dtable tbody tr[title] td:nth-child(3)').allInnerTexts();
    expect(chips.length).toBeGreaterThan(10);
    for (const c of chips) expect(c).toContain('scanning');
  });

  test('details panel folder numbers equal the backend for each SRD account', async ({ page }) => {
    await start(page);
    const accounts = await truth(page);
    const sample = accounts.filter((a) => a.status === 'healthy' && a.capturesWithToday < a.capturesTotal).slice(0, 2).concat(accounts.filter((a) => a.status === 'missing_today').slice(0, 1));
    test.skip(sample.length === 0, 'no partial or missing account right now');
    for (const acct of sample) {
      const row = customerRows(page).filter({ hasText: acct.subscription ?? '' }).first();
      await row.dblclick();
      const pills = page.locator('.cd-accts .pill', { hasText: acct.accountName });
      if (await pills.count()) await pills.first().click();
      const tile = page.locator('.cd-kpi', { hasText: 'Archive folders' });
      await expect(tile, acct.accountName).toContainText(`${acct.capturesWithToday}/${acct.capturesTotal}`);
      if (acct.status === 'healthy' && acct.capturesWithToday < acct.capturesTotal) await expect(page.locator('.cd-note')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('.sheet')).toHaveCount(0);
    }
  });

  test('Customers tab and Archive tab agree for the same customer (search by customer code)', async ({ page }) => {
    await start(page);
    const accounts = await truth(page);
    const codes = new Map<string, Account[]>();
    for (const a of accounts) codes.set(customerCode(a.accountName), [...(codes.get(customerCode(a.accountName)) ?? []), a]);
    // customers that exist in more than one environment are the ones most likely to be misread; CAC is the reported case
    const multiEnv = [...codes.entries()].filter(([, list]) => new Set(list.map((a) => /prd|uat|dev/i.exec(a.accountName.slice(3, 9))?.[0])).size > 1).map(([c]) => c);
    const picks = Array.from(new Set(['cac', ...multiEnv.slice(0, 3)])).filter((c) => codes.has(c));
    expect(picks.length).toBeGreaterThan(0);

    for (const code of picks) {
      const list = codes.get(code)!;
      const want = { healthy: list.filter((a) => a.status === 'healthy').length, missing: list.filter((a) => a.status === 'missing_today').length };

      await goTab(page, 'Customers');
      const box = page.locator('.wl input');
      await box.click();
      await box.fill(code);
      await page.keyboard.press('Enter');
      await expect(page.locator('.wchip')).toHaveCount(1);
      // Customers tab: add up the account chips of every row for this customer (UAT, PRD, ...)
      await expect(customerRows(page).first()).toBeVisible();
      const chips = await customerRows(page).locator('td:nth-child(3) .chip:not(.chip-mini)').allInnerTexts();
      const shownHealthy = chips.reduce((n, t) => n + Number(/(\d+)\/\d+ today/.exec(t)?.[1] ?? 0), 0);
      const shownMonitorable = chips.reduce((n, t) => n + Number(/\d+\/(\d+) today/.exec(t)?.[1] ?? 0), 0);
      expect(shownHealthy, `${code}: healthy accounts on Customers tab`).toBe(want.healthy);
      expect(shownMonitorable, `${code}: monitorable accounts on Customers tab`).toBe(want.healthy + want.missing);

      // Archive tab with the same customer: the stat cards must say the same
      await goTab(page, 'Archive');
      const cards = page.locator('.stat');
      await expect(cards.nth(1), `${code}: Archive tab healthy`).toContainText(String(want.healthy));
      await expect(cards.nth(2), `${code}: Archive tab missing`).toContainText(String(want.missing));

      await goTab(page, 'Customers');
      await page.getByRole('button', { name: 'Clear', exact: true }).click();
    }
  });
});
