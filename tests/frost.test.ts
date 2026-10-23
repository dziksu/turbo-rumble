import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { Quaternion, Vector3 } from 'three';
import { Race, initPhysics } from '../shared/simulation.ts';
import { applyFrost } from '../shared/frost.ts';
import { DRIVING, drivingControl } from '../shared/driving.ts';
import {
  FROST_DURATION_TICKS,
  PHYSICS_STEP_SECONDS as DT,
  VEHICLE_RIDE_HEIGHT,
} from '../shared/rules.ts';
import { bodyYaw } from '../shared/physics-utils.ts';
import type { MapId } from '../shared/maps.ts';

before(initPhysics);
function fixture(mapId: MapId = 'desert', bot = false) {
  const race = new Race(173, { mapId, lapLimit: 9, winningScore: 50 });
  // Pick a long straight on the actual map, with no gap/ramp or static obstacle nearby.
  let progress = 20;
  for (let s = 20; s < race.track.TRACK_LENGTH - 60; s += 5) {
    const a = race.track.trackAt(s),
      b = race.track.trackAt(s + 45);
    if (a.t.dot(b.t) > 0.999 && !race.track.isGap(s) && !race.track.isGap(s + 45)) {
      progress = s;
      break;
    }
  }
  for (let i = 0; i < 2; i++)
    race.addDriver({
      id: 'p' + i,
      name: 'Frost ' + i,
      slot: i,
      bot,
      ready: true,
      connected: true,
      wins: 0,
    });
  race.start();
  race.phase = 'racing';
  race.roundStart = race.tick;
  race.cameraProgress = progress;
  race.pickupUntil.fill(Infinity);
  const at = race.track.trackAt(progress);
  for (const car of race.cars.values()) {
    const p = at.p.clone().addScaledVector(at.n, car.slot ? 5 : -3);
    car.progress = progress;
    car.weapon = null;
    car.invulnerableUntil = 0;
    car.body.setTranslation(
      { x: p.x, y: race.track.surfaceHeight(p) + VEHICLE_RIDE_HEIGHT, z: p.z },
      true,
    );
    car.body.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), at.yaw), true);
    car.body.setLinvel(at.t.clone().multiplyScalar(20), true);
  }
  race.world.step();
  return race;
}
function step(race: Race, left = false, right = false) {
  for (const c of race.cars.values())
    race.input(c.id, {
      seq: c.input.seq + 1,
      left: c.id === 'p0' && left,
      right: c.id === 'p0' && right,
      actionSeq: 0,
    });
  race.step();
}

test('a real frost projectile captures current speed and immediately clears steering without changing velocity', () => {
  const race = fixture();
  try {
    const source = race.cars.get('p1')!,
      target = race.cars.get('p0')!,
      at = race.track.trackAt(target.progress);
    source.body.setTranslation(
      new Vector3().copy(target.body.translation()).addScaledVector(at.t, -8),
      true,
    );
    source.body.setRotation(target.body.rotation(), true);
    source.progress = target.progress - 8;
    target.body.setLinvel(at.t.clone().multiplyScalar(26), true);
    race.world.step();
    target.steering = 0.8;
    target.drift = 0.7;
    target.catchUp = 1;
    const velocity = { ...target.body.linvel() };
    source.weapon = 'frost';
    race.useWeapon(source);
    for (let i = 0; i < 50 && race.shots.length; i++) {
      race.tick++;
      race.updateShots();
    }
    assert.equal(race.shots.length, 0);
    assert.equal(target.frostUntil, race.tick + FROST_DURATION_TICKS);
    assert.ok(Math.abs(target.frostSpeed! - Math.hypot(velocity.x, velocity.z)) < 0.001);
    assert.deepEqual(
      { ...target.body.linvel() },
      velocity,
      'impact never writes the body velocity',
    );
    assert.equal(target.steering, 0);
    assert.equal(target.drift, 0);
    assert.equal(target.catchUp, 0);
    assert.equal(race.snapshot('FROST').cars.find((c) => c.id === target.id)!.frozen, true);
  } finally {
    race.dispose();
  }
});

test('frozen controls reject both steering directions, braking, reverse, nitro and catch-up at the captured speed', () => {
  const state = { steering: 0.9, drift: 0.8, grounded: true, reverseHold: 1, reversing: true };
  for (const speed of [-5, 0, 9, 22, 29])
    for (const turn of [-1, 0, 1])
      for (const brake of [false, true]) {
        const control = drivingControl(
          speed,
          state,
          {
            speed: Math.abs(speed),
            turn,
            brake,
            boost: true,
            frozen: true,
            frozenSpeed: speed,
            hit: false,
          },
          DT,
          1,
        );
        assert.equal(control.steering, 0);
        assert.equal(control.yawRate, 0);
        assert.equal(control.drift, 0);
        assert.equal(control.brake, false);
        assert.equal(control.reversing, false);
        assert.equal(control.reverseHold, 0);
        assert.ok(Math.abs(control.acceleration - speed * DRIVING.linearDamping) < 1e-12);
      }
  const thawed = drivingControl(
    20,
    { ...state, reversing: false },
    { speed: 20, turn: 1, brake: false, boost: false, frozen: false, hit: false },
    DT,
  );
  assert.ok(thawed.steering > 0);
  assert.ok(thawed.yawRate > 0);
});

for (const map of ['desert', 'forest', 'volcano'] as const)
  for (const bot of [false, true])
    test(`${map}: frozen ${bot ? 'bot' : 'human'} keeps actual speed and heading despite held turns and brakes`, () => {
      const race = fixture(map);
      try {
        const target = race.cars.get('p0')!;
        // Suspension is settled using the real vehicle controller before the hit.
        for (let i = 0; i < 20; i++) step(race);
        target.bot = bot;
        target.invulnerableUntil = 0;
        const yaw = bodyYaw(target.body),
          initial = Math.hypot(target.body.linvel().x, target.body.linvel().z);
        assert.equal(applyFrost(target, race.tick), true);
        const frozenUntil = target.frostUntil;
        let maxDelta = 0;
        for (let i = 0; i < FROST_DURATION_TICKS - 1; i++) {
          step(race, true, i % 3 === 0);
          const speed = Math.hypot(target.body.linvel().x, target.body.linvel().z);
          maxDelta = Math.max(maxDelta, Math.abs(speed - initial));
          assert.equal(target.steering, 0);
          assert.equal(target.reversing, false);
          assert.ok(target.alive);
        }
        assert.ok(maxDelta < 1, `speed changed by ${maxDelta} from ${initial}`);
        const error = Math.atan2(
          Math.sin(bodyYaw(target.body) - yaw),
          Math.cos(bodyYaw(target.body) - yaw),
        );
        assert.ok(Math.abs(error) < 0.08, `heading drift ${error}`);
        assert.equal(race.tick, frozenUntil - 1);
        step(race, true, false);
        assert.equal(race.snapshot('THAW').cars.find((c) => c.id === target.id)!.frozen, false);
        assert.equal(target.frostSpeed, null);
        if (!bot) assert.ok(target.steering > 0, 'held steering works on the first unfrozen tick');
      } finally {
        race.dispose();
      }
    });

test('pause stops frost expiry; repeat hits extend it, protection rejects it, and resets clear it', () => {
  const race = fixture();
  try {
    const car = race.cars.get('p0')!;
    car.invulnerableUntil = race.tick + 10;
    assert.equal(applyFrost(car, race.tick), false);
    car.invulnerableUntil = 0;
    assert.equal(applyFrost(car, race.tick), true);
    const speed = car.frostSpeed,
      deadline = car.frostUntil,
      tick = race.tick;
    race.pause();
    for (let i = 0; i < 100; i++) race.step();
    assert.equal(race.tick, tick);
    assert.equal(car.frostUntil, deadline);
    race.resume();
    step(race);
    car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    applyFrost(car, race.tick);
    assert.equal(car.frostSpeed, speed);
    assert.ok(car.frostUntil > deadline);
    car.boostUntil = race.tick + 100;
    assert.equal(race.snapshot('ICE').cars.find((c) => c.id === car.id)!.boosted, false);
    race.lobby();
    assert.equal(car.frostSpeed, null);
    assert.equal(car.frostUntil, 0);
    race.start();
    assert.equal(car.frostSpeed, null);
  } finally {
    race.dispose();
  }
});

test('frozen cars retain gravity and physical impulses instead of restoring a saved velocity', () => {
  const race = fixture();
  try {
    const car = race.cars.get('p0')!;
    car.body.setTranslation({ ...car.body.translation(), y: 5 }, true);
    applyFrost(car, race.tick);
    car.body.applyImpulse({ x: 2000, y: 800, z: 1000 }, true);
    const pushed = { ...car.body.linvel() };
    step(race, true, true);
    assert.ok(car.body.linvel().y < pushed.y, 'gravity still changes vertical velocity');
    assert.ok(
      Math.hypot(car.body.linvel().x - pushed.x, car.body.linvel().z - pushed.z) < 1,
      'no airborne motor or velocity snap',
    );
    assert.equal(car.vehicle.contacts, 0);
  } finally {
    race.dispose();
  }
});
