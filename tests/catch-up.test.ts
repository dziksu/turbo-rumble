import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { CATCH_UP, catchUpTarget, updateCatchUp } from '../shared/catch-up.ts';
import { DRIVING, drivingControl, drivingTargetSpeed } from '../shared/driving.ts';
import { Race, initPhysics } from '../shared/simulation.ts';
import { outsideCamera, trackAt, TRACK_LENGTH } from '../shared/track.ts';
import type { MapId } from '../shared/maps.ts';

before(async () => {
  await initPhysics();
});

function setup(gap = 14, bot = false, mapId: MapId = 'desert') {
  const race = new Race(217, { mapId, lapLimit: 3, winningScore: 10 });
  for (let slot = 0; slot < 2; slot++)
    race.addDriver({
      id: slot ? 'leader' : 'trailer',
      name: 'Catch-up ' + slot,
      slot,
      bot,
      ready: true,
      connected: true,
      wins: 0,
    });
  race.start();
  race.phase = 'racing';
  race.cameraProgress = 20 + gap - 4;
  race.pickupUntil.fill(Infinity);
  for (const car of race.cars.values()) {
    const s = 20 + (car.id === 'leader' ? gap : 0),
      at = race.track.trackAt(s),
      position = at.p.clone().addScaledVector(at.n, car.slot ? 2.5 : -2.5);
    car.progress = s;
    car.weapon = 'mine';
    car.invulnerableUntil = 0;
    car.body.setTranslation({ x: position.x, y: 0.55, z: position.z }, true);
    car.body.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), at.yaw), true);
    car.body.setLinvel(at.t.clone().multiplyScalar(DRIVING.speed - 1.5), true);
  }
  race.world.step();
  return race;
}

function step(race: Race, ticks = 1) {
  for (let tick = 0; tick < ticks; tick++) {
    for (const car of race.cars.values()) {
      const position = car.body.translation(),
        onTrack = race.track.projectOnTrack(position, car.progress),
        ahead = race.track.trackAt(onTrack.s + 5),
        target = ahead.p.addScaledVector(ahead.n, car.slot ? 2.5 : -2.5);
      const rotation = car.body.rotation(),
        yaw = Math.atan2(
          2 * (rotation.w * rotation.y + rotation.x * rotation.z),
          1 - 2 * (rotation.y ** 2 + rotation.z ** 2),
        );
      const desired = Math.atan2(target.x - position.x, target.z - position.z),
        error = Math.atan2(Math.sin(desired - yaw), Math.cos(desired - yaw));
      race.input(car.id, {
        seq: car.input.seq + 1,
        left: error > 0.06,
        right: error < -0.06,
        actionSeq: 0,
      });
    }
    race.step();
  }
}

test('assistance starts outside the starting pack and reaches its cap before the rear camera edge', () => {
  assert.equal(catchUpTarget(-2), 0);
  assert.equal(catchUpTarget(5), 0);
  assert.equal(catchUpTarget(6), 0);
  assert.ok(updateCatchUp(0, 6.1, true, 0.02) > 0);
  assert.equal(catchUpTarget(8), 0.5);
  assert.equal(catchUpTarget(10), 1);
  assert.equal(catchUpTarget(14), 1);
  assert.equal(catchUpTarget(1000), 1);
  for (const leader of [80, 300, 520, 740])
    assert.equal(outsideCamera(trackAt(leader - CATCH_UP.fullGap).p, leader - 4), false);
  let strength = updateCatchUp(0, 14, true, 0.02);
  assert.ok(strength > 0 && strength < 0.15, 'the faster aid still starts smoothly');
  for (let i = 1; i < 25; i++) strength = updateCatchUp(strength, 14, true, 0.02);
  assert.ok(strength >= 0.95, 'at least 95% assistance within half a second');
  for (let i = 0; i < 100; i++) strength = updateCatchUp(strength, 14, true, 0.02);
  assert.ok(strength > 0.99);
  for (let i = 0; i < 100; i++) strength = updateCatchUp(strength, 3, true, 0.02);
  assert.equal(strength, 0);
  assert.equal(updateCatchUp(1, 20, false, 0.02), 0);
});

test('catch-up speed stays below nitro, never stacks with it, and preserves braking and frost', () => {
  const base = drivingTargetSpeed(false, false, false),
    assist = drivingTargetSpeed(false, false, false, 1),
    nitro = drivingTargetSpeed(false, true, false);
  assert.ok(Math.abs(assist / base - 1.3) < 1e-12);
  assert.ok(assist < nitro);
  assert.equal(drivingTargetSpeed(false, true, false, 1), nitro);
  assert.equal(drivingTargetSpeed(true, false, false, 1), 0);
  assert.equal(drivingTargetSpeed(false, false, true, 1), drivingTargetSpeed(false, false, true));
});

test('trailing assistance raises acceleration from low speed and never reduces normal propulsion', () => {
  const state = { steering: 0, drift: 0, grounded: true, reverseHold: 0, reversing: false };
  const input = { speed: 0, turn: 0, brake: false, boost: false, frozen: false, hit: false };
  assert.equal(drivingTargetSpeed(false, false, false), 22);
  assert.equal(drivingControl(0, state, input, 0.02).acceleration, 15);
  assert.equal(drivingControl(0, state, input, 0.02, 1).acceleration, 21);
  for (const speed of [0, 8, 18, 22, 26, 30])
    for (const bonus of [0, 0.25, 0.5, 1]) {
      const normal = drivingControl(speed, state, { ...input, speed }, 0.02);
      const assisted = drivingControl(speed, state, { ...input, speed }, 0.02, bonus);
      assert.ok(
        assisted.acceleration >= normal.acceleration,
        'a catch-up bonus can only increase the normal forward acceleration',
      );
      assert.equal(assisted.steering, normal.steering);
    }
  for (const mode of ['brake', 'boost', 'frozen', 'hit', 'air'] as const) {
    const controlState = { ...state, grounded: mode !== 'air' };
    const controlInput = { ...input, [mode]: true };
    assert.equal(
      drivingControl(0, controlState, controlInput, 0.02, 1).acceleration,
      drivingControl(0, controlState, controlInput, 0.02).acceleration,
      mode,
    );
  }
});

test('a slow trailing car accelerates earlier while the leader matches an unassisted race', () => {
  const assisted = setup(),
    reference = setup();
  try {
    for (const race of [assisted, reference])
      for (const car of race.cars.values()) car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    for (let tick = 0; tick < 50; tick++) {
      reference.cars.get('trailer')!.catchUp = 0;
      step(assisted);
      step(reference);
      const leader = assisted.cars.get('leader')!,
        control = reference.cars.get('leader')!;
      assert.ok(
        new Vector3()
          .copy(leader.body.translation())
          .distanceTo(new Vector3().copy(control.body.translation())) < 0.0001,
        'the leader never pays for the trailing acceleration bonus',
      );
    }
    const speed = (race: Race) =>
      race.snapshot('ACCEL').cars.find((car) => car.id === 'trailer')!.speed;
    assert.ok(
      speed(assisted) > speed(reference) + 1,
      `early recovery speed: ${speed(assisted)} vs ${speed(reference)}`,
    );
    assert.ok(
      assisted.cars.get('trailer')!.progress > reference.cars.get('trailer')!.progress + 0.3,
    );
    assert.equal(assisted.phase, 'racing');
    assert.equal(assisted.cars.get('trailer')!.alive, true);
  } finally {
    assisted.dispose();
    reference.dispose();
  }
});

test('a human trailer gains actual speed and closes the gap without consuming an item or nitro effects', () => {
  const race = setup();
  try {
    const startGap = race.cars.get('leader')!.progress - race.cars.get('trailer')!.progress;
    step(race, 100);
    const leader = race.cars.get('leader')!,
      trailer = race.cars.get('trailer')!,
      gap = leader.progress - trailer.progress;
    assert.equal(race.phase, 'racing');
    assert.equal(trailer.alive, true);
    assert.ok(gap < startGap - 1, `Gap did not shrink enough: ${startGap} -> ${gap}`);
    const state = race.snapshot('CATCH1'),
      car = state.cars.find((car) => car.id === 'trailer')!;
    assert.ok(car.speed > state.cars.find((car) => car.id === 'leader')!.speed + 0.5);
    assert.ok(car.catchUpBonus! > 0 && car.catchUpBonus! <= CATCH_UP.maxSpeedBonus);
    assert.equal(leader.catchUp, 0);
    assert.equal(car.boosted, false);
    assert.equal(car.weapon, 'mine');
    assert.equal(trailer.boostUntil, 0);
    assert.equal(
      state.events.some((event) => event.type === 'shot'),
      false,
    );
  } finally {
    race.dispose();
  }
});

test('braking, damage, frost, air, wrong-way driving and disconnect do not get free propulsion', () => {
  for (const mode of [
    'brake',
    'hit',
    'frost',
    'air',
    'wrong-way',
    'disconnected',
    'nitro',
  ] as const) {
    const race = setup();
    try {
      const car = race.cars.get('trailer')!;
      car.catchUp = 1;
      if (mode === 'brake') race.input(car.id, { seq: 1, left: true, right: true, actionSeq: 0 });
      if (mode === 'hit') car.hitUntil = race.tick + 100;
      if (mode === 'frost') car.frostUntil = race.tick + 100;
      if (mode === 'air') {
        const p = car.body.translation();
        car.body.setTranslation({ ...p, y: 5 }, true);
      }
      if (mode === 'wrong-way')
        car.body.setRotation(
          new Quaternion().setFromAxisAngle(
            new Vector3(0, 1, 0),
            trackAt(car.progress).yaw + Math.PI,
          ),
          true,
        );
      if (mode === 'disconnected') race.setConnected(car.id, false);
      if (mode === 'nitro') car.boostUntil = race.tick + 100;
      race.step();
      assert.equal(car.catchUp, 0, mode);
      assert.equal(
        race.snapshot('CATCH1').cars.find((c) => c.id === car.id)!.catchUpBonus,
        0,
        mode,
      );
    } finally {
      race.dispose();
    }
  }
});

test('assistance uses unwrapped progress across the finish line and ignores eliminated cars', () => {
  const race = setup();
  try {
    const trailer = race.cars.get('trailer')!,
      leader = race.cars.get('leader')!;
    trailer.progress = TRACK_LENGTH - 5;
    leader.progress = TRACK_LENGTH + 9;
    for (const car of [trailer, leader]) {
      const at = trackAt(car.progress),
        position = at.p.clone().addScaledVector(at.n, car.slot ? 2.5 : -2.5);
      car.body.setTranslation({ x: position.x, y: 0.55, z: position.z }, true);
      car.body.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), at.yaw), true);
      car.body.setLinvel(at.t.clone().multiplyScalar(DRIVING.speed - 1.5), true);
    }
    race.cameraProgress = leader.progress - 4;
    race.world.step();
    race.step();
    assert.ok(trailer.catchUp > 0);
    assert.equal(leader.catchUp, 0);
    leader.alive = false;
    trailer.catchUp = 0;
    race.step();
    assert.equal(trailer.catchUp, 0);
  } finally {
    race.dispose();
  }
});

test('round placement clears assistance and bots use the same trailing-distance rule', () => {
  const race = setup(14, true);
  try {
    step(race, 10);
    assert.ok(race.cars.get('trailer')!.catchUp > 0);
    assert.equal(race.cars.get('leader')!.catchUp, 0);
    race.lobby();
    for (const car of race.cars.values()) assert.equal(car.catchUp, 0);
    race.start();
    for (const car of race.snapshot('CATCH1').cars) assert.equal(car.catchUpBonus, 0);
  } finally {
    race.dispose();
  }
});

for (const mapId of ['desert', 'forest', 'volcano'] as const)
  for (const bot of [false, true])
    test(`${mapId}: ${bot ? 'bot' : 'human'} trailer gains speed while the leader matches an unassisted reference`, () => {
      const assisted = setup(14, bot, mapId),
        reference = setup(14, bot, mapId);
      try {
        // A frozen reference follower cannot receive assistance or collide with the leader.
        reference.cars.get('trailer')!.frostUntil = Infinity;
        // Keep that slow fixture from ending the control race by falling outside the camera.
        reference.cars.get('trailer')!.invulnerableUntil = Infinity;
        for (const race of [assisted, reference])
          for (const car of race.cars.values()) car.weapon = null;
        let leaderSpeed = 0,
          trailerSpeed = 0,
          peakBonus = 0;
        for (let tick = 0; tick < 100; tick++) {
          step(assisted);
          step(reference);
          const state = assisted.snapshot('ASSIST'),
            leader = state.cars.find((car) => car.id === 'leader')!,
            trailer = state.cars.find((car) => car.id === 'trailer')!,
            control = reference.snapshot('CONTROL').cars.find((car) => car.id === 'leader')!;
          assert.ok(
            Math.abs(leader.speed - control.speed) < 0.0001,
            `catch-up must never brake the leader at tick ${tick}: ${leader.speed} vs ${control.speed} (${reference.phase})`,
          );
          assert.ok(
            new Vector3().copy(leader.position).distanceTo(new Vector3().copy(control.position)) <
              0.0001,
          );
          assert.equal(leader.catchUpBonus, 0);
          assert.equal(reference.cars.get('trailer')!.catchUp, 0);
          assert.equal(trailer.boosted, false);
          peakBonus = Math.max(peakBonus, trailer.catchUpBonus!);
          if (tick >= 50) {
            leaderSpeed += leader.speed;
            trailerSpeed += trailer.speed;
          }
        }
        assert.equal(assisted.phase, 'racing');
        assert.ok(
          trailerSpeed / 50 > leaderSpeed / 50 + 1,
          'the rear car must actually drive faster',
        );
        assert.ok(peakBonus > 0.26 && peakBonus <= CATCH_UP.maxSpeedBonus);
        const gap = assisted.cars.get('leader')!.progress - assisted.cars.get('trailer')!.progress;
        assert.ok(gap < (bot ? 11 : 10), `14 m gap should close promptly: ${gap}`);
      } finally {
        assisted.dispose();
        reference.dispose();
      }
    });
