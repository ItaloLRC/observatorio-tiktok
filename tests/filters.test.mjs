import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMinimumViews, selectRecords } from '../web/filters.js';

const records = [
  { id: 'below', views: 99, date: '2026-11-01', series: 'A', channel_id: 'one' },
  { id: 'boundary', views: 100, date: '2026-11-01', series: 'A', channel_id: 'one' },
  { id: 'above', views: 101, date: '2026-11-02', series: 'B', channel_id: 'two' },
  { id: 'zero', views: 0, date: '2026-11-02', series: 'A', channel_id: 'two' },
  { id: 'missing', views: null, date: '2026-11-02', series: 'A', channel_id: 'two' },
  { id: 'old', views: 900, date: '2026-10-31', series: 'A', channel_id: 'one' },
];
const period = { from: '2026-11-01', to: '2026-11-02' };

test('threshold é inclusivo e a mesma seleção fornece totais, médias e canais', () => {
  const selected = selectRecords(records, { ...period, minimumViews: 100 });
  assert.deepEqual(selected.map(r => r.id), ['boundary', 'above']);
  assert.equal(selected.reduce((sum, r) => sum + r.views, 0), 201);
  assert.equal(selected.reduce((sum, r) => sum + r.views, 0) / selected.length, 100.5);
  assert.deepEqual([...new Set(selected.map(r => r.channel_id))], ['one', 'two']);
});

test('combina threshold, série, datas inclusivas e escopo do canal', () => {
  assert.deepEqual(selectRecords(records, { ...period, series: 'A', minimumViews: 100 }).map(r => r.id), ['boundary']);
  assert.deepEqual(selectRecords(records.filter(r => r.channel_id === 'two'), {
    from: '2026-11-02', to: '2026-11-02', minimumViews: 100,
  }).map(r => r.id), ['above']);
});

test('zero desativa o corte sem converter views ausentes em zero; cortes positivos excluem ausentes', () => {
  assert.equal(selectRecords(records, period).length, 5);
  assert.equal(selectRecords(records, { ...period, minimumViews: 1 }).length, 3);
  assert.equal(records[4].views, null);
  assert.deepEqual(selectRecords(records, { ...period, minimumViews: 1000 }), []);
  assert.deepEqual(selectRecords([], { ...period, minimumViews: 100 }), []);
  const unknown = [null, undefined, NaN, Infinity, '100'].map(views => ({ views, date: period.from }));
  assert.deepEqual(selectRecords(unknown, { ...period, minimumViews: 100 }), []);
});

test('aceita apenas inteiros não negativos seguros e vazio como sem corte', () => {
  for (const value of ['', ' ', null, undefined, '0', '000']) assert.equal(parseMinimumViews(value), 0);
  assert.equal(parseMinimumViews('100'), 100);
  assert.equal(parseMinimumViews(' 100 '), 100);
  assert.equal(parseMinimumViews(String(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
  for (const value of ['-1', '1.5', '1e3', 'Infinity', 'NaN', '1.000', '1,000', 'abc', '9007199254740992']) {
    assert.equal(parseMinimumViews(value), null, String(value));
  }
  assert.throws(() => selectRecords(records, { ...period, minimumViews: -1 }), RangeError);
});
