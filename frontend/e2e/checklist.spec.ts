import { expect, test, type Page } from '@playwright/test';
import { start } from './helpers';

/**
 * The checklist tab against an in-memory stand-in for the backend, so the tests never touch the real saved lists, ticks or
 * email. (The backend's own rules are unit tested in backend/src/checklist.test.ts.)
 */
interface Fake {
  email: string;
  enabled: boolean;
  times: string[];
  repeat: boolean;
  repeatMinutes: number;
  tracked: string[] | null;
  lists: { name: string; members: string[] }[];
  done: Record<string, string[]>;
  smtp: boolean;
  teamsUrl: string;
  calls: { method: string; url: string; body: unknown }[];
}

async function fakeBackend(page: Page, init: Partial<Fake> = {}): Promise<Fake> {
  const f: Fake = { email: '', enabled: true, times: ['00:00', '03:00', '06:00'], repeat: false, repeatMinutes: 60, tracked: null, lists: [], done: {}, smtp: false, teamsUrl: '', calls: [], ...init };
  const view = () => ({
    today: '2026-10-23',
    email: f.email,
    enabled: f.enabled,
    times: f.times,
    repeat: f.repeat,
    repeatMinutes: f.repeatMinutes,
    tracked: f.tracked,
    lists: f.lists.map((l) => ({ ...l, done: f.done[l.name] ?? [] })),
    smtp: { configured: f.smtp, from: f.smtp ? 'monitor@example.com' : '' },
    lastMail: null,
    teams: { configured: !!f.teamsUrl },
    lastTeams: null,
    nextReminder: f.email || f.teamsUrl ? new Date(Date.now() + 3600_000).toISOString() : null,
  });
  await page.route(/\/api\/checklist/, async (route) => {
    const req = route.request();
    const url = new URL(req.url()).pathname;
    const body = req.postDataJSON() as Record<string, unknown> | null;
    f.calls.push({ method: req.method(), url, body });
    if (req.method() === 'PUT' && url.endsWith('/lists')) f.lists = (body!.lists as Fake['lists']).map((l) => ({ name: l.name, members: l.members }));
    if (req.method() === 'PUT' && url.endsWith('/settings')) Object.assign(f, body);
    if (req.method() === 'POST' && url.endsWith('/mark')) {
      const { list, member, done } = body as { list: string; member: string | null; done: boolean };
      const l = f.lists.find((x) => x.name === list)!;
      const cur = new Set(f.done[list] ?? []);
      for (const m of member === null ? l.members : [member]) (done ? cur.add(m) : cur.delete(m));
      f.done[list] = [...cur];
    }
    if (req.method() === 'POST' && (url.endsWith('/test-mail') || url.endsWith('/test-teams'))) return route.fulfill({ json: { ok: true } });
    return route.fulfill({ json: view() });
  });
  return f;
}

const GROUP = [{ name: 'Daily HC', terms: ['adc', 'atd', 'bom'] }];

async function openChecklist(page: Page, groups: typeof GROUP | [] = GROUP) {
  await page.evaluate((g) => localStorage.setItem('sam.watchgroups', JSON.stringify(g)), groups);
  await page.reload();
  await page.locator('.side-item', { hasText: 'Checklist' }).first().click();
  await expect(page.locator('.page-eyebrow')).toHaveText(/Checklist/i);
}

test.describe('Daily checklist', () => {
  const menu = (page: Page) => page.getByRole('navigation', { name: 'Checklist menu' });
  const rows = (page: Page) => page.locator('.cx-row');

  test('a saved group appears as a list in the menu and is sent to the backend', async ({ page }) => {
    await start(page);
    const f = await fakeBackend(page);
    await openChecklist(page);
    await expect(menu(page).getByRole('button', { name: /Daily HC/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
    await expect(rows(page)).toHaveCount(3);
    await menu(page).getByRole('button', { name: /Daily HC/ }).click();
    await expect(page.getByRole('heading', { name: 'Daily HC' })).toBeVisible();
    await expect(rows(page)).toHaveCount(3);
    expect(f.lists).toEqual([{ name: 'Daily HC', members: ['adc', 'atd', 'bom'] }]);
  });

  test('ticking customers, mark all and clear update the counts and the ring', async ({ page }) => {
    await start(page);
    const f = await fakeBackend(page);
    await openChecklist(page);
    const listNav = menu(page).getByRole('button', { name: /Daily HC/ });
    await expect(listNav.locator('.cx-count')).toHaveText('3'); // still to check
    await page.getByLabel('Daily HC: adc').check();
    await expect(listNav.locator('.cx-count')).toHaveText('2');
    await expect(page.locator('.cx-ring b')).toHaveText('33%');
    await expect(page.locator('.cx-progress')).toContainText('1 of 3 checked');
    expect(f.done['Daily HC']).toEqual(['adc']);
    await page.getByRole('button', { name: /Mark all done/ }).click();
    await expect(listNav.locator('.cx-count')).toHaveText('0');
    await expect(page.locator('.cx-progress')).toContainText('all done');
    await page.getByLabel('Daily HC: bom').uncheck();
    await expect(listNav.locator('.cx-count')).toHaveText('1');
    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(listNav.locator('.cx-count')).toHaveText('3');
    expect(f.done['Daily HC']).toEqual([]);
  });

  test('menu views filter the list: still to check, checked, search', async ({ page }) => {
    await start(page);
    await fakeBackend(page, { done: { 'Daily HC': ['adc'] }, lists: [{ name: 'Daily HC', members: ['adc', 'atd', 'bom'] }] });
    await openChecklist(page, []);
    await menu(page).getByRole('button', { name: /Still to check/ }).click();
    await expect(rows(page)).toHaveCount(2);
    await menu(page).getByRole('button', { name: /^Checked/ }).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('adc');
    await menu(page).getByRole('button', { name: /All checks/ }).click();
    await page.getByLabel('Search the checklist').fill('bo');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('bom');
    await page.getByLabel('Search the checklist').fill('zzz');
    await expect(page.locator('.cx-none')).toContainText('Nothing matches');
  });

  test('selecting a customer shows its details, opens it in Customers, and goes back to the reminders', async ({ page }) => {
    await start(page);
    await fakeBackend(page);
    await openChecklist(page);
    await expect(page.getByLabel('Reminders', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Details of atd' }).click();
    const side = page.getByLabel('Customer details');
    await expect(side.locator('.cx-big')).toHaveText('atd');
    await expect(side).toContainText('Still to check');
    await side.getByRole('button', { name: /Mark as checked/ }).click();
    await expect(side).toContainText('Checked');
    await side.getByRole('button', { name: 'Back to reminders' }).click();
    await expect(page.getByLabel('Reminders', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Details of bom' }).click();
    await page.getByLabel('Customer details').getByRole('button', { name: /Open in Customers/ }).click();
    await expect(page.locator('.page-eyebrow')).toHaveText(/Customers/i);
  });

  // email UI is hidden for now (SHOW_EMAIL in ChecklistView); the backend still supports it
  test.skip('email: invalid addresses are refused, a valid one is saved and shown after a reload', async ({ page }) => {
    await start(page);
    const f = await fakeBackend(page);
    await openChecklist(page);
    const box = page.getByLabel('Your email address');
    const save = page.getByRole('button', { name: 'Save', exact: true });
    await box.fill('not-an-email');
    await expect(page.locator('.cl-bad').first()).toContainText('does not look like');
    await expect(save).toBeDisabled();
    await box.fill('suyog@example.com');
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.locator('.cl-ok')).toContainText('Email saved');
    expect(f.email).toBe('suyog@example.com');
    await page.reload();
    await page.locator('.side-item', { hasText: 'Checklist' }).first().click();
    await expect(page.getByLabel('Your email address')).toHaveValue('suyog@example.com');
    await expect(page.locator('.cx-next')).toContainText('Next reminder');
  });

  test('reminder times: 12 AM, 3 AM and 6 AM by default; add and remove', async ({ page }) => {
    await start(page);
    const f = await fakeBackend(page);
    await openChecklist(page);
    await expect(page.locator('.cl-time')).toHaveText([/12:00 AM/, /3:00 AM/, /6:00 AM/]);
    await page.getByLabel('New reminder time').fill('09:30');
    await page.getByRole('button', { name: '+ Add time' }).click();
    await expect(page.locator('.cl-time').last()).toContainText('9:30 AM');
    expect(f.times).toContain('09:30');
    await page.getByRole('button', { name: 'Remove 3:00 AM' }).click();
    await expect(page.locator('.cl-time')).toHaveCount(3);
    expect(f.times).not.toContain('03:00');
  });

  test('a list can be left out of the reminders, and reminders switched off', async ({ page }) => {
    await start(page);
    const f = await fakeBackend(page, { email: 'a@b.com' });
    await openChecklist(page);
    await page.getByLabel('Remind me about Daily HC').click();
    await expect.poll(() => f.tracked).toEqual([]);
    await page.getByLabel('Send reminders').click();
    await expect.poll(() => f.enabled).toBe(false);
    await expect(page.locator('.cx-next')).toContainText('off');
  });

  // email UI is hidden for now (SHOW_EMAIL in ChecklistView); the backend still supports it
  test.skip('says so when the server cannot send mail yet, and sends a test mail when it can', async ({ page }) => {
    await start(page);
    await fakeBackend(page, { email: 'a@b.com', smtp: false });
    await openChecklist(page);
    await expect(page.locator('.cl-smtp')).toContainText('SMTP_HOST');
    await expect(page.getByRole('button', { name: /Send a test email/ })).toBeDisabled();

    await page.unroute(/\/api\/checklist/);
    const f = await fakeBackend(page, { email: 'a@b.com', smtp: true });
    await page.reload();
    await page.locator('.side-item', { hasText: 'Checklist' }).first().click();
    await expect(page.locator('.cl-smtp')).toHaveCount(0);
    await page.getByRole('button', { name: /Send a test email/ }).click();
    await expect(page.locator('.cl-ok')).toContainText('Test email sent to a@b.com');
    expect(f.calls.some((c) => c.url.endsWith('/test-mail'))).toBe(true);
  });

  test('Teams: connect with a workflow address, send a test message, disconnect; the address never comes back', async ({ page }) => {
    await start(page);
    const f = await fakeBackend(page);
    await openChecklist(page);
    const box = page.getByLabel('Teams workflow address');
    await expect(page.getByRole('button', { name: 'Connect' })).toBeDisabled();
    await box.fill('https://prod-1.westeurope.logic.azure.com/workflows/abc?sig=SECRET');
    await page.getByRole('button', { name: 'Connect' }).click();
    await expect(page.locator('.cl-teams')).toContainText('connected');
    expect(f.teamsUrl).toContain('logic.azure.com');
    await expect(page.getByLabel('Teams workflow address')).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toContain('SECRET');
    await expect(page.locator('.cx-next')).toContainText('Next reminder'); // Teams alone is enough
    await page.getByRole('button', { name: /Send a test message/ }).click();
    await expect(page.locator('.cl-ok').last()).toContainText('Test message sent to Teams');
    expect(f.calls.some((c) => c.url.endsWith('/test-teams'))).toBe(true);
    await page.getByRole('button', { name: 'Disconnect Teams' }).click();
    await expect(page.getByLabel('Teams workflow address')).toBeVisible();
    expect(f.teamsUrl).toBe('');
  });

  test('"Every N hours" fills in the reminder times', async ({ page }) => {
    await start(page);
    const f = await fakeBackend(page);
    await openChecklist(page);
    await page.getByLabel('Hours between reminders').selectOption('3');
    await page.getByRole('button', { name: 'Fill in the times' }).click();
    await expect(page.locator('.cl-time')).toHaveCount(8);
    expect(f.times).toEqual(['00:00', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00']);
    await page.getByLabel('Hours between reminders').selectOption('6');
    await page.getByLabel('First reminder time').fill('09:00');
    await page.getByRole('button', { name: 'Fill in the times' }).click();
    await expect.poll(() => f.times).toEqual(['09:00', '15:00', '21:00']);
  });

  test('"keep reminding until everything is ticked" saves, with its interval', async ({ page }) => {
    await start(page);
    const f = await fakeBackend(page);
    await openChecklist(page);
    const interval = page.getByLabel('Repeat interval');
    await expect(interval).toBeDisabled();
    await page.getByLabel('Keep reminding until everything is ticked').click();
    await expect.poll(() => f.repeat).toBe(true);
    await expect(interval).toBeEnabled();
    await interval.selectOption('120');
    await expect.poll(() => f.repeatMinutes).toBe(120);
  });

  test('no groups yet: explains how to make a list', async ({ page }) => {
    await start(page);
    await fakeBackend(page);
    await openChecklist(page, []);
    await expect(page.locator('.cx-empty')).toContainText('Daily HC');
    await page.getByRole('button', { name: 'Go to Customers' }).click();
    await expect(page.locator('.page-eyebrow')).toHaveText(/Customers/i);
  });

  test('the browser never wipes saved lists when it has no groups of its own', async ({ page }) => {
    await start(page);
    const f = await fakeBackend(page, { lists: [{ name: 'Saved earlier', members: ['x'] }] });
    await openChecklist(page, []);
    await expect(menu(page).getByRole('button', { name: /Saved earlier/ })).toBeVisible();
    expect(f.calls.filter((c) => c.method === 'PUT' && c.url.endsWith('/lists'))).toHaveLength(0);
  });
});
