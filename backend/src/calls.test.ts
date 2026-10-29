import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CALLS, CALLS_GROSS, LOAD, isGuid, rows, seriesQuery, shapeGroup, summaryQuery } from './calls.js';

test('only real subscription ids are accepted', () => {
  assert.equal(isGuid('542bfa7e-21d6-4261-a4ac-adb6fb6bbca2'), true);
  for (const bad of ['', 'x', "542bfa7e-21d6-4261-a4ac-adb6fb6bbca2'; drop", '542bfa7e21d64261a4acadb6fb6bbca2', undefined, 5]) assert.equal(isGuid(bad), false);
});

test('queries only contain constants and a number of hours', () => {
  const q = summaryQuery(6);
  assert.match(q, /ago\(6h\)/);
  assert.ok(q.includes(`'${CALLS}'`) && q.includes(`'${LOAD}'`));
  assert.match(seriesQuery(1), /bin\(timestamp, 2m\)/);
  assert.match(seriesQuery(24), /bin\(timestamp, 48m\)/);
});

test('App Insights answers become row objects', () => {
  const body = { Tables: [{ Columns: [{ ColumnName: 'name' }, { ColumnName: 'n' }], Rows: [['a', 1], ['b', 2]] }] };
  assert.deepEqual(rows(body), [{ name: 'a', n: 1 }, { name: 'b', n: 2 }]);
  assert.deepEqual(rows(null), []);
  assert.deepEqual(rows({ Tables: [] }), []);
});

test('a recording group adds up its bot instances; peak is the busiest moment of the group', () => {
  const t = '2026-10-29T10:00:00Z';
  const summary = [
    { name: CALLS, cloud_RoleInstance: 'bot_1', timestamp: t, value: 12, peak: 30, avg: 10.26 },
    { name: CALLS_GROSS, cloud_RoleInstance: 'bot_1', timestamp: t, value: 14 },
    { name: LOAD, cloud_RoleInstance: 'bot_1', timestamp: t, value: 41.234 },
    { name: CALLS, cloud_RoleInstance: 'bot_2', timestamp: '2026-10-29T10:01:00Z', value: 8, peak: 25, avg: 7 },
    { name: LOAD, cloud_RoleInstance: 'bot_2', timestamp: t, value: 55.5 },
  ];
  const series = [{ timestamp: 'a', total: 20 }, { timestamp: 'b', total: 41 }, { timestamp: 'c', total: 20 }];
  const g = shapeGroup('botAppInsightsx', 'rg', summary, series);
  assert.equal(g.calls, 20);
  assert.equal(g.peak, 41, 'not 30 + 25');
  assert.equal(g.load, 55.5);
  assert.equal(g.lastSeen, '2026-10-29T10:01:00Z');
  assert.deepEqual(g.instances.map((i) => [i.instance, i.calls, i.gross, i.load]), [['bot_1', 12, 14, 41.2], ['bot_2', 8, null, 55.5]]);
  assert.equal(g.series.length, 3);
});

test('a group that reported nothing is shown as empty, not as zero calls', () => {
  const g = shapeGroup('x', 'rg', [], []);
  assert.equal(g.calls, null);
  assert.equal(g.peak, null);
  assert.equal(g.lastSeen, null);
  assert.deepEqual(g.instances, []);
});

import { METRIC_NAMES, binMinutes, dropIncompleteSlot, shapeSeries, timeSeriesQuery, trimNewestSlot } from './calls.js';

test('time-series queries only use catalogue names, allowed aggregations and a number of hours', () => {
  const q = timeSeriesQuery('calls', 24, 'avg');
  assert.match(q, /ago\(24h\)/);
  assert.match(q, /summarize v=avg\(value\)/);
  assert.ok(q.includes(`'${METRIC_NAMES.calls}'`));
  assert.throws(() => timeSeriesQuery('nope', 1, 'max'));
  assert.throws(() => timeSeriesQuery('__proto__', 1, 'max'));
  assert.throws(() => timeSeriesQuery('calls', 1, 'max); drop' as never));
  assert.equal(binMinutes(1), 1);
  assert.equal(binMinutes(168), 140);
});

test('series rows become compact cells: time x bot instance', () => {
  const g = shapeSeries('x', 'rg', [
    { timestamp: '2026-10-29T10:00:00Z', cloud_RoleInstance: 'a', v: 3, t: '2026-10-29T10:00:40Z' },
    { timestamp: '2026-10-29T10:00:00Z', cloud_RoleInstance: 'b', v: 1.234, t: '2026-10-29T10:00:50Z' },
    { timestamp: '2026-10-29T10:05:00Z', cloud_RoleInstance: 'a', v: 4, t: '2026-10-29T10:05:20Z' },
    { timestamp: '2026-10-29T10:05:00Z', cloud_RoleInstance: 'b', v: null },
  ]);
  assert.deepEqual(g.times, ['2026-10-29T10:00:00Z', '2026-10-29T10:05:00Z']);
  assert.deepEqual(g.instances, ['a', 'b']);
  assert.deepEqual(g.cells, [[0, 0, 3], [0, 1, 1.23], [1, 0, 4]]);
  assert.deepEqual(g.lastSeen, ['2026-10-29T10:05:20Z', '2026-10-29T10:00:50Z']);
});

test('out-of-order rows are put in time order', () => {
  const g = shapeSeries('x', 'rg', [
    { timestamp: '2026-10-29T10:05:00Z', cloud_RoleInstance: 'a', v: 4 },
    { timestamp: '2026-10-29T10:00:00Z', cloud_RoleInstance: 'a', v: 3 },
  ]);
  assert.deepEqual(g.times, ['2026-10-29T10:00:00Z', '2026-10-29T10:05:00Z']);
  assert.deepEqual([...g.cells].sort((x, y) => x[0] - y[0]), [[0, 0, 3], [1, 0, 4]]);
});

test('the newest, still-filling time slot is dropped so the chart does not show a false drop', () => {
  const now = Date.parse('2026-10-29T10:58:30Z');
  const pts = [{ t: '2026-10-29T10:54:00Z', v: 90 }, { t: '2026-10-29T10:56:00Z', v: 92 }, { t: '2026-10-29T10:58:00Z', v: 3 }];
  assert.deepEqual(dropIncompleteSlot(pts, 2 * 60_000, now).map((p) => p.v), [90, 92]);
  assert.equal(dropIncompleteSlot(pts, 2 * 60_000, Date.parse('2026-10-29T11:00:10Z')).length, 3, 'a finished slot stays');
  assert.equal(dropIncompleteSlot([pts[2]!], 2 * 60_000, now).length, 1, 'never empties a series');
  const g = shapeSeries('x', 'rg', [
    { timestamp: '2026-10-29T10:56:00Z', cloud_RoleInstance: 'a', v: 4 },
    { timestamp: '2026-10-29T10:58:00Z', cloud_RoleInstance: 'a', v: 1 },
  ]);
  const t = trimNewestSlot(g, 2 * 60_000, now);
  assert.deepEqual(t.times, ['2026-10-29T10:56:00Z']);
  assert.deepEqual(t.cells, [[0, 0, 4]]);
});

import { mgmtCredential } from './azure.js';

test('one shared Azure credential: its token cache saves a ~4 s sign-in on every request', () => {
  assert.equal(mgmtCredential(), mgmtCredential());
});
