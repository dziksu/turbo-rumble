import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import { DRIVING, drivingControl } from '../shared/driving.ts';
import { Race, initPhysics } from '../shared/simulation.ts';
import { PHYSICS_STEP_SECONDS as DT, VEHICLE_RIDE_HEIGHT } from '../shared/rules.ts';
import type { Car } from '../shared/entities.ts';
import type { MapId } from '../shared/maps.ts';

before(initPhysics);
const stopped = () => ({ steering: 0, drift: 0, grounded: true, reverseHold: 0, reversing: false });
const held = { speed: 0, turn: 0, brake: true, boost: false, frozen: false, hit: false };

test('both buttons brake before a continuous hold at a near stop engages reverse', () => {
  let state = stopped();
  for (let i = 0; i < 19; i++) {
    const control = drivingControl(0, state, held, DT);
    assert.equal(control.brake, true);
    assert.equal(control.reversing, false);
    state = { ...state, ...control };
  }
  const reverse = drivingControl(0, state, held, DT);
  assert.equal(reverse.reversing, true);
  assert.equal(reverse.brake, false);
  assert.ok(reverse.acceleration < 0);
  const moving = drivingControl(-3, { ...state, ...reverse }, { ...held, speed: 3 }, DT);
  assert.equal(moving.reversing, true, 'reverse stays engaged beyond the entry threshold');
  assert.ok(moving.acceleration < 0);
  const released = drivingControl(-3, { ...state, ...moving }, { ...held, brake: false }, DT);
  assert.equal(released.reversing, false);
  assert.equal(released.reverseHold, 0);
  assert.ok(released.acceleration > 0, 'release restores forward throttle');
});

test('moving, sliding, airborne and impact frames cannot arm reverse', () => {
  for (const mode of ['forward', 'sideways', 'air', 'hit', 'release'] as const) {
    let state = { ...stopped(), grounded: mode !== 'air' };
    for (let i = 0; i < 50; i++) {
      const control = drivingControl(
        mode === 'forward' ? 10 : 0,
        state,
        {
          ...held,
          speed: mode === 'forward' || mode === 'sideways' ? 10 : 0,
          hit: mode === 'hit',
          brake: mode !== 'release',
        },
        DT,
      );
      assert.equal(control.reversing, false, mode);
      assert.equal(control.reverseHold, 0, mode);
      state = { ...state, ...control };
    }
  }
  for (const mode of ['air', 'hit'] as const) {
    const control = drivingControl(
      -3,
      { ...stopped(), reversing: true, grounded: mode !== 'air' },
      { ...held, speed: 3, hit: mode === 'hit' },
      DT,
    );
    assert.equal(control.reversing, false, mode);
  }
});

test('reverse speed and acceleration stay bounded without nitro or catch-up stacking', () => {
  const state = { ...stopped(), reversing: true, reverseHold: DRIVING.reverseHoldSeconds };
  for (const boost of [false, true]) {
    const moving = drivingControl(0, state, { ...held, boost }, DT, 1);
    assert.equal(moving.acceleration, -DRIVING.reverseAcceleration);
    assert.equal(
      drivingControl(-DRIVING.reverseSpeed, state, { ...held, boost }, DT, 1).acceleration,
      0,
    );
    assert.ok(drivingControl(-8, state, { ...held, boost }, DT, 1).acceleration > 0);
    assert.equal(
      drivingControl(
        -DRIVING.reverseSpeed,
        state,
        { ...held, boost, frozen: true, frozenSpeed: -DRIVING.reverseSpeed },
        DT,
        1,
      ).acceleration,
      -DRIVING.reverseSpeed * DRIVING.linearDamping,
    );
  }
});

function fixture(mapId: MapId) {
  const race = new Race(751, { mapId, lapLimit: 9, winningScore: 50 });
  for (let i = 0; i < 2; i++)
    race.addDriver({
      id: `p${i}`,
      name: `Reverse ${i}`,
      slot: i,
      bot: false,
      connected: true,
      ready: true,
      wins: 0,
    });
  race.start();
  race.phase = 'racing';
  race.pickupUntil.fill(Infinity);
  race.cameraProgress = 76;
  for (const car of race.cars.values()) {
    car.progress = 80 + car.slot * 30;
    const at = race.track.trackAt(car.progress);
    car.body.setTranslation({ ...at.p, y: VEHICLE_RIDE_HEIGHT }, true);
    car.body.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), at.yaw), true);
    car.body.setLinvel(at.t.clone().multiplyScalar(car.slot ? 0 : 7), true);
    car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    car.invulnerableUntil = Infinity;
  }
  return race;
}
function step(race: Race, both: boolean, ticks: number) {
  for (let tick = 0; tick < ticks; tick++) {
    for (const car of race.cars.values())
      race.input(car.id, {
        seq: car.input.seq + 1,
        left: car.slot === 0 ? both : true,
        right: car.slot === 0 ? both : true,
        actionSeq: 0,
      });
    race.step();
  }
}
function speed(car: Car, forward: Vector3) {
  const v = car.body.linvel();
  return v.x * forward.x + v.z * forward.z;
}

for (const mapId of ['desert', 'forest', 'volcano'] as const)
  test(`${mapId}: a car physically stopped by a wall reverses away and drives forward on release`, () => {
    const race = fixture(mapId);
    try {
      const car = race.cars.get('p0')!,
        at = race.track.trackAt(80);
      const forward = new Vector3(Math.sin(at.yaw), 0, Math.cos(at.yaw));
      const wallPosition = at.p.clone().addScaledVector(forward, 4);
      const wall = race.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(wallPosition.x, 1.2, wallPosition.z)
          .setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), at.yaw)),
      );
      const collider = race.world.createCollider(RAPIER.ColliderDesc.cuboid(3, 1.2, 0.3), wall);
      step(race, false, 60);
      assert.ok(Math.abs(speed(car, forward)) < 0.8, 'the wall stops the real chassis');
      assert.ok(car.body.collider(0).contactCollider(collider, 0.05), 'chassis contacts the wall');
      const blocked = new Vector3().copy(car.body.translation());
      step(race, true, 90);
      assert.equal(car.reversing, true);
      assert.ok(speed(car, forward) < -2, 'wheel forces move the car backwards');
      assert.ok(
        new Vector3().copy(car.body.translation()).sub(blocked).dot(forward) < -2,
        'the car clears the obstacle without teleporting',
      );
      assert.equal(car.catchUp, 0);
      assert.equal(car.drift, 0);
      assert.ok(Math.hypot(car.body.linvel().x, car.body.linvel().z) <= DRIVING.reverseSpeed + 0.5);
      step(race, false, 22);
      assert.equal(car.reversing, false);
      assert.equal(car.reverseHold, 0);
      assert.ok(speed(car, forward) > 0, 'release resumes forward movement');
    } finally {
      race.dispose();
    }
  });

test('disconnect, stale input, controller takeover and a new round clear reverse', () => {
  for (const mode of ['disconnect', 'stale', 'takeover', 'round'] as const) {
    const race = fixture('desert');
    try {
      const car = race.cars.get('p0')!;
      car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      step(race, true, 60);
      assert.equal(car.reversing, true);
      if (mode === 'disconnect') race.setConnected(car.id, false);
      if (mode === 'takeover') race.resetInput(car.id);
      if (mode === 'round') race.lobby();
      if (mode === 'stale') for (let i = 0; i < 80; i++) race.step();
      assert.equal(car.reversing, false, mode);
      assert.equal(car.reverseHold, 0, mode);
    } finally {
      race.dispose();
    }
  }
});
