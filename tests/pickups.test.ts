import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { Quaternion, Vector3 } from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Race, initPhysics } from '../shared/simulation.ts';
import { PICKUP_RADIUS, PICKUP_RESPAWN_TICKS, COUNTDOWN_TICKS } from '../shared/rules.ts';
import type { MapId } from '../shared/maps.ts';
import type { Car } from '../shared/entities.ts';
before(initPhysics);
function room(mapId: MapId = 'desert', count = 2) {
  const race = new Race(83, { mapId, lapLimit: 3, winningScore: 10 });
  for (let slot = 0; slot < count; slot++)
    race.addDriver({
      id: `p${slot}`,
      name: `P${slot}`,
      slot,
      bot: false,
      ready: true,
      connected: true,
      wins: 0,
    });
  return race;
}
function step(race: Race, ticks = 1) {
  for (let tick = 0; tick < ticks; tick++) {
    for (const car of race.cars.values())
      race.input(car.id, { seq: car.input.seq + 1, actionSeq: 0, left: true, right: true });
    race.step();
  }
}
function move(race: Race, car: Car, s: number, side = 0) {
  const at = race.track.trackAt(s),
    p = at.p.clone().addScaledVector(at.n, side);
  car.progress = s;
  car.body.setTranslation({ x: p.x, y: 0.7, z: p.z }, true);
  car.body.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), at.yaw), true);
  car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
}
for (const map of ['desert', 'forest', 'volcano'] as const) {
  test(`${map}: lobby, countdown, first movement, respawn and rematch all start without items`, () => {
    const race = room(map, 8);
    try {
      const empty = () =>
        assert.ok(race.snapshot('EMPTY').cars.every((car) => car.weapon === null));
      empty();
      race.start();
      empty();
      for (let i = 0; i < COUNTDOWN_TICKS; i++) {
        race.step();
        empty();
      }
      assert.equal(race.phase, 'racing');
      step(race, 12);
      empty();
      for (const car of race.cars.values()) car.weapon = 'rocket';
      race.endSegment();
      assert.equal(race.phase, 'segment');
      while (race.phase === 'segment') step(race);
      empty();
      for (const car of race.cars.values()) car.weapon = 'mine';
      race.finish();
      race.start();
      empty();
      race.lobby();
      empty();
    } finally {
      race.dispose();
    }
  });
  test(`${map}: waiting beyond item cooldown never grants a weapon without a pickup`, () => {
    const race = room(map);
    try {
      race.start();
      race.phase = 'racing';
      step(race, PICKUP_RESPAWN_TICKS + 60);
      assert.ok(race.snapshot('IDLE').cars.every((car) => car.weapon === null));
      assert.equal(race.events.filter((event) => event.type === 'pickup').length, 0);
    } finally {
      race.dispose();
    }
  });
  test(`${map}: driving beside crystals does not collect them; physical contact consumes exactly one`, () => {
    const race = room(map);
    try {
      race.start();
      race.phase = 'racing';
      const pickup = race.track.PICKUP_SPAWNS.find((p) => p.id % 3 === 1)!,
        s = race.track.projectOnTrack(pickup.position).s,
        car = race.cars.get('p0')!;
      move(race, race.cars.get('p1')!, s + 16, -3);
      race.cameraProgress = s;
      // The old 2.2 m attraction radius collected either neighboring crystal from here.
      move(race, car, s, 1.85);
      step(race);
      assert.equal(car.weapon, null);
      assert.ok(race.snapshot('NEAR').pickups.every((p) => p.active));
      move(race, car, s);
      step(race);
      assert.ok(car.weapon);
      const collected = race.snapshot('HIT').pickups.filter((p) => !p.active);
      assert.deepEqual(
        collected.map((p) => p.id),
        [pickup.id],
      );
      assert.equal(race.pickupUntil[pickup.id], race.tick + PICKUP_RESPAWN_TICKS);
      const event = race.events.filter((e) => e.type === 'pickup').at(-1)!;
      assert.deepEqual(event.position, { ...pickup.position });
      assert.equal(event.weapon, car.weapon);
      const held = car.weapon;
      step(race);
      assert.equal(car.weapon, held);
      race.useWeapon(car);
      assert.equal(car.weapon, null);
      move(race, car, s);
      step(race);
      assert.equal(car.weapon, null, 'inactive crystal grants nothing');
    } finally {
      race.dispose();
    }
  });
}
test('front bumper contact collects a crystal even before the car centre reaches it', () => {
  const race = room();
  try {
    race.start();
    race.phase = 'racing';
    const pickup = race.track.PICKUP_SPAWNS.find((p) => p.id % 3 === 1)!,
      s = race.track.projectOnTrack(pickup.position).s;
    race.cameraProgress = s;
    move(race, race.cars.get('p1')!, s + 16, -3);
    const car = race.cars.get('p0')!;
    move(race, car, s - 2.1);
    step(race);
    assert.ok(car.weapon, 'pickup must follow body contact, not an arbitrary centre distance');
    assert.equal(race.snapshot('BUMPER').pickups.find((p) => p.id === pickup.id)!.active, false);
  } finally {
    race.dispose();
  }
});
test('new round grid does not spawn cars in collectible hitboxes', () => {
  const race = room('forest', 8);
  try {
    race.start();
    const pickup = race.track.PICKUP_SPAWNS.find((p) => p.id % 3 === 1)!,
      origin = race.track.projectOnTrack(pickup.position).s + 5;
    const s = race.gridProgress(origin),
      shape = new RAPIER.Ball(PICKUP_RADIUS);
    assert.ok(s > origin, 'grid must move off the collectible row');
    for (const car of race.cars.values()) {
      race.place(car, s);
      for (const p of race.track.PICKUP_SPAWNS)
        assert.equal(
          car.body
            .collider(0)
            .shape.intersectsShape(car.body.translation(), car.body.rotation(), shape, p.position, {
              x: 0,
              y: 0,
              z: 0,
              w: 1,
            }),
          false,
        );
      assert.equal(car.weapon, null);
    }
  } finally {
    race.dispose();
  }
});
