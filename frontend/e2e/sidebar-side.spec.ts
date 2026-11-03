import { expect, test, type Page } from '@playwright/test';
import { closePanel, customerRows, openSettings, start } from './helpers';

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

  for (const mode of ['hidden', 'hover'] as const)
    for (const side of SIDES) {
      test(`${side} + ${mode}: opening the bar slides the page away from it, closing slides it back`, async ({ page }) => {
        await start(page, { settings: { sidebarSide: side, sidebar: mode } });
        const { width: vw, height: vh } = vp(page);
        const pos = () => page.evaluate(() => { const b = document.querySelector('.mstrip')!.getBoundingClientRect(); return { x: b.x, y: b.y }; });
        const before = await pos();
        if (mode === 'hidden') await page.locator('.hdr-burger').click();
        else {
          const edge = { left: [3, vh / 2], right: [vw - 3, vh / 2], top: [vw / 2, 3], bottom: [vw / 2, vh - 3] }[side];
          await page.mouse.move(edge[0]!, edge[1]!);
        }
        await expect(page.locator('.page')).toHaveClass(/page-shift/);
        // the cards move AWAY from the bar by about the bar's thickness
        await expect.poll(async () => {
          const a = await pos();
          const dx = a.x - before.x;
          const dy = a.y - before.y;
          return { left: dx > 60, right: dx < -60, top: dy > 60, bottom: dy < -60 }[side];
        }).toBe(true);
        // and they never sit under the bar
        const nav = await box(page, '.side-nav');
        const card = await box(page, '.mstrip');
        if (side === 'left') expect(card.x).toBeGreaterThanOrEqual(nav.x + nav.width - 1);
        if (side === 'right') expect(card.x + card.width).toBeLessThanOrEqual(nav.x + 1 + vw); // slid, so it may extend past the left edge but never into the bar
        if (side === 'top') expect(card.y).toBeGreaterThanOrEqual(nav.y + nav.height - 1);
        // back where it was when the bar closes
        if (mode === 'hidden') await page.keyboard.press('Escape');
        else await page.mouse.move(vw / 2, vh / 2);
        await expect(page.locator('.page')).not.toHaveClass(/page-shift/, { timeout: 4000 });
        await expect.poll(async () => {
          const a = await pos();
          return Math.abs(a.x - before.x) < 2 && Math.abs(a.y - before.y) < 2;
        }).toBe(true);
      });
    }

  test('a bar opened with the menu button closes on Esc or when the page is clicked', async ({ page }) => {
    await start(page, { settings: { sidebarSide: 'right', sidebar: 'hidden' } });
    await page.locator('.hdr-burger').click();
    await expect(page.locator('.side-nav')).toHaveClass(/side-open/);
    await page.keyboard.press('Escape');
    await expect(page.locator('.side-nav')).not.toHaveClass(/side-open/);
    await page.locator('.hdr-burger').click();
    await expect(page.locator('.side-nav')).toHaveClass(/side-open/);
    await page.locator('.dtable').first().click({ position: { x: 5, y: 5 }, force: true });
    await expect(page.locator('.side-nav')).not.toHaveClass(/side-open/);
  });

  for (const side of SIDES) {
    test(`${side}: a side panel covers the sidebar, never the other way round (and its close button stays clickable)`, async ({ page }) => {
      await start(page, { settings: { sidebarSide: side }, theme: 'macosglass' });
      await customerRows(page).first().dblclick();
      await expect(page.locator('.sheet')).toBeVisible();
      await page.waitForTimeout(700); // the panel finishes sliding in
      // what is on top at the sidebar's centre, and at the panel's close button
      const top = await page.evaluate(() => {
        const nav = document.querySelector('.side-nav')!.getBoundingClientRect();
        const at = document.elementFromPoint(nav.x + nav.width / 2, nav.y + nav.height / 2);
        const close = document.querySelector('.sheet .icirc')!.getBoundingClientRect();
        const onClose = document.elementFromPoint(close.x + close.width / 2, close.y + close.height / 2);
        return { navCovered: !!at?.closest('.drawer, .drawer-backdrop'), closeOk: !!onClose?.closest('.icirc') };
      });
      expect(top.navCovered, 'the sidebar is under the panel / backdrop').toBe(true);
      expect(top.closeOk, 'nothing sits on the close button').toBe(true);
      await page.locator('.sheet .icirc').click();
      await expect(page.locator('.sheet')).toHaveCount(0);
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
