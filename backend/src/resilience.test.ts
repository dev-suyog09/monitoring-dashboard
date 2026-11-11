import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_QUICK_RETRIES, QUICK_RETRY_MS, errorCount, networkTrouble, nextQuickRetry, restorable, slowAccounts } from './resilience.js';
import type { CheckResponse, CheckResult, Status } from './types.js';

const r = (name: string, status: Status): CheckResult => ({ accountName: name, auth: 'runtime-key', status, today: '2026-11-11', capturesWithToday: 0, capturesTotal: 0, captureFolders: [], error: status === 'error' ? 'Timed out' : null });
const many = (ok: number, bad: number): CheckResult[] => [...Array.from({ length: ok }, (_, i) => r(`ok${i}`, 'healthy')), ...Array.from({ length: bad }, (_, i) => r(`bad${i}`, 'error'))];
const response = (results: CheckResult[]): CheckResponse => ({ today: '2026-11-11', generatedAt: '2026-11-11T01:00:00Z', container: 'archive', results });

test('a few failing accounts are just those accounts; a wave of failures is the network', () => {
  assert.equal(networkTrouble(many(95, 5)), false, '5 of 100 failing is normal (firewalls, no access)');
  assert.equal(networkTrouble(many(75, 25)), true, 'a quarter failing together means the VPN / network');
  assert.equal(networkTrouble(many(0, 102)), true);
  assert.equal(networkTrouble(many(0, 3)), false, 'too few accounts for a share to mean anything');
  assert.equal(networkTrouble([]), false);
  assert.equal(errorCount(many(3, 4)), 4);
});

test('a restart never shows the failures of an earlier scan, only what was read successfully', () => {
  const saved = response([...many(3, 2), r('ts1', 'missing_today'), r('x', 'no_data')]);
  const out = restorable(saved)!;
  assert.equal(out.results.length, 3 + 2, 'the 2 errors are dropped; healthy, missing_today and no_data stay');
  assert.ok(out.results.every((x) => x.status !== 'error'));
  assert.equal(out.generatedAt, saved.generatedAt, 'it keeps the time it was really gathered');
  assert.equal(restorable(response(many(0, 50))), null, 'a scan made entirely of failures restores nothing');
  assert.equal(restorable({ ...saved, results: undefined as unknown as CheckResult[] }), null);
});

test('after a bad scan the next one comes within a minute, a limited number of times', () => {
  assert.equal(nextQuickRetry(many(95, 5), 0), null, 'a healthy scan waits for the normal 15-minute timer');
  assert.equal(nextQuickRetry(many(0, 100), 0), QUICK_RETRY_MS);
  assert.equal(nextQuickRetry(many(0, 100), MAX_QUICK_RETRIES - 1), QUICK_RETRY_MS);
  assert.equal(nextQuickRetry(many(0, 100), MAX_QUICK_RETRIES), null, 'then it falls back to the normal timer');
  assert.ok(QUICK_RETRY_MS <= 60_000);
});

test('an account that only timed out gets another try; firewall blocks and network-wide failures do not', () => {
  const slow = { ...r('heavy', 'error'), error: 'Timed out — no response in time.' };
  const blocked = { ...r('ita', 'error'), error: "Blocked by the storage account's firewall — this machine's IP isn't allowlisted." };
  const list = [...many(40, 0), slow, blocked];
  assert.deepEqual(slowAccounts(list).map((x) => x.accountName), ['heavy'], 'only the timeout is retried');
  const wave = [...many(0, 30).map((x) => ({ ...x, error: 'Timed out — no response in time.' })), ...many(10, 0)];
  assert.deepEqual(slowAccounts(wave), [], 'a wave of timeouts is the network, not slow accounts');
  assert.deepEqual(slowAccounts(many(10, 0)), []);
});
