import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ContainerClient } from '@azure/storage-blob';
import type { ShareClient } from '@azure/storage-file-share';
import { checkAccount, isNotFound, mergeCaptures, overallSource } from './checker.js';
import { listLatestFilesShare, SHARE_TIME_FOLDERS } from './files.js';
import type { AccountClient } from './types.js';

const TODAY = '2026-11-06';

/** A tree: { capture: { date: { timeFolder: [files] } } } for the fake blob container and file share. */
type Tree = Record<string, Record<string, Record<string, string[]>>>;

/** Fake blob container: only the hierarchical listing the checker uses. */
function fakeContainer(tree: Tree | Error): ContainerClient {
  return {
    listBlobsByHierarchy(_d: string, opts: { prefix: string }) {
      return (async function* () {
        if (tree instanceof Error) throw tree;
        const parts = opts.prefix.split('/').filter(Boolean);
        const names = parts.length === 0 ? Object.keys(tree) : Object.keys(tree[parts[0]!] ?? {});
        for (const n of names) yield { kind: 'prefix', name: `${opts.prefix}${n}/` };
      })();
    },
  } as unknown as ContainerClient;
}

/** Fake file share: directories and files, keyed by path. */
function fakeShare(tree: Tree | Error): ShareClient {
  return {
    getDirectoryClient(dir: string) {
      const parts = dir.split('/').filter(Boolean);
      return {
        getDirectoryClient: (sub: string) => (this as unknown as ShareClient).getDirectoryClient([...parts, sub].join('/')),
        listFilesAndDirectories() {
          return (async function* () {
            if (tree instanceof Error) throw tree;
            if (parts.length === 0) for (const n of Object.keys(tree)) yield { kind: 'directory', name: n };
            else if (parts.length === 1) for (const n of Object.keys(tree[parts[0]!] ?? {})) yield { kind: 'directory', name: n };
            else if (parts.length === 2) for (const n of Object.keys(tree[parts[0]!]?.[parts[1]!] ?? {})) yield { kind: 'directory', name: n };
            else for (const f of tree[parts[0]!]?.[parts[1]!]?.[parts[2]!] ?? []) yield { kind: 'file', name: f, properties: { contentLength: 10, lastWriteTime: new Date('2026-11-06T10:00:00Z') } };
          })();
        },
      };
    },
  } as unknown as ShareClient;
}

const err = (code: string, message = code) => Object.assign(new Error(message), { code });
const client = (blob: Tree | Error, share?: Tree | Error): AccountClient => ({
  accountName: 'fbpprdukssasrd01',
  auth: 'runtime-key',
  getArchiveContainer: () => fakeContainer(blob),
  ...(share ? { getArchiveShare: () => fakeShare(share) } : {}),
});

const withToday: Tree = { 'ntx-pw-por1-fbp': { '2026-11-05': {}, [TODAY]: {} } };
const noToday: Tree = { 'ntx-pw-por1-fbp': { '2026-11-05': {} } };

test('FBP case: the blob container is empty but the file share has today -> healthy, source file-share', async () => {
  const r = await checkAccount(client({}, withToday), TODAY);
  assert.equal(r.status, 'healthy');
  assert.equal(r.source, 'file-share');
  assert.equal(r.captureFolders[0]!.source, 'file-share');
  assert.equal(r.capturesWithToday, 1);
});

test('blob only (no file share on the account) behaves as before', async () => {
  const r = await checkAccount(client(withToday, err('ShareNotFound')), TODAY);
  assert.equal(r.status, 'healthy');
  assert.equal(r.source, 'blob');
  assert.equal(r.error, null);
});

test('no share configured at all -> same result as before the file-share check existed', async () => {
  const r = await checkAccount(client(noToday), TODAY);
  assert.equal(r.status, 'missing_today');
  assert.equal(r.source, 'blob');
});

test('neither place exists -> no_data, not an error', async () => {
  const r = await checkAccount(client(err('ContainerNotFound'), err('ShareNotFound')), TODAY);
  assert.equal(r.status, 'no_data');
  assert.equal(r.error, null);
  assert.equal(r.source, undefined);
});

test('both places hold the capture -> dates are merged and the source is both', async () => {
  const blob: Tree = { 'ntx-pw-por1-fbp': { '2026-11-04': {} } };
  const share: Tree = { 'ntx-pw-por1-fbp': { [TODAY]: {} } };
  const r = await checkAccount(client(blob, share), TODAY);
  assert.equal(r.status, 'healthy');
  assert.equal(r.source, 'both');
  assert.deepEqual(r.captureFolders[0]!.recentDates, [TODAY, '2026-11-04']);
});

test('missing today everywhere -> missing_today (the share is not an excuse to say healthy)', async () => {
  const r = await checkAccount(client({}, noToday), TODAY);
  assert.equal(r.status, 'missing_today');
  assert.equal(r.source, 'file-share');
});

test('the share is unreadable and the blob side has nothing for today -> error, never a false "missing"', async () => {
  const r = await checkAccount(client(noToday, err('AuthorizationFailure')), TODAY);
  assert.equal(r.status, 'error');
  assert.match(r.error ?? '', /firewall/i);
});

test('the share is unreadable but the blob side has today -> still healthy', async () => {
  const r = await checkAccount(client(withToday, err('AuthorizationFailure')), TODAY);
  assert.equal(r.status, 'healthy');
  assert.equal(r.error, null);
});

test('the blob side is unreadable but the share has today -> still healthy', async () => {
  const r = await checkAccount(client(err('AuthorizationFailure'), withToday), TODAY);
  assert.equal(r.status, 'healthy');
  assert.equal(r.source, 'file-share');
});

test('mergeCaptures / overallSource / isNotFound', () => {
  const m = mergeCaptures([{ name: 'a', dates: ['2026-01-01'] }, { name: 'b', dates: [] }], [{ name: 'a', dates: ['2026-01-02'] }, { name: 'c', dates: [] }]);
  assert.deepEqual(m.map((x) => [x.name, x.source]), [['a', 'both'], ['b', 'blob'], ['c', 'file-share']]);
  assert.deepEqual(m[0]!.dates.sort(), ['2026-01-01', '2026-01-02']);
  assert.equal(overallSource(m), 'both');
  assert.equal(overallSource([{ source: 'file-share' }]), 'file-share');
  assert.equal(overallSource([]), undefined);
  assert.ok(isNotFound(err('ShareNotFound')));
  assert.ok(isNotFound(err('ContainerNotFound')));
  assert.ok(!isNotFound(err('AuthorizationFailure')));
});

test('latest files on a share: reads the HH_MM time folders, newest kinds picked, flagged partial when the day is large', async () => {
  const small: Tree = { cap: { [TODAY]: { '09_00': ['a.json', 'a.mp4'], '09_10': ['b.json', 'b.mp4', 'c.chat'] } } };
  const out = await listLatestFilesShare(fakeShare(small), 'cap', TODAY);
  assert.deepEqual(out.totals, { chat: 1, media: 2, other: 2 });
  assert.equal(out.partial, undefined);

  const folders: Record<string, string[]> = {};
  for (let i = 0; i < SHARE_TIME_FOLDERS + 5; i++) folders[`t${String(i).padStart(4, '0')}`] = ['x.mp4'];
  const big = await listLatestFilesShare(fakeShare({ cap: { [TODAY]: folders } }), 'cap', TODAY);
  assert.equal(big.partial, true);
  assert.equal(big.totals.media, SHARE_TIME_FOLDERS);
});
