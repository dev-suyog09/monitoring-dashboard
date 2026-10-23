import { expect, test } from '@playwright/test';
import { closePanel, goTab, openSettings, spyAudio, start, tones } from './helpers';

const html = (page: import('@playwright/test').Page) => page.locator('html');
const saved = (page: import('@playwright/test').Page) => page.evaluate(() => JSON.parse(localStorage.getItem('sam.settings') || '{}'));

test.describe('Settings', () => {
  test('opens from the header gear and lists every group', async ({ page }) => {
    await start(page);
    await openSettings(page);
    await expect(page.locator('.set-group-hd h4')).toContainText(['Appearance', 'Navigation', 'Data and refresh', 'Notifications', 'Keyboard shortcuts', 'Account and about']);
    await closePanel(page);
  });

  test('all twelve themes apply and the quick button cycles through them', async ({ page }) => {
    await start(page);
    await openSettings(page);
    const expected: Record<string, [string, string | null]> = {
      AMOLED: ['dark', null],
      Calm: ['dark', 'calm'],
      Aurora: ['dark', 'aurora'],
      Emerald: ['dark', 'emerald'],
      Light: ['light', null],
      Sunset: ['light', 'sunset'],
      macOS: ['light', 'macos'],
      'macOS Dark': ['dark', 'macosdark'],
      'macOS AMOLED': ['dark', 'macosamoled'],
      'macOS Glass': ['light', 'macosglass'],
      'macOS Glass Dark': ['dark', 'macosglassdark'],
      'macOS Glass AMOLED': ['dark', 'macosglassamoled'],
    };
    for (const [name, [theme, palette]] of Object.entries(expected)) {
      await page.locator('.theme-card').filter({ has: page.locator('.theme-name', { hasText: new RegExp(`^${name}$`) }) }).click();
      await expect(html(page)).toHaveAttribute('data-theme', theme);
      if (palette) await expect(html(page)).toHaveAttribute('data-palette', palette);
      else await expect(html(page)).not.toHaveAttribute('data-palette', /.+/);
    }
    await closePanel(page);
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      seen.add((await html(page).getAttribute('data-theme')) + '/' + ((await html(page).getAttribute('data-palette')) ?? '-'));
      await page.getByRole('button', { name: /Switch theme/ }).click();
      await page.waitForTimeout(450); // let the cross-fade finish
    }
    expect(seen.size).toBe(12);
  });

  test('theme survives a reload', async ({ page }) => {
    await start(page);
    await openSettings(page);
    await page.locator('.theme-card', { hasText: 'Sunset' }).click();
    await page.reload();
    await expect(html(page)).toHaveAttribute('data-palette', 'sunset');
  });

  test('accent, density, motion and greeting', async ({ page }) => {
    await start(page);
    await openSettings(page);
    await page.getByRole('button', { name: 'Violet', exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--accent'))).toMatch(/9b6bff/i);
    await page.getByRole('button', { name: 'Theme default', exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--accent'))).toBe('');

    await page.getByRole('radio', { name: 'Compact' }).click();
    await expect(html(page)).toHaveAttribute('data-density', 'compact');
    await page.getByRole('radio', { name: 'Comfortable' }).click();

    await page.getByRole('switch', { name: 'Reduce motion' }).click();
    await expect(html(page)).toHaveAttribute('data-motion', 'reduced');
    await page.getByRole('switch', { name: 'Reduce motion' }).click();
    await expect(html(page)).toHaveAttribute('data-motion', 'full');

    await page.getByRole('switch', { name: 'Show greeting' }).click();
    await expect(page.locator('h1')).toHaveText('Customers');
    await page.getByRole('switch', { name: 'Show greeting' }).click();
    await expect(page.locator('h1')).toContainText(/Good/);
  });

  test('sidebar modes: hide (push layout) and on hover (peek, then close)', async ({ page }) => {
    await start(page, { settings: { sidebar: 'hidden' } });
    await expect(page.locator('.hdr-burger')).toBeVisible();
    const dash = page.locator('.dash');
    const x0 = (await dash.boundingBox())!.x;
    await page.locator('.hdr-burger').click();
    await expect(page.locator('.side-nav')).toHaveClass(/side-open/);
    await expect(page.locator('.page')).toHaveClass(/page-shift/);
    await expect.poll(async () => (await dash.boundingBox())!.x).toBeGreaterThan(x0 + 60); // content slid right, not covered
    await page.locator('.hdr-burger').click();
    await expect(page.locator('.side-nav')).not.toHaveClass(/side-open/);

    await openSettingsViaStorage(page);
    await page.locator('.side-zone').hover();
    await expect(page.locator('.side-nav')).toHaveClass(/side-peek/);
    await page.mouse.move(700, 400);
    await expect(page.locator('.side-nav')).not.toHaveClass(/side-peek/, { timeout: 3000 });
  });

  test('default tab, auto charts, density and tune persist across a reload', async ({ page }) => {
    await start(page, { settings: { defaultTab: 'bots', autoCharts: true, density: 'compact', tune: 'zen' }, theme: 'calm' });
    await expect(page.locator('.page-eyebrow')).toHaveText(/Cloud Instances/i);
    await expect(html(page)).toHaveAttribute('data-density', 'compact');
    await page.reload();
    await expect(page.locator('.page-eyebrow')).toHaveText(/Cloud Instances/i);
    expect((await saved(page)).tune).toBe('zen');
  });

  test('auto re-check interval saves', async ({ page }) => {
    await start(page);
    await openSettings(page);
    await page.locator('.set-select').nth(1).selectOption('30');
    expect((await saved(page)).autoMinutes).toBe(30);
  });

  test('reset puts the settings back to defaults', async ({ page }) => {
    await start(page, { settings: { density: 'compact', tune: 'harp' } });
    await openSettings(page);
    await page.getByRole('button', { name: /Reset/ }).click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('sam.settings'))).toBeNull();
    await expect(html(page)).toHaveAttribute('data-density', 'comfortable');
  });

  test('account info shows who is signed in and the backend address', async ({ page }) => {
    await start(page);
    await openSettings(page);
    await expect(page.locator('.sheet-body')).toContainText(/@/);
    await expect(page.locator('.sheet-body')).toContainText(/\d+\.\d+\.\d+\.\d+/);
  });

  test('9 alert tunes: choosing one saves it and plays that tune; volume is saved', async ({ page }) => {
    await spyAudio(page);
    await start(page);
    await openSettings(page);
    await expect(page.locator('.tune-card')).toHaveCount(9);
    await page.locator('.tune-card', { hasText: 'Alert pulse' }).click();
    expect((await saved(page)).tune).toBe('pulse');
    await expect.poll(() => tones(page)).toEqual([880, 660, 880, 660, 880, 660]); // pulse = A5/E5 x3
    await page.locator('.vol-row input').fill('35');
    expect((await saved(page)).volume).toBe(35);
  });

  test('a tune picked in another tab is used here without a reload', async ({ page, context }) => {
    await start(page);
    const other = await context.newPage();
    await other.goto('/');
    await other.evaluate(() => {
      localStorage.setItem('sam.settings', JSON.stringify({ tune: 'zen', volume: 60 }));
    });
    // the browser tells this tab about the other tab's change by itself (same origin, same browser)
    await openSettings(page);
    await expect(page.locator('.tune-card.tune-on')).toContainText('Zen bowl');
  });

  test('settings panel is reachable from every tab', async ({ page }) => {
    await start(page);
    for (const t of ['Archive', 'Cloud', 'Data'] as const) {
      await goTab(page, t);
      await openSettings(page);
      await closePanel(page);
    }
  });
});

async function openSettingsViaStorage(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    localStorage.setItem('sam.settings', JSON.stringify({ sidebar: 'hover' }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'sam.settings' }));
  });
  await expect(html(page)).toHaveAttribute('data-sidebar', 'hover');
}
