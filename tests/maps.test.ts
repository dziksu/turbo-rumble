import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import { Race, initPhysics } from '../shared/simulation.ts';
import { DRIVING } from '../shared/driving.ts';
import { DEFAULT_SETTINGS, type MapId } from '../shared/maps.ts';
before(initPhysics);

function raceOn(mapId: MapId, lapLimit = 3, winningScore = 10) {
  const race = new Race(95, { mapId, lapLimit, winningScore });
  for (let i = 0; i < 3; i++)
    race.addDriver({
      id: `p${i}`,
      name: `P${i}`,
      slot: i,
      bot: false,
      connected: true,
      ready: true,
      wins: 0,
    });
  race.start();
  race.phase = 'racing';
  race.roundStart = race.tick;
  for (const car of race.cars.values()) {
    car.invulnerableUntil = 100000;
    car.weapon = null;
  }
  return race;
}
for (const mapId of ['forest', 'volcano'] as const) {
  test(`${mapId}: gaps have no road collider while both riverbanks support cars`, () => {
    const race = raceOn(mapId),
      track = race.track;
    try {
      race.world.step();
      for (const gap of track.GAPS) {
        const p = track.trackAt(gap.s).p;
        assert.equal(
          race.world.castRay(new RAPIER.Ray({ ...p, y: 0.5 }, { x: 0, y: -1, z: 0 }), 2.5, true),
          null,
        );
        for (const offset of [-gap.length / 2 - 20, gap.length / 2 + 5]) {
          const bank = track.trackAt(gap.s + offset).p;
          assert.ok(
            race.world.castRay(new RAPIER.Ray({ ...bank, y: 1 }, { x: 0, y: -1, z: 0 }), 2, true),
          );
        }
      }
      assert.ok(track.ROAD_WIDTH >= 8.5);
    } finally {
      race.dispose();
    }
  });
  for (const index of [0, 1])
    for (const lane of [-4, 0, 4])
      test(`${mapId}: a car jumps gap ${index + 1} in lane ${lane} at normal racing speed`, () => {
        const race = raceOn(mapId),
          track = race.track,
          ramp = track.RAMPS[index],
          gap = track.GAPS[index],
          car = race.cars.get('p0')!;
        try {
          const start = track.trackAt(ramp.s - ramp.length / 2 - 4);
          car.body.setTranslation(
            { ...start.p.clone().addScaledVector(start.n, lane), y: 0.56 },
            true,
          );
          car.body.setRotation(
            new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), start.yaw),
            true,
          );
          car.body.setLinvel(start.t.clone().multiplyScalar(DRIVING.speed), true);
          car.progress = ramp.s - ramp.length / 2 - 4;
          race.cameraProgress = car.progress;
          let highest = 0,
            crossed = false,
            landed = false;
          for (let tick = 0; tick < 160; tick++) {
            race.cameraProgress = car.progress - 4;
            race.input(car.id, { seq: tick + 1, left: false, right: false, actionSeq: 0 });
            race.step();
            const p = car.body.translation(),
              pr = track.projectOnTrack(p);
            highest = Math.max(highest, p.y);
            if (pr.s > gap.s + gap.length / 2 && p.y > 0.5) crossed = true;
            if (crossed && p.y < 0.9 && p.y > 0.35) {
              landed = true;
              break;
            }
            if (p.y < -1) break;
          }
          assert.ok(highest > ramp.height + 0.3, `peak ${highest}`);
          assert.ok(crossed, 'car clears the far bank');
          assert.ok(landed, 'car returns to the road instead of water/lava');
        } finally {
          race.dispose();
        }
      });
  test(`${mapId}: falling into the crossing eliminates; only lava leaves a burnt wreck`, () => {
    const race = raceOn(mapId),
      car = race.cars.get('p0')!,
      gap = race.track.GAPS[0],
      at = race.track.trackAt(gap.s);
    try {
      car.progress = gap.s;
      race.cameraProgress = gap.s;
      car.body.setTranslation({ ...at.p, y: -1.1 }, true);
      race.step();
      assert.equal(car.alive, false);
      assert.equal(race.snapshot('MAP').cars[0].wrecked, mapId === 'volcano');
      assert.ok(
        race.events.some(
          (event) =>
            event.type === 'elimination' &&
            event.text?.includes(mapId === 'volcano' ? 'lawa' : 'rzeka'),
        ),
      );
    } finally {
      race.dispose();
    }
  });
}
test('forest logs are real movable obstacles and independent map instances keep their own geometry', () => {
  const forest = raceOn('forest'),
    desert = raceOn('desert');
  try {
    const log = forest.track.OBSTACLES.find((o) => o.kind === 'log')!;
    const body = forest.obstacleBodies.get(log.id)!;
    assert.ok(body.isDynamic());
    forest.blast(log.position.clone().add(new Vector3(2, 0, 0)), 'rocket');
    assert.ok(Math.hypot(body.linvel().x, body.linvel().z) > 1);
    assert.equal(desert.track.id, 'desert');
    assert.notEqual(forest.track.TRACK_LENGTH, desert.track.TRACK_LENGTH);
  } finally {
    forest.dispose();
    desert.dispose();
  }
});
test('configured lap and score limits decide the winner and are included in snapshots', () => {
  const race = raceOn('forest', 2, 7);
  try {
    assert.equal(race.snapshot('RULES').lapLimit, 2);
    assert.deepEqual(race.snapshot('RULES').settings, {
      mapId: 'forest',
      lapLimit: 2,
      winningScore: 7,
    });
    race.cars.get('p0')!.score = 6;
    race.eliminate('p1', 'test');
    race.eliminate('p2', 'test');
    race.step();
    assert.equal(race.phase, 'finished');
    assert.equal(race.cars.get('p0')!.score, 7);
  } finally {
    race.dispose();
  }
  const laps = raceOn('volcano', 2, 20);
  try {
    const car = laps.cars.get('p0')!,
      at = laps.track.trackAt(0.1);
    car.progress = laps.track.TRACK_LENGTH * 2 + 0.1;
    car.body.setTranslation({ ...at.p, y: 0.6 }, true);
    laps.step();
    assert.equal(laps.phase, 'finished');
    assert.equal(laps.snapshot('RULES').lap, 2);
  } finally {
    laps.dispose();
  }
  assert.deepEqual(DEFAULT_SETTINGS, { mapId: 'desert', lapLimit: 3, winningScore: 10 });
});

test('longer lap settings extend the safety timeout instead of ending a nine-lap race at three minutes', () => {
  const race = raceOn('forest', 9, 50);
  try {
    assert.ok(race.maximumRaceTicks > 27000);
    race.tick = race.raceStart + 9001;
    race.roundStart = race.tick;
    for (const car of race.cars.values()) car.invulnerableUntil = race.tick + 100;
    race.step();
    assert.equal(race.phase, 'racing');
  } finally {
    race.dispose();
  }
});
