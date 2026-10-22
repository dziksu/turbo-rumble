import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as T from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Race, initPhysics } from '../shared/simulation.ts';
import { createNitroExhaust } from '../client/nitro-exhaust.ts';
import { disposeResources } from '../client/resources.ts';
import { NITRO_EXHAUST } from '../shared/rules.ts';
before(initPhysics);
function setup(forward = -3.6, side = 0, height = 0, yawOffset = 0) {
  const race = new Race(83);
  for (let slot = 0; slot < 3; slot++)
    race.addDriver({
      id: `p${slot}`,
      name: `P${slot}`,
      slot,
      bot: false,
      connected: true,
      ready: true,
      wins: 0,
    });
  race.start();
  race.phase = 'racing';
  race.cameraProgress = 80;
  race.pickupUntil.fill(Infinity);
  const at = race.track.trackAt(80),
    yaw = at.yaw + yawOffset,
    direction = new T.Vector3(Math.sin(yaw), 0, Math.cos(yaw)),
    normal = new T.Vector3(direction.z, 0, -direction.x);
  for (const [i, car] of [...race.cars.values()].entries()) {
    const position = at.p
      .clone()
      .addScaledVector(direction, i === 1 ? forward : i === 2 ? 16 : 0)
      .addScaledVector(normal, i === 1 ? side : i === 2 ? 3 : 0);
    position.y = 0.6 + (i === 1 ? height : 0);
    car.body.setTranslation(position, true);
    car.body.setRotation(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), yaw), true);
    car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    car.progress = 80 + (i === 1 ? forward : i === 2 ? 16 : 0);
    car.invulnerableUntil = 0;
  }
  return { race, source: race.cars.get('p0')!, target: race.cars.get('p1')! };
}
function step(race: Race, count = 1) {
  for (let i = 0; i < count; i++) {
    for (const car of race.cars.values())
      race.input(car.id, { seq: car.input.seq + 1, actionSeq: 0, left: true, right: true });
    race.step();
  }
}
for (const yaw of [0, 1.2, Math.PI])
  test(`nitro flame burns a close follower using the actual heading (${yaw})`, () => {
    const { race, source, target } = setup(-3.6, 0, 0, yaw);
    try {
      source.weapon = 'boost';
      race.useWeapon(source);
      step(race);
      assert.equal(source.weapon, null);
      assert.equal(source.alive, true);
      const victim = race.snapshot('HOT').cars.find((car) => car.id === target.id)!;
      assert.equal(victim.alive, false);
      assert.equal(victim.wrecked, true);
      const until = target.wreckUntil;
      assert.ok(until > race.tick);
      assert.equal(
        race.events.filter((event) => event.type === 'explosion' && event.weapon === 'boost')
          .length,
        1,
      );
      step(race, 4);
      assert.equal(target.wreckUntil, until, 'burning the same wreck must not extend its life');
      assert.equal(race.events.filter((event) => event.type === 'elimination').length, 1);
    } finally {
      race.dispose();
    }
  });
for (const [name, forward, side, height] of [
  ['ahead', 3.6, 0, 0],
  ['beside', -3.6, 1.8, 0],
  ['too far behind', -5.3, 0, 0],
  ['above', -3.6, 0, 2.5],
] as const)
  test(`nitro does not burn a car ${name}`, () => {
    const { race, source, target } = setup(forward, side, height);
    try {
      source.weapon = 'boost';
      race.useWeapon(source);
      step(race);
      assert.equal(target.alive, true);
      assert.equal(target.wreckUntil, 0);
    } finally {
      race.dispose();
    }
  });
test('an unused nitro item, expired nitro and catch-up assistance never emit harmful heat', () => {
  for (const mode of ['held', 'expired', 'catch-up'] as const) {
    const { race, source, target } = setup();
    try {
      if (mode === 'held') source.weapon = 'boost';
      if (mode === 'expired') source.boostUntil = race.tick + 1;
      if (mode === 'catch-up') source.catchUp = 1;
      step(race);
      assert.equal(target.alive, true, mode);
    } finally {
      race.dispose();
    }
  }
});
test('spawn protection and a wall shield followers from nitro flames', () => {
  for (const mode of ['protected', 'wall'] as const) {
    const { race, source, target } = setup(-4);
    try {
      if (mode === 'protected') target.invulnerableUntil = 1000;
      else {
        const rotation = source.body.rotation(),
          offset = new T.Vector3(0, 0, -2.3).applyQuaternion(rotation),
          position = new T.Vector3().copy(source.body.translation()).add(offset);
        race.world.createCollider(
          RAPIER.ColliderDesc.cuboid(1.8, 1.5, 0.12)
            .setTranslation(position.x, position.y, position.z)
            .setRotation(rotation),
        );
      }
      source.weapon = 'boost';
      race.useWeapon(source);
      step(race);
      assert.equal(target.alive, true, mode);
    } finally {
      race.dispose();
    }
  }
});

test('opposing active exhausts resolve simultaneous burns without slot-order advantage', () => {
  const { race, source, target } = setup();
  try {
    const at = race.track.trackAt(80);
    target.body.setRotation(
      new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), at.yaw + Math.PI),
      true,
    );
    for (const car of [source, target]) {
      car.weapon = 'boost';
      race.useWeapon(car);
    }
    step(race);
    assert.equal(source.alive, false);
    assert.equal(target.alive, false);
  } finally {
    race.dispose();
  }
});
test('pause freezes the active exhaust and the flame geometry matches its short server range', () => {
  const { race, source, target } = setup(),
    visual = createNitroExhaust();
  try {
    const bounds = new T.Box3().setFromObject(visual);
    assert.ok(Math.abs(bounds.max.z + NITRO_EXHAUST.rearOffset) < 0.00001);
    assert.ok(Math.abs(bounds.min.z + NITRO_EXHAUST.rearOffset + NITRO_EXHAUST.length) < 0.00001);
    assert.ok(bounds.max.x <= NITRO_EXHAUST.radius + 0.00001);
    source.weapon = 'boost';
    race.useWeapon(source);
    race.pause();
    step(race, 10);
    assert.equal(target.alive, true);
    race.resume();
    step(race);
    assert.equal(target.alive, false);
  } finally {
    race.dispose();
    disposeResources([visual]);
  }
});
