import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sam-cache-'));
process.env.CACHE_DIR = dir; // read when the module loads
const { readCache, writeCacheSoon } = await import('./cache.js');

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('a written value is read back after the (short) write delay', async () => {
  assert.equal(readCache('nothing-yet'), null);
  writeCacheSoon('sample', { a: 1, list: ['x', 'y'] }, 20);
  await wait(120);
  assert.deepEqual(readCache('sample'), { a: 1, list: ['x', 'y'] });
});

test('bursts of writes are coalesced and the last one wins', async () => {
  for (let i = 1; i <= 5; i++) writeCacheSoon('burst', { n: i }, 30);
  await wait(150);
  assert.deepEqual(readCache('burst'), { n: 5 });
});

test('a corrupt cache file is ignored, not fatal', () => {
  fs.writeFileSync(path.join(dir, 'broken.json'), '{ this is not json');
  assert.equal(readCache('broken'), null);
});

test('no half-written temp files are left behind', async () => {
  writeCacheSoon('clean', { ok: true }, 10);
  await wait(100);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
});
