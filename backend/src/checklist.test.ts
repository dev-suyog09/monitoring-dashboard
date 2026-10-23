import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadInput, buildMail, cleanLists, dueSlots, emptyState, mark, markSent, nextReminder, pending, setLists, setProfile } from './checklist.js';

const at = (iso: string) => new Date(iso); // local time, no zone suffix
const base = () => setLists({ ...emptyState(), email: 'a@b.com' }, cleanLists([{ name: 'Daily HC', members: ['adc', 'atd', 'bom'] }]));

test('pending lists what is unticked; ticking and unticking work', () => {
  let s = base();
  assert.deepEqual(pending(s, '2026-10-23')[0]?.missing, ['adc', 'atd', 'bom']);
  s = mark(s, '2026-10-23', 'Daily HC', 'adc', true);
  assert.deepEqual(pending(s, '2026-10-23')[0]?.missing, ['atd', 'bom']);
  assert.deepEqual(pending(s, '2026-10-24')[0]?.missing.length, 3, 'a new day starts unticked');
  s = mark(s, '2026-10-23', 'Daily HC', null, true);
  assert.equal(pending(s, '2026-10-23').length, 0);
  s = mark(s, '2026-10-23', 'Daily HC', 'bom', false);
  assert.deepEqual(pending(s, '2026-10-23')[0]?.missing, ['bom']);
});

test('only tracked lists are reminded about; empty lists never are', () => {
  let s = setLists(base(), cleanLists([{ name: 'Daily HC', members: ['a'] }, { name: 'Weekly', members: ['b'] }, { name: 'Empty', members: [] }]));
  assert.deepEqual(pending(s, 'd').map((p) => p.name), ['Daily HC', 'Weekly']);
  s = setProfile(s, { tracked: ['Weekly'] });
  assert.deepEqual(pending(s, 'd').map((p) => p.name), ['Weekly']);
});

test('slots come due at 12 AM, 3 AM and 6 AM, once, and not when they are long past', () => {
  let s = base();
  assert.deepEqual(dueSlots(s, at('2026-10-23T00:00:30')), ['00:00']);
  assert.deepEqual(dueSlots(s, at('2026-10-23T00:59:00')), ['00:00'], 'still inside the grace hour');
  assert.deepEqual(dueSlots(s, at('2026-10-23T01:30:00')), [], 'missed by more than the grace hour');
  assert.deepEqual(dueSlots(s, at('2026-10-23T03:05:00')), ['03:00']);
  s = markSent(s, '2026-10-23', '03:00');
  assert.deepEqual(dueSlots(s, at('2026-10-23T03:06:00')), [], 'sent once only');
  assert.deepEqual(dueSlots(s, at('2026-10-24T03:06:00')), ['03:00'], 'and again the next day');
});

test('next reminder', () => {
  const s = base();
  assert.equal(nextReminder(s, at('2026-10-23T01:00:00'))?.getHours(), 3);
  const n = nextReminder(s, at('2026-10-23T07:00:00'))!;
  assert.equal(n.getDate(), 24);
  assert.equal(n.getHours(), 0);
  assert.equal(nextReminder({ ...s, enabled: false }, at('2026-10-23T01:00:00')), null);
  assert.equal(nextReminder({ ...s, email: '' }, at('2026-10-23T01:00:00')), null);
});

test('input is validated', () => {
  assert.throws(() => setProfile(emptyState(), { email: 'nope' }), BadInput);
  assert.throws(() => setProfile(emptyState(), { email: 'a@b.com\r\nBcc: x@y.com' }), BadInput);
  assert.throws(() => setProfile(emptyState(), { times: ['25:00'] }), BadInput);
  assert.throws(() => setProfile(emptyState(), { times: Array(25).fill('01:00') }), BadInput);
  assert.throws(() => cleanLists('x'), BadInput);
  assert.throws(() => cleanLists([{ name: '', members: [] }]), BadInput);
  assert.throws(() => mark(base(), 'd', 'Nope', null, true), BadInput);
  assert.throws(() => mark(base(), 'd', 'Daily HC', 'zzz', true), BadInput);
  assert.deepEqual(setProfile(emptyState(), { times: ['06:00', '00:00', '06:00'] }).times, ['00:00', '06:00']);
  assert.equal(cleanLists([{ name: '__proto__', members: ['x'] }])[0]?.name, '__proto__'); // kept as plain data, never used as an object key
});

test('mail escapes names and says what is missing', () => {
  const m = buildMail([{ name: 'Daily <HC>', missing: ['a&b'], total: 3 }], '03:00', '2026-10-23', 'http://localhost:3001/');
  assert.match(m.subject, /1 of 3 not checked yet \(3 AM\)/);
  assert.ok(m.html.includes('Daily &lt;HC&gt;') && m.html.includes('a&amp;b'));
  assert.ok(!m.html.includes('<HC>'));
  assert.match(m.text, /still to check: a&b/);
});

import { buildTeams, isTeamsUrl } from './checklist.js';
import { sendTeams } from './teams.js';

test('only Microsoft webhook addresses are accepted for Teams', () => {
  for (const ok of [
    'https://prod-12.westeurope.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?sig=x'.replace(':443', ''),
    'https://default1234.12.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/abc/triggers/manual/paths/invoke?sig=x',
    'https://contoso.webhook.office.com/webhookb2/abc',
    'https://outlook.office.com/webhook/abc',
  ])
    assert.equal(isTeamsUrl(ok), true, ok);
  for (const bad of [
    'http://prod-12.westeurope.logic.azure.com/x',
    'https://evil.example.com/logic.azure.com',
    'https://logic.azure.com.evil.com/x',
    'https://user:pw@prod-12.logic.azure.com/x',
    'https://127.0.0.1/x',
    'https://localhost/x',
    'https://prod-12.logic.azure.com:8443/x',
    'not a url',
    '',
    `https://a.logic.azure.com/${'x'.repeat(2100)}`,
  ])
    assert.equal(isTeamsUrl(bad), false, bad.slice(0, 50));
  assert.throws(() => setProfile(emptyState(), { teamsUrl: 'https://evil.example.com/x' }), BadInput);
  assert.equal(setProfile({ ...emptyState(), teamsUrl: 'https://a.logic.azure.com/x' }, { teamsUrl: '' }).teamsUrl, '');
});

test('email and Teams are tracked separately, so one failing never repeats the other', () => {
  let s = setProfile(base(), { teamsUrl: 'https://a.logic.azure.com/x' });
  const now = at('2026-10-23T03:05:00');
  s = markSent(s, '2026-10-23', '03:00', 'email');
  assert.deepEqual(dueSlots(s, now, 'email'), []);
  assert.deepEqual(dueSlots(s, now, 'teams'), ['03:00']);
  s = markSent(s, '2026-10-23', '03:00', 'teams');
  assert.deepEqual(dueSlots(s, now, 'teams'), []);
  assert.ok(nextReminder({ ...emptyState(), teamsUrl: 'https://a.logic.azure.com/x' }, at('2026-10-23T01:00:00')), 'Teams alone is enough for reminders');
});

test('Teams card lists what is missing; sendTeams posts it to the secret URL and never leaks it', async () => {
  const card = JSON.stringify(buildTeams([{ name: 'Daily HC', missing: ['atd', 'bom'], total: 3 }], '03:00', '2026-10-23', 'http://localhost:3001/'));
  assert.match(card, /2 of 3 not checked yet/);
  assert.match(card, /Still to check: atd, bom/);
  const url = 'https://a.logic.azure.com/secret?sig=SECRET';
  let seen: { url: string; body: string; redirect?: string } | null = null;
  await sendTeams(url, { hello: 1 }, (async (u: string, init: RequestInit) => {
    seen = { url: u, body: String(init.body), redirect: init.redirect };
    return new Response('', { status: 202 });
  }) as unknown as typeof fetch);
  assert.deepEqual(seen, { url, body: '{"hello":1}', redirect: 'error' });
  await assert.rejects(sendTeams(url, {}, (async () => new Response('', { status: 400 })) as unknown as typeof fetch), (e: Error) => !e.message.includes('SECRET'));
  await assert.rejects(sendTeams('https://evil.example.com/x', {}), /not set up/);
});

import { effectiveTimes, takeDue } from './checklist.js';

test('repeat: after the first time, every N minutes until midnight; off = just the chosen times', () => {
  let s = setProfile(base(), { times: ['09:00'] });
  assert.deepEqual(effectiveTimes(s), ['09:00']);
  s = setProfile(s, { repeat: true, repeatMinutes: 180 });
  assert.deepEqual(effectiveTimes(s), ['09:00', '12:00', '15:00', '18:00', '21:00']);
  s = setProfile(s, { times: ['00:00', '03:00', '06:00'], repeatMinutes: 120 });
  assert.equal(effectiveTimes(s).length, 13); // 12 two-hourly slots from 00:00, plus the chosen 03:00
  assert.ok(effectiveTimes(s).includes('03:00') && effectiveTimes(s).includes('22:00') && !effectiveTimes(s).includes('24:00'));
  assert.throws(() => setProfile(s, { repeatMinutes: 7 }), BadInput);
  assert.throws(() => setProfile(s, { repeat: 'yes' }), BadInput);
});

test('"every N hours" can use up to 24 times; more is refused', () => {
  const hourly = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);
  assert.equal(setProfile(emptyState(), { times: hourly }).times.length, 24);
  assert.throws(() => setProfile(emptyState(), { times: [...hourly, '00:30'] }), BadInput);
});

test('repeat keeps reminding while unticked, and stops once everything is ticked', () => {
  let s = setProfile(base(), { times: ['09:00'], repeat: true, repeatMinutes: 60 });
  const d = '2026-10-23';
  let t = takeDue(s, d, at('2026-10-23T09:00:10'), 'teams');
  assert.equal(t.slot, '09:00');
  s = markSent(t.state, d, '09:00', 'teams');
  assert.equal(takeDue(s, d, at('2026-10-23T09:30:00'), 'teams').slot, null, 'not before the next interval');
  t = takeDue(s, d, at('2026-10-23T10:00:05'), 'teams');
  assert.equal(t.slot, '10:00');
  s = markSent(t.state, d, '10:00', 'teams');
  s = mark(s, d, 'Daily HC', null, true); // everything ticked
  assert.equal(pending(s, d).length, 0, 'tick() sends nothing when nothing is pending');
  assert.equal(takeDue(s, '2026-10-24', at('2026-10-24T09:00:10'), 'teams').slot, '09:00', 'a new day starts again');
});

test('after downtime only the newest due reminder is sent, the older ones are dropped', () => {
  const s = setProfile(base(), { times: ['09:00'], repeat: true, repeatMinutes: 15 });
  const t = takeDue(s, '2026-10-23', at('2026-10-23T09:50:00'), 'email'); // 09:00 is 50 min ago: 09:00..09:45 are all due
  assert.equal(t.slot, '09:45');
  assert.deepEqual(dueSlots(markSent(t.state, '2026-10-23', '09:45'), at('2026-10-23T09:50:00')), []);
});
