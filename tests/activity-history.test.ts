import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { ActivityStore } from '../server/activity-store.ts';
import { isActivityHistory, isActivityRange } from '../shared/activity.ts';

const minute = 60_000,
  hour = 60 * minute;
const idle = { players: 0, playingPlayers: 0, activeRooms: 0 };

test('aggregate history preserves short peaks, first peak times, gaps and hourly maxima', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const store = new ActivityStore(db);
    const start = Date.UTC(2026, 9, 22, 12);
    store.record(idle, start);
    store.record({ players: 4, playingPlayers: 2, activeRooms: 1 }, start + 120);
    store.record({ players: 2, playingPlayers: 2, activeRooms: 2 }, start + 240);
    store.record({ players: 4, playingPlayers: 4, activeRooms: 1 }, start + 360);
    store.record(idle, start + minute);
    store.record({ players: 2, playingPlayers: 1, activeRooms: 1 }, start + 3 * minute);
    const data = store.history('24h', idle, start + 4 * minute);
    assert.ok(isActivityHistory(data));
    assert.deepEqual(data.peak, { players: 4, at: start + 120 });
    assert.deepEqual(data.points, [
      { at: start, players: 4, playingPlayers: 4, activeRooms: 2, peakAt: start + 120 },
      { at: start + minute, ...idle, peakAt: start + minute },
      {
        at: start + 3 * minute,
        players: 2,
        playingPlayers: 1,
        activeRooms: 1,
        peakAt: start + 3 * minute,
      },
    ]);
    assert.equal(data.startedAt, start);
    const hourly = store.history('7d', idle, start + 4 * minute);
    assert.equal(hourly.bucketMs, hour);
    assert.deepEqual(hourly.points, [data.points[0]]);
    // A fresh collector (as after process restart) keeps historical data and its record.
    const reopened = new ActivityStore(db);
    reopened.record(idle, start + hour);
    assert.deepEqual(reopened.history('30d', idle, start + hour).peak, data.peak);
    assert.equal(reopened.history('30d', idle, start + hour).startedAt, start);
    const tables = db.prepare('SELECT name FROM sqlite_master WHERE type = ?').all('table');
    assert.deepEqual(tables.map((row) => row.name).sort(), [
      'activity_minutes',
      'activity_summary',
    ]);
  } finally {
    db.close();
  }
});

test('retention removes old minute counts, keeps all-time record and bounds every response', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const store = new ActivityStore(db);
    const start = Date.UTC(2026, 0, 1);
    store.record({ players: 80, playingPlayers: 64, activeRooms: 10 }, start);
    const now = start + 91 * 24 * hour;
    store.record({ players: 1, playingPlayers: 0, activeRooms: 1 }, now);
    const data = store.history('30d', idle, now);
    assert.deepEqual(data.peak, { players: 80, at: start });
    assert.equal(data.points.length, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM activity_minutes').get()?.count, 1);
    assert.ok(isActivityHistory(data));
    for (let i = 1; i <= 24 * 60; i++) store.record(idle, now + i * minute);
    assert.equal(store.history('24h', idle, now + 24 * hour).points.length, 1441);
    assert.ok(isActivityHistory(store.history('24h', idle, now + 24 * hour)));
  } finally {
    db.close();
  }
});

test('history rejects arbitrary ranges and malformed count/time payloads', () => {
  for (const value of [undefined, null, [], {}, '365d', 'toString', '__proto__'])
    assert.equal(isActivityRange(value), false);
  const db = new DatabaseSync(':memory:');
  try {
    const store = new ActivityStore(db);
    store.record(idle, 1000);
    const valid = store.history('24h', idle, 1000);
    assert.ok(isActivityHistory(valid));
    for (const invalid of [
      null,
      {},
      { ...valid, range: '365d' },
      { ...valid, generatedAt: NaN },
      { ...valid, startedAt: 2000 },
      { ...valid, current: { ...idle, playingPlayers: 1 } },
      { ...valid, points: [{ ...valid.points[0], players: -1 }] },
    ])
      assert.equal(isActivityHistory(invalid), false);
  } finally {
    db.close();
  }
});
