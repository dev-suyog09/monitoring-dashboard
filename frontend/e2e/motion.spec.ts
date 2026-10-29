import { expect, test, type Page } from '@playwright/test';
import { customerRows, start } from './helpers';

/**
 * The transitions are part of the product, so they are tested: they exist (staggered entrances, drawn lines, growing bars,
 * dimmed reloads, tick pops) and "Reduce motion" turns every one of them off.
 */
const T0 = Date.now() - 60 * 60_000;
const times = Array.from({ length: 12 }, (_, i) => new Date(T0 + i * 5 * 60_000).toISOString());
const group = (rg: string, bots: number) => {
  const instances = Array.from({ length: bots }, (_, i) => `MicrosoftTeams.RecordingService_IN_${i}`);
  const cells: [number, number, number][] = [];
  instances.forEach((_, ii) => times.forEach((_t, ti) => cells.push([ti, ii, (ii % 4) + (ti % 3) + 2])));
  return { name: `botAppInsights${rg}`, resourceGroup: rg, instances, lastSeen: instances.map(() => new Date(Date.now() - 60_000).toISOString()), times, cells };
};

async function fakeSeries(page: Page, delayMs = 0) {
  await page.route(/\/api\/calls\//, async (route) => {
    const u = new URL(route.request().url());
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return route.fulfill({
      json: { subscriptionId: u.searchParams.get('subscriptionId'), hours: Number(u.searchParams.get('hours')), bin: 5, metric: u.searchParams.get('metric'), agg: u.searchParams.get('agg'), generatedAt: new Date().toISOString(), groups: [group('xyzprdntx-uaen-grp-rec-01', 6), group('xyzprdntx-uaen-grp-rec-02', 4)] },
    });
  });
}

const style = (page: Page, selector: string, props: string[]) =>
  page.locator(selector).first().evaluate((el, p) => Object.fromEntries(p.map((k) => [k, getComputedStyle(el).getPropertyValue(k)])), props);

async function loadCalls(page: Page) {
  await page.locator('.side-item', { hasText: 'Calls' }).first().click();
  await expect(page.locator('.page-eyebrow')).toHaveText(/Concurrent Calls/i);
  await page.locator('.cv-pick-btn').click();
  await page.getByRole('listbox', { name: 'Customers' }).locator('label').first().click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Load/ }).click();
  await expect(page.locator('.cv-kpi')).toHaveCount(6);
}

test.describe('Motion', () => {
  test('Concurrent Calls: results rise in one after another, lines draw, bars grow, the heatmap washes in', async ({ page }) => {
    await fakeSeries(page);
    await start(page);
    await loadCalls(page);
    const a = await style(page, '.cv-top > :nth-child(1)', ['animation-name', 'animation-delay']);
    const b = await style(page, '.cv-top > :nth-child(2)', ['animation-name', 'animation-delay']);
    expect(a['animation-name']).toBe('fade-up');
    expect(parseFloat(b['animation-delay'])).toBeGreaterThan(parseFloat(a['animation-delay']));
    await expect.poll(async () => (await style(page, '.cv-kpis > :nth-child(5)', ['animation-delay']))['animation-delay']).not.toBe('0s');
    expect((await style(page, '.ch-svg path.draw', ['animation-name']))['animation-name']).toBe('draw');
    await page.getByLabel('Split by').selectOption('none'); // the soft area fill belongs to the single-line view
    expect((await style(page, '.ch-area', ['animation-name']))['animation-name']).toBe('fade-in');
    expect((await style(page, '.ch-bar-fill', ['animation-name']))['animation-name']).toBe('bar-in');
    const r0 = await page.locator('.ch-heat-row').nth(0).evaluate((el) => getComputedStyle(el).animationDelay);
    const r5 = await page.locator('.ch-heat-row').nth(5).evaluate((el) => getComputedStyle(el).animationDelay);
    expect(parseFloat(r5)).toBeGreaterThan(parseFloat(r0));
  });

  test('Concurrent Calls: reloading keeps the old picture, dimmed, with a progress sweep, then settles', async ({ page }) => {
    await fakeSeries(page, 1500);
    await start(page);
    await page.locator('.side-item', { hasText: 'Calls' }).first().click();
    await page.locator('.cv-pick-btn').click();
    await page.getByRole('listbox', { name: 'Customers' }).locator('label').first().click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Load/ }).click();
    await expect(page.locator('.cv-kpi')).toHaveCount(6, { timeout: 20_000 });
    await page.getByRole('button', { name: /Reload/ }).click();
    await expect(page.locator('.cv-results.cv-busy')).toBeVisible();
    await expect(page.locator('.cv-kpi')).toHaveCount(6); // still on screen, not blanked
    expect(await page.locator('.cv-results').evaluate((el) => parseFloat(getComputedStyle(el).opacity))).toBeLessThan(1);
    await expect(page.locator('.cv-bar')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('.cv-results.cv-busy')).toHaveCount(0, { timeout: 20_000 });
    await expect(page.locator('.cv-bar')).toHaveAttribute('aria-busy', 'false');
  });

  test('customer panel: wide, cards rise in turn, progress bars fill', async ({ page }) => {
    await start(page);
    await customerRows(page).first().dblclick();
    await expect(page.locator('.sheet-xl')).toBeVisible();
    const w = (await page.locator('.sheet-xl').boundingBox())!.width;
    expect(w).toBeGreaterThan(1440 * 0.7); // the panel uses most of the screen, not half
    const a = await style(page, '.sheet-xl .cd-kpis > :nth-child(1)', ['animation-name', 'animation-delay']);
    const d = await style(page, '.sheet-xl .cd-kpis > :nth-child(4)', ['animation-delay']);
    expect(a['animation-name']).toBe('fade-up');
    expect(parseFloat(d['animation-delay'])).toBeGreaterThan(parseFloat(a['animation-delay']));
    expect((await style(page, '.sheet-xl .cd-kpi-bar i', ['animation-name']))['animation-name']).toBe('bar-in');
  });

  test('checklist: the ring fills smoothly and a tick pops', async ({ page }) => {
    await start(page);
    await page.route(/\/api\/checklist/, (route) =>
      route.fulfill({ json: { today: '2026-10-29', email: '', enabled: true, times: ['09:00'], repeat: false, repeatMinutes: 60, tracked: null, lists: [{ name: 'Daily HC', members: ['adc', 'atd', 'bom'], done: ['adc'] }], smtp: { configured: false, from: '' }, lastMail: null, teams: { configured: false }, lastTeams: null, nextReminder: null } }),
    );
    await page.evaluate(() => localStorage.setItem('sam.watchgroups', JSON.stringify([{ name: 'Daily HC', terms: ['adc'] }])));
    await page.reload();
    await page.locator('.side-item', { hasText: 'Checklist' }).first().click();
    await expect(page.locator('.cx-row.on')).toHaveCount(1);
    expect((await style(page, '.cx-ring', ['transition-property']))['transition-property']).toContain('--p');
    expect((await style(page, '.cx-row.on .cx-box', ['animation-name']))['animation-name']).toBe('box-pop');
    // polled: entrances start once the tab cross-fade has finished
    await expect.poll(async () => (await style(page, '.cx-rows > :nth-child(3)', ['animation-delay']))['animation-delay']).not.toBe('0s');
  });

  test('"Reduce motion" switches every one of them off', async ({ page }) => {
    await fakeSeries(page);
    await start(page, { settings: { reduceMotion: true } });
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
    await loadCalls(page);
    for (const sel of ['.cv-top > :nth-child(2)', '.ch-svg path.draw', '.ch-bar-fill', '.ch-heat-row']) {
      const s = await style(page, sel, ['animation-duration', 'animation-delay']);
      expect(parseFloat(s['animation-duration']), `${sel} duration`).toBeLessThan(0.01);
      expect(parseFloat(s['animation-delay']), `${sel} delay`).toBe(0);
    }
    expect(parseFloat((await style(page, '.cv-results', ['transition-duration']))['transition-duration'])).toBeLessThan(0.01);
  });

  test('switching tabs runs the cross-fade and leaves no stale class behind', async ({ page }) => {
    await start(page);
    const supported = await page.evaluate(() => 'startViewTransition' in document);
    test.skip(!supported, 'View Transitions are not supported by this browser');
    for (const t of ['Archive', 'Calls', 'Checklist', 'Customers']) {
      await page.locator('.side-item', { hasText: t }).first().click();
      await expect(page.locator('html')).not.toHaveClass(/\bvt\b/, { timeout: 5000 });
    }
    await expect(page.locator('.page-eyebrow')).toHaveText(/Customers/i);
  });
});
