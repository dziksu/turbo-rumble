import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { Quaternion, Vector3 } from 'three';
import { Race, initPhysics } from '../shared/simulation.ts';
import type { MapId } from '../shared/maps.ts';
before(initPhysics);

function setup(n = 2, mapId: MapId = 'desert', laps = 3) {
  const race = new Race(95, { mapId, lapLimit: laps, winningScore: 20 });
  for (let i = 0; i < n; i++)
    race.addDriver({
      id: `p${i}`,
      name: `Racer ${i}`,
      slot: i,
      bot: false,
      connected: true,
      ready: true,
      wins: 0,
    });
  race.start();
  race.phase = 'racing';
  race.roundStart = race.tick;
  for (const car of race.cars.values()) car.invulnerableUntil = Infinity;
  return race;
}
function move(race: Race, id: string, progress: number, side = 0, speed = 0) {
  const car = race.cars.get(id)!;
  const at = race.track.trackAt(progress);
  car.progress = progress;
  car.body.setTranslation({ ...at.p.clone().addScaledVector(at.n, side), y: 0.6 }, true);
  car.body.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), at.yaw), true);
  car.body.setLinvel(at.t.clone().multiplyScalar(speed), true);
  return car;
}
function scores(race: Race) {
  return [...race.cars.values()].map((car) => car.score);
}

for (const n of [2, 8])
  test(`${n} entrants: last two keep racing past both time limits`, () => {
    const race = setup(n);
    try {
      for (let i = 2; i < n; i++) race.eliminate(`p${i}`, 'test');
      race.step();
      for (const tick of [1000, race.raceStart + race.maximumRaceTicks + 100]) {
        race.tick = tick;
        race.step();
        assert.equal(race.phase, 'racing');
        assert.equal(race.cars.get('p0')!.alive, true);
        assert.equal(race.cars.get('p1')!.alive, true);
        assert.ok(scores(race).every((score) => score === 5));
      }
    } finally {
      race.dispose();
    }
  });

test('three survivors retain the normal timed round', () => {
  const race = setup(3);
  try {
    race.tick = 1000;
    race.step();
    assert.equal(race.phase, 'segment');
  } finally {
    race.dispose();
  }
});

for (const mapId of ['desert', 'forest', 'volcano'] as const)
  test(`${mapId}: both racers must finish every lap, in crossing order, for +2/+1`, () => {
    const race = setup(2, mapId, 2);
    try {
      const line = race.track.TRACK_LENGTH * 2;
      const first = move(race, 'p1', line - 0.08, 2, 20);
      const second = move(race, 'p0', line - 7, -2, 20);
      race.cameraProgress = line - 6;
      race.step();
      assert.equal(race.phase, 'racing', 'first crossing does not end the race');
      assert.equal(race.snapshot('QA').cars.find((car) => car.id === first.id)!.finishPlace, 1);
      assert.equal(first.body.isEnabled(), false);
      assert.deepEqual(scores(race), [5, 5], 'no partial or repeated scoring');
      const finishedPosition = { ...first.body.translation() };
      race.eliminate(first.id, 'cannot hit a finisher');
      race.blast(first.body.translation(), 'rocket');
      assert.equal(race.pendingDeaths.has(first.id), false);
      first.weapon = 'rocket';
      race.useWeapon(first);
      assert.equal(race.shots.length, 0, 'finishers cannot fire');
      const previousPosition = new Vector3().copy(second.body.translation());
      race.tick += race.maximumRaceTicks;
      race.step();
      assert.equal(race.phase, 'racing', 'no timeout while the second racer is still driving');
      assert.ok(
        previousPosition.distanceTo(second.body.translation()) > 0.1,
        'the remaining car keeps moving physically',
      );
      assert.deepEqual({ ...first.body.translation() }, finishedPosition);
      move(race, second.id, line - 0.08, -2, 20);
      race.step();
      assert.equal(race.phase, 'finished');
      assert.deepEqual(scores(race), [6, 7]);
      assert.deepEqual(
        race.results.map((result) => result.id),
        ['p1', 'p0'],
      );
      assert.equal(race.snapshot('QA').cars[0].finishPlace, 2);
      race.step();
      assert.deepEqual(scores(race), [6, 7]);
      race.lobby();
      assert.ok(race.snapshot('QA').cars.every((car) => !car.finishPlace && car.alive));
      assert.ok([...race.cars.values()].every((car) => car.body.isEnabled()));
      race.start();
      assert.deepEqual(scores(race), [5, 5]);
    } finally {
      race.dispose();
    }
  });

test('same-tick finish order uses crossing time rather than insertion order', () => {
  const race = setup();
  try {
    const line = race.track.TRACK_LENGTH * 3;
    move(race, 'p0', line - 0.25, -2, 20);
    move(race, 'p1', line - 0.04, 2, 20);
    race.cameraProgress = line - 5;
    race.step();
    assert.equal(race.phase, 'finished');
    assert.deepEqual(scores(race), [6, 7]);
  } finally {
    race.dispose();
  }
});

test('a crossing on an earlier lap does not finish the duel', () => {
  const race = setup();
  try {
    move(race, 'p0', race.track.TRACK_LENGTH - 0.08, -2, 20);
    move(race, 'p1', race.track.TRACK_LENGTH - 4, 2, 20);
    race.cameraProgress = race.track.TRACK_LENGTH - 5;
    race.step();
    assert.equal(race.phase, 'racing');
    assert.ok(race.snapshot('QA').cars.every((car) => !car.finishPlace));
  } finally {
    race.dispose();
  }
});

for (const simultaneous of [false, true])
  test(`duel elimination keeps existing scoring (wipe=${simultaneous})`, () => {
    const race = setup();
    try {
      race.tick = 1000;
      race.eliminate('p1', 'rocket');
      if (simultaneous) race.eliminate('p0', 'rocket');
      race.step();
      assert.equal(race.phase, 'segment');
      assert.deepEqual(scores(race), simultaneous ? [5, 5] : [6, 4]);
    } finally {
      race.dispose();
    }
  });

test('elimination on the finish tick takes precedence over crossing', () => {
  const race = setup();
  try {
    const line = race.track.TRACK_LENGTH * 3;
    move(race, 'p0', line - 0.08, -2, 20);
    move(race, 'p1', line - 4, 2, 20);
    race.cameraProgress = line - 5;
    race.eliminate('p0', 'rocket');
    race.step();
    assert.equal(race.phase, 'segment');
    assert.deepEqual(scores(race), [4, 6]);
    assert.ok(race.snapshot('QA').cars.every((car) => !car.finishPlace));
  } finally {
    race.dispose();
  }
});

test('a finished racer is removed cleanly if its session expires', () => {
  const race = setup();
  try {
    const line = race.track.TRACK_LENGTH * 3;
    move(race, 'p0', line - 0.08, -2, 20);
    move(race, 'p1', line - 4, 2, 20);
    race.cameraProgress = line - 5;
    race.step();
    race.removeDriver('p0');
    race.step();
    assert.equal(race.phase, 'segment');
    assert.equal(race.snapshot('QA').cars[0].finishPlace, 0);
  } finally {
    race.dispose();
  }
});

test('last two finish bonuses also apply to a larger starting grid', () => {
  const race = setup(8);
  try {
    for (let i = 7; i >= 2; i--) {
      race.eliminate(`p${i}`, 'rocket');
      race.step();
    }
    const line = race.track.TRACK_LENGTH * 3;
    move(race, 'p0', line - 0.04, -2, 20);
    move(race, 'p1', line - 0.25, 2, 20);
    race.cameraProgress = line - 5;
    race.step();
    assert.equal(race.phase, 'finished');
    assert.deepEqual(scores(race), [7, 6, 5, 5, 5, 5, 4, 3]);
  } finally {
    race.dispose();
  }
});

test('destroying the remaining car ends immediately after the first finisher', () => {
  const race = setup();
  try {
    const line = race.track.TRACK_LENGTH * 3;
    move(race, 'p0', line - 0.04, -2, 20);
    move(race, 'p1', line - 5, 2, 20);
    race.cameraProgress = line - 5;
    race.step();
    race.eliminate('p1', 'rocket');
    race.step();
    assert.equal(race.phase, 'finished');
    assert.deepEqual(scores(race), [7, 4]);
    assert.equal(race.snapshot('QA').cars[1].finishPlace, 0, 'DNF receives no finish bonus');
  } finally {
    race.dispose();
  }
});
