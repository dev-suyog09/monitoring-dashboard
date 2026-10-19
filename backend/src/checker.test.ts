import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, todayStr } from './checker.js';

const TODAY = '2026-07-14';

test('healthy when a capture folder has today', () => {
  const { status, capturesWithToday } = summarize(
    [{ name: 'lane1', dates: ['2026-07-13', '2026-07-14'] }],
    TODAY,
  );
  assert.equal(status, 'healthy');
  assert.equal(capturesWithToday, 1);
});

test('missing_today when captures exist but none has today', () => {
  const { status, capturesWithToday } = summarize(
    [{ name: 'lane1', dates: ['2026-07-12', '2026-07-13'] }],
    TODAY,
  );
  assert.equal(status, 'missing_today');
  assert.equal(capturesWithToday, 0);
});

test('no_data when there are no capture folders', () => {
  const { status } = summarize([], TODAY);
  assert.equal(status, 'no_data');
});

test('partial: one of several captures has today -> healthy but counted', () => {
  const { status, capturesWithToday, captureFolders } = summarize(
    [
      { name: 'lane1', dates: ['2026-07-14'] },
      { name: 'lane2', dates: ['2026-07-10'] },
    ],
    TODAY,
  );
  assert.equal(status, 'healthy');
  assert.equal(capturesWithToday, 1);
  assert.equal(captureFolders.length, 2);
});

test('ignores non-date folder names and sorts newest first', () => {
  const { captureFolders } = summarize(
    [{ name: 'lane1', dates: ['garbage', '2026-01-01', '2026-07-14', 'temp'] }],
    TODAY,
  );
  assert.deepEqual(captureFolders[0]!.recentDates, ['2026-07-14', '2026-01-01']);
  assert.equal(captureFolders[0]!.latestDate, '2026-07-14');
});

test('todayStr formats as YYYY-MM-DD', () => {
  assert.match(todayStr(new Date('2026-07-14T09:00:00')), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(todayStr(new Date(2026, 0, 5)), '2026-01-05');
});

import { classifyFile, pickLatest } from './files.js';

test('classifyFile maps extensions to chat / media / other', () => {
  assert.equal(classifyFile('abc.chat'), 'chat');
  assert.equal(classifyFile('abc.CHAT'), 'chat');
  assert.equal(classifyFile('abc.MP3'), 'media');
  assert.equal(classifyFile('abc.wav'), 'media');
  assert.equal(classifyFile('abc.json'), 'other');
  assert.equal(classifyFile('abc.bin'), 'other');
});

test('pickLatest keeps the newest N per kind and counts totals', () => {
  const mk = (name: string, t: string) => ({ name, kind: classifyFile(name), sizeBytes: 1, lastModified: t });
  const files = [
    mk('a.chat', '2026-10-13T01:00:00.000Z'),
    mk('b.chat', '2026-10-13T03:00:00.000Z'),
    mk('c.chat', '2026-10-13T02:00:00.000Z'),
    mk('a.mp3', '2026-10-13T01:00:00.000Z'),
    mk('a.json', '2026-10-13T01:00:00.000Z'),
  ];
  const out = pickLatest(files, 2);
  assert.deepEqual(out.totals, { chat: 3, media: 1, other: 1 });
  assert.deepEqual(out.chat.map((f) => f.name), ['b.chat', 'c.chat']);
  assert.deepEqual(out.media.map((f) => f.name), ['a.mp3']);
  assert.deepEqual(out.other.map((f) => f.name), ['a.json']);
});

import { isStuck, summarizeBot, groupBlobs } from './bot.js';
import { groupKey } from './azure.js';

test('groupKey pairs srd and rec resource groups of one tenant', () => {
  assert.equal(groupKey('adcprdntx-uaen-grp-srd-01'), 'adcprdnt-uaen');
  assert.equal(groupKey('adcprdntx-uaen-grp-rec-02'), 'adcprdnt-uaen');
  assert.equal(groupKey('adcprdntx-uaen-grp-cmn-01'), null);
  assert.equal(groupKey(undefined), null);
  assert.equal(groupKey('dbprdntx-gewc-grp-srd-01'), groupKey('dbprdntrx-gewc-grp-rec-02'));
});

test('isStuck uses the age of the newest blob', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  assert.equal(isStuck('2026-10-14T11:50:00Z', now, 60 * 60_000), false);
  assert.equal(isStuck('2026-10-14T10:00:00Z', now, 60 * 60_000), true);
  assert.equal(isStuck(null, now, 60 * 60_000), false); // empty folder shell
});

const OPTS = { container: 'audio-video', stuckMinutes: 60, windowDays: 3 };

test('summarizeBot: none / clean / stuck / error roll-up', () => {
  const acct = (status: 'clean' | 'stuck' | 'error', stuckCount = 0) => ({
    accountName: 'b', status, totalInteractions: stuckCount, stuckCount, olderCount: 0, truncated: false,
    interactions: [], error: null,
  });
  assert.equal(summarizeBot([], OPTS).status, 'none');
  assert.equal(summarizeBot([acct('clean')], OPTS).status, 'clean');
  assert.equal(summarizeBot([acct('clean'), acct('stuck', 3)], OPTS).stuckCount, 3);
  assert.equal(summarizeBot([acct('error'), acct('stuck', 1)], OPTS).status, 'stuck');
  assert.equal(summarizeBot([acct('error'), acct('clean')], OPTS).status, 'error');
});

test('groupBlobs: lists stuck within window newest-first, counts older, ignores in-progress', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  const blob = (name: string, iso: string) => ({ name, sizeBytes: 10, lastModified: iso });
  const r = groupBlobs(
    [
      blob('a/dat.txt', '2026-10-13T08:00:00Z'), // 1 day ago -> stuck, listed
      blob('a/metadata.json', '2026-10-13T08:00:30Z'),
      blob('b/dat.txt', '2026-10-14T09:00:00Z'), // 3h ago -> stuck, newer than a
      blob('c/dat.txt', '2026-10-14T11:30:00Z'), // 30 min -> in progress
      blob('d/dat.txt', '2026-10-01T00:00:00Z'), // older than 3 days -> counted only
      blob('rootfile.txt', '2026-10-14T09:00:00Z'), // not in a folder
    ],
    now,
    60 * 60_000,
    3 * 86_400_000,
  );
  assert.deepEqual(r.interactions.map((i) => i.id), ['b', 'a']);
  assert.equal(r.interactions[1]!.fileCount, 2);
  assert.equal(r.olderCount, 1);
  assert.equal(r.totalInteractions, 4);
});

import { parseRoleState, latestMaximum, latestBackupByDb, usedPercent } from './infra.js';

test('parseRoleState extracts the role state or Unknown', () => {
  assert.equal(parseRoleState([{ code: 'RoleState/RoleStateStarted', displayStatus: 'RoleStateStarted' }]), 'Started');
  assert.equal(parseRoleState([{ displayStatus: 'RoleStateStarting' }]), 'Starting');
  assert.equal(parseRoleState([]), 'Unknown');
  assert.equal(parseRoleState(undefined), 'Unknown');
});

test('latestMaximum picks the newest non-zero datapoint', () => {
  assert.equal(
    latestMaximum([
      { timeStamp: '2026-10-19T01:00:00Z', maximum: 100 },
      { timeStamp: '2026-10-19T03:00:00Z', maximum: 300 },
      { timeStamp: '2026-10-19T04:00:00Z', maximum: 0 },
      { timeStamp: '2026-10-19T05:00:00Z' },
    ]),
    300,
  );
  assert.equal(latestMaximum(undefined), 0);
});

test('latestBackupByDb keeps the newest backup per database (case-insensitive)', () => {
  const m = latestBackupByDb([
    { properties: { databaseName: 'Portal', backupTime: '2026-09-19T16:00:00Z' } },
    { properties: { databaseName: 'portal', backupTime: '2026-09-26T16:00:00Z' } },
    { properties: { databaseName: 'dsm', backupTime: '2026-09-01T00:00:00Z' } },
  ]);
  assert.equal(m.get('portal'), '2026-09-26T16:00:00Z');
  assert.equal(m.get('dsm'), '2026-09-01T00:00:00Z');
});

test('usedPercent is N/A without data and rounds to 2 dp', () => {
  const GB = 2 ** 30;
  assert.equal(usedPercent(0, 250 * GB), null);
  assert.equal(usedPercent(10 * GB, 0), null);
  assert.equal(usedPercent(200 * GB, 250 * GB), 80);
  assert.equal(usedPercent(1 * GB, 3 * GB), 33.33);
});

import { selectBots, selectDbs, parseBotName } from './infra.js';

const svc = (name: string) => ({
  subscriptionId: 's', subscription: 'S', resourceGroup: 'rg', name, running: 0, total: 0, checkedAt: null, error: null,
});

test('parseBotName extracts customer and env', () => {
  assert.deepEqual(parseBotName('dbprdntrx-gewc-cs-bot-11'), { customer: 'db', env: 'prd' });
  assert.deepEqual(parseBotName('nedprdntx-euw-cs-bot-01'), { customer: 'ned', env: 'prd' });
  assert.deepEqual(parseBotName('weird'), { customer: 'weird', env: 'other' });
});

test('selectBots scopes by customer+env, by service, or everything', () => {
  const all = [svc('dbprdntrx-gewc-cs-bot-11'), svc('dbuatntx-gewc-cs-bot-01'), svc('nedprdntx-euw-cs-bot-01')];
  assert.equal(selectBots(all, {}).length, 3);
  assert.deepEqual(selectBots(all, { customer: 'db', env: 'prd' }).map((c) => c.name), ['dbprdntrx-gewc-cs-bot-11']);
  assert.equal(selectBots(all, { customer: 'DB' }).length, 2);
  assert.deepEqual(selectBots(all, { service: 'NEDPRDNTX-EUW-CS-BOT-01' }).map((c) => c.name), ['nedprdntx-euw-cs-bot-01']);
  assert.equal(selectBots(all, { customer: 'zzz' }).length, 0);
});

test('selectDbs scopes by server and database', () => {
  const db = (server: string, name: string) => ({
    subscriptionId: 's', subscription: 'S', resourceGroup: 'rg', server, location: 'l', name, status: 'Online',
    totalGB: 10, tier: 'Standard', isDtu: true, checkedAt: null, latestBackup: null, backupChecked: false, usedGB: null, usedPct: null,
    dtuPct: null, dtuAt: null,
  });
  const all = [db('a', 'portal'), db('a', 'dsm'), db('b', 'portal')];
  assert.equal(selectDbs(all, {}).length, 3);
  assert.equal(selectDbs(all, { server: 'A' }).length, 2);
  assert.equal(selectDbs(all, { server: 'a', db: 'DSM' }).length, 1);
});

import { isDtuTier, latestReading } from './infra.js';

test('isDtuTier recognises the DTU-model tiers only', () => {
  for (const t of ['Basic', 'Standard', 'Premium', 'standard']) assert.equal(isDtuTier(t), true);
  for (const t of ['GeneralPurpose', 'BusinessCritical', 'Hyperscale', '', undefined]) assert.equal(isDtuTier(t), false);
});

test('latestReading returns the newest datapoint (including a real 0) or nulls', () => {
  assert.deepEqual(
    latestReading([
      { timeStamp: '2026-10-19T10:00:00Z', average: 40 },
      { timeStamp: '2026-10-19T10:02:00Z', average: 95.456 },
      { timeStamp: '2026-10-19T10:03:00Z' },
    ]),
    { value: 95.46, at: '2026-10-19T10:02:00Z' },
  );
  assert.deepEqual(latestReading([{ timeStamp: '2026-10-19T10:01:00Z', average: 0 }]), { value: 0, at: '2026-10-19T10:01:00Z' });
  assert.deepEqual(latestReading([]), { value: null, at: null });
  assert.deepEqual(latestReading(undefined), { value: null, at: null });
});

test('selectBots scopes by subscription', () => {
  const a = { ...svc('adcprdntx-uaen-cs-bot-01'), subscriptionId: 'sub-A' };
  const b = { ...svc('nedprdntx-euw-cs-bot-01'), subscriptionId: 'sub-B' };
  assert.deepEqual(selectBots([a, b], { subscriptionId: 'SUB-A' }).map((c) => c.name), ['adcprdntx-uaen-cs-bot-01']);
  assert.equal(selectBots([a, b], {}).length, 2);
});
