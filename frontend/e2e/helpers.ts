import { expect, type Page } from '@playwright/test';

/**
 * The backend (restarted every 15 min by its scheduled task) forgets bot / database checks, and the dashboard only
 * checks when asked. Tests that need real numbers make sure the backend has them first (cheap when it already does).
 */
export async function warmBackend(page: Page) {
  const get = async (url: string) => (await page.request.get(url, { timeout: 60_000 })).json();
  const bots = await get('/api/bots');
  if (!bots.cloudServices.some((c: { checkedAt: string | null }) => c.checkedAt))
    await page.request.post('/api/bots/check', { timeout: 180_000 });
  const dbs = await get('/api/databases');
  if (!dbs.databases.some((d: { checkedAt: string | null }) => d.checkedAt))
    await page.request.post('/api/databases/check', { timeout: 300_000 });
}

/** Fresh browser state for each test (settings, theme, alerts, groups) unless the test reloads on purpose. */
export async function start(page: Page, opts: { settings?: object; theme?: string; keepStorage?: boolean } = {}) {
  await page.addInitScript(
    ([settings, theme]) => {
      if (!sessionStorage.getItem('e2e-started')) {
        localStorage.clear();
        sessionStorage.setItem('e2e-started', '1');
        if (settings) localStorage.setItem('sam.settings', JSON.stringify(settings));
        if (theme) localStorage.setItem('sam.theme', theme as string);
      }
    },
    [opts.settings ?? null, opts.theme ?? null] as const,
  );
  await warmBackend(page);
  await page.goto('/');
  if (opts.settings && 'defaultTab' in opts.settings) await expect(page.locator('.mstrip .metric').first()).toBeVisible({ timeout: 60_000 });
  else await waitForCustomers(page);
}

export async function waitForCustomers(page: Page) {
  await expect(page.locator('.cust-main .dtable tbody tr').first()).toBeVisible({ timeout: 60_000 });
}

export const tab = (page: Page, name: 'Customers' | 'Archive' | 'Cloud' | 'Data') =>
  page.locator('.side-item', { hasText: name }).first();

export async function goTab(page: Page, name: 'Customers' | 'Archive' | 'Cloud' | 'Data') {
  await tab(page, name).click();
  const eyebrow = { Customers: /Customers/i, Archive: /Archive/i, Cloud: /Cloud Instances/i, Data: /Databases/i }[name];
  await expect(page.locator('.page-eyebrow')).toHaveText(eyebrow);
}

/** Rows of the customers table that are customers (not the expanded SRD sub-rows). */
export const customerRows = (page: Page) => page.locator('.cust-main .dtable tbody tr[title]');

export async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await expect(page.locator('.sheet-title')).toHaveText('Settings');
}

export async function closePanel(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.locator('.sheet')).toHaveCount(0);
}

export async function clearFilter(page: Page) {
  const banner = page.locator('.banner-warm .pill', { hasText: 'Show everything' }).first();
  if (await banner.count()) await banner.click();
}

/** Collects JavaScript errors from the page (not network noise). */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|ERR_ABORTED/i.test(m.text())) errors.push(m.text());
  });
  return errors;
}

/** Records the first frequency of every oscillator the page starts (to see which alert tune played). */
export async function spyAudio(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __tones: number[] }).__tones = [];
    const proto = AudioContext.prototype;
    const create = proto.createOscillator;
    proto.createOscillator = function () {
      const osc = create.call(this);
      const set = osc.frequency.setValueAtTime.bind(osc.frequency);
      let first = true;
      osc.frequency.setValueAtTime = (v: number, t: number) => {
        if (first) {
          (window as unknown as { __tones: number[] }).__tones.push(Math.round(v));
          first = false;
        }
        return set(v, t);
      };
      return osc;
    };
  });
}
export const tones = (page: Page) => page.evaluate(() => (window as unknown as { __tones: number[] }).__tones);

/** Makes the next "check all bots" return the real inventory with chosen instances flipped to a state. */
export async function fakeBotStates(page: Page, states: Record<number, string>) {
  await page.route('**/api/bots/check**', async (route) => {
    const res = await page.request.get('/api/bots');
    const json = await res.json();
    const started = json.instances.filter((i: { status: string }) => i.status === 'Started');
    for (const [idx, status] of Object.entries(states)) started[Number(idx)].status = status;
    await route.fulfill({ json });
  });
}
