import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rankStandings } from '../client/standings.ts';

test('eight tied players keep their scoreboard order while overtaking and respawning', () => {
  const cars = Array.from({ length: 8 }, (_, slot) => ({
    id: `driver-${slot}`,
    slot,
    score: 5,
    progress: 0,
    alive: true,
  }));
  const expected = cars.map((car) => car.id);
  for (let snapshot = 0; snapshot < 100; snapshot++) {
    for (const car of cars) {
      car.progress = Math.sin(snapshot + car.slot) * 500;
      car.alive = (snapshot + car.slot) % 9 !== 0;
    }
    const packet = snapshot % 2 ? [...cars].reverse() : [...cars];
    assert.deepEqual(
      rankStandings(packet).map((car) => car.id),
      expected,
    );
    assert.deepEqual(
      packet.map((car) => car.slot),
      snapshot % 2 ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7],
    );
  }
});

test('awarded points reorder the scoreboard, with a fixed order inside each tied group', () => {
  const cars = [
    { slot: 7, score: 4 },
    { slot: 2, score: 7 },
    { slot: 1, score: 7 },
    { slot: 0, score: 5 },
  ];
  assert.deepEqual(
    rankStandings(cars).map((car) => car.slot),
    [1, 2, 0, 7],
  );
  cars[0].score = 8;
  assert.deepEqual(
    rankStandings(cars).map((car) => car.slot),
    [7, 1, 2, 0],
  );
});
