import { expect, test, type Page } from '@playwright/test';
import { closePanel, openSettings, start } from './helpers';

/** Settings → Navigation → Sidebar position: left (default), right, top, bottom, with every sidebar mode. */
const SIDES = ['left', 'right', 'top', 'bottom'] as const;
type Side = (typeof SIDES)[number];

const box = async (page: Page, sel: string) => (await page.locator(sel).first().boundingBox())!;
const vp = (page: Page) => page.viewportSize()!;

test.describe('Sidebar position', () => {
  test('left is the default', async ({ page }) => {
    await start(page);
    await expect(page.locator('html')).toHaveAttribute('data-side', 'left');
    const nav = await box(page, '.side-nav');
    const dash = await box(page, '.dash');
    expect(nav.x + nav.width).toBeLessThanOrEqual(dash.x + 1);
  });

  for (const side of SIDES) {
    test(`${side}: the bar sits on that edge, never covers the content, and every tab works`, async ({ page }) => {
      await start(page, { settings: { sidebarSide: side } });
      await expect(page.locator('html')).toHaveAttribute('data-side', side);
      const { width: vw, height: vh } = vp(page);
      const nav = await box(page, '.side-nav');
      const dash = await box(page, '.dash');
      if (side === 'left') {
        expect(nav.x + nav.width).toBeLessThanOrEqual(dash.x + 1);
        expect(nav.height).toBeGreaterThan(vh * 0.6); // a vertical bar
      }
      if (side === 'right') {
        expect(dash.x + dash.width).toBeLessThanOrEqual(nav.x + 1);
        expect(nav.x + nav.width).toBeLessThanOrEqual(vw);
        expect(nav.height).toBeGreaterThan(vh * 0.6);
      }
      if (side === 'top') {
        expect(nav.y + nav.height).toBeLessThanOrEqual(dash.y + 1);
        expect(nav.width).toBeGreaterThan(vw * 0.7); // a horizontal bar
        expect(nav.height).toBeLessThan(120);
      }
      if (side === 'bottom') {
        expect(nav.y + nav.height).toBeGreaterThan(vh - 40);
        expect(nav.width).toBeGreaterThan(vw * 0.7);
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(250);
        const foot = await box(page, '.dash-foot');
        const nav2 = await box(page, '.side-nav');
        expect(foot.y + foot.height).toBeLessThanOrEqual(nav2.y + 2); // the last line of the page is not hidden behind the bar
        await page.evaluate(() => window.scrollTo(0, 0));
      }
      // no sideways scrolling, whatever the side
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
      // all the tabs and the gear are visible and clickable
      await expect(page.locator('.side-item')).toHaveCount(7);
      for (const t of ['Archive', 'Cloud', 'Data', 'Customers']) {
        await page.locator('.side-item', { hasText: t }).first().click();
        await expect(page.locator('.page-eyebrow')).toHaveText(t === 'Cloud' ? /Cloud Instances/i : t === 'Data' ? /Databases/i : new RegExp(t, 'i'));
      }
    });
  }

  test('the Settings panel changes the position straight away, and it is remembered after a reload', async ({ page }) => {
    await start(page);
    await openSettings(page);
    const group = page.getByRole('radiogroup').filter({ has: page.getByRole('radio', { name: /Bottom/ }) });
    for (const [name, side] of [['Right', 'right'], ['Top', 'top'], ['Bottom', 'bottom'], ['Left', 'left']] as [string, Side][]) {
      await group.getByRole('radio', { name: new RegExp(name) }).click();
      await expect(page.locator('html')).toHaveAttribute('data-side', side);
      await expect(group.getByRole('radio', { name: new RegExp(name) })).toHaveAttribute('aria-checked', 'true');
    }
    await group.getByRole('radio', { name: /Right/ }).click();
    await closePanel(page);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sam.settings') || '{}').sidebarSide)).toBe('right');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-side', 'right');
  });

  test('"Reset" in Settings puts the sidebar back on the left', async ({ page }) => {
    await start(page, { settings: { sidebarSide: 'bottom' } });
    await openSettings(page);
    await page.getByRole('button', { name: /Reset/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-side', 'left');
  });

  for (const side of SIDES) {
    test(`${side} + "Hide": the bar is off-screen, the menu button brings it in, a tab click closes it`, async ({ page }) => {
      await start(page, { settings: { sidebarSide: side, sidebar: 'hidden' } });
      const { width: vw, height: vh } = vp(page);
      const off = async () => {
        const n = await box(page, '.side-nav');
        return side === 'left' ? n.x + n.width <= 1 : side === 'right' ? n.x >= vw - 1 : side === 'top' ? n.y + n.height <= 1 : n.y >= vh - 1;
      };
      await expect.poll(off).toBe(true);
      await page.locator('.hdr-burger').click();
      await expect(page.locator('.side-nav')).toHaveClass(/side-open/);
      await expect.poll(async () => {
        const n = await box(page, '.side-nav');
        return n.x >= -1 && n.y >= -1 && n.x + n.width <= vw + 1 && n.y + n.height <= vh + 1;
      }).toBe(true);
      await page.locator('.side-item', { hasText: 'Archive' }).first().click();
      await expect(page.locator('.page-eyebrow')).toHaveText(/Archive/i);
      await expect.poll(off).toBe(true);
    });

    test(`${side} + "On hover": touching that edge slides the bar out, leaving closes it`, async ({ page }) => {
      await start(page, { settings: { sidebarSide: side, sidebar: 'hover' } });
      const { width: vw, height: vh } = vp(page);
      const edge = { left: [3, vh / 2], right: [vw - 3, vh / 2], top: [vw / 2, 3], bottom: [vw / 2, vh - 3] }[side];
      await page.mouse.move(vw / 2, vh / 2);
      await expect(page.locator('.side-nav')).not.toHaveClass(/side-peek/);
      await page.mouse.move(edge[0]!, edge[1]!);
      await expect(page.locator('.side-nav')).toHaveClass(/side-peek/);
      await expect.poll(async () => {
        const n = await box(page, '.side-nav');
        return n.x >= -1 && n.y >= -1 && n.x + n.width <= vw + 1 && n.y + n.height <= vh + 1;
      }).toBe(true);
      await page.mouse.move(vw / 2, vh / 2);
      await expect(page.locator('.side-nav')).not.toHaveClass(/side-peek/, { timeout: 3000 });
    });
  }

  test('on a phone-sized window the bar is always at the bottom, whichever side is chosen', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await start(page, { settings: { sidebarSide: 'right' } });
    const nav = await box(page, '.side-nav');
    expect(nav.y + nav.height).toBeGreaterThan(900 - 8);
    expect(nav.width).toBeGreaterThan(700);
  });

  test('a macOS theme drops its window dots on a horizontal bar', async ({ page }) => {
    await start(page, { settings: { sidebarSide: 'top' }, theme: 'macos' });
    const before = await page.locator('.side-nav').evaluate((el) => getComputedStyle(el, '::before').display);
    expect(before).toBe('none');
    const nav = await box(page, '.side-nav');
    expect(nav.width).toBeGreaterThan(900);
  });
});
