import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { Quaternion, Vector3 } from 'three';
import { Race, initPhysics } from '../shared/simulation.ts';
import { DRIVING } from '../shared/driving.ts';
import { VEHICLE_RIDE_HEIGHT } from '../shared/rules.ts';
import type { MapId } from '../shared/maps.ts';
import type { Car } from '../shared/entities.ts';

before(initPhysics);

function setup(mapId: MapId = 'desert') {
  const race = new Race(271, { mapId, lapLimit: 9, winningScore: 50 });
  for (let slot = 0; slot < 8; slot++)
    race.addDriver({
      id: `p${slot}`,
      name: `Suspension ${slot}`,
      slot,
      bot: false,
      ready: true,
      connected: true,
      wins: 0,
    });
  race.start();
  race.phase = 'racing';
  for (const car of race.cars.values()) car.invulnerableUntil = Infinity;
  return race;
}

function pose(car: Car, point: Vector3, yaw: number, speed = 0) {
  car.body.setTranslation(point, true);
  car.body.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw), true);
  car.body.setLinvel({ x: Math.sin(yaw) * speed, y: 0, z: Math.cos(yaw) * speed }, true);
  car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  car.vehicle.reset();
}

function step(race: Race, brake = false) {
  for (const car of race.cars.values())
    race.input(car.id, { seq: car.input.seq + 1, left: brake, right: brake, actionSeq: 0 });
  race.step();
}

const upright = (car: Car) => new Vector3(0, 1, 0).applyQuaternion(car.body.rotation()).y;

test('four independent springs absorb an asymmetric drop and settle without bouncing', () => {
  const race = setup();
  try {
    const car = race.cars.get('p0')!,
      at = race.track.trackAt(80);
    car.progress = 80;
    pose(car, at.p.clone().setY(3.5), at.yaw);
    car.body.setRotation(
      new Quaternion()
        .setFromAxisAngle(new Vector3(0, 0, 1), 0.12)
        .premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), at.yaw)),
      true,
    );
    let compressed = false,
      asymmetric = false,
      airborne = false;
    const heights: number[] = [];
    for (let tick = 0; tick < 180; tick++) {
      step(race, true);
      airborne ||= car.vehicle.contacts === 0;
      compressed ||= car.vehicle.suspension.some((travel) => travel > 0.04);
      asymmetric ||=
        Math.max(...car.vehicle.suspension) - Math.min(...car.vehicle.suspension) > 0.06;
      if (tick > 130) heights.push(car.body.translation().y);
    }
    assert.ok(airborne && compressed && asymmetric, 'independent springs compress on landing');
    assert.equal(car.vehicle.controller.numWheels(), 4);
    assert.equal(car.vehicle.contacts, 4);
    assert.ok(upright(car) > 0.99);
    assert.ok(Math.abs(car.body.translation().y - VEHICLE_RIDE_HEIGHT) < 0.04);
    assert.ok(
      Math.max(...heights) - Math.min(...heights) < 0.015,
      'suspension settles rather than pogoing',
    );
    assert.ok(Math.abs(car.body.linvel().y) < 0.5);
    assert.deepEqual(race.snapshot('SPRINGS').cars[0].suspension, car.vehicle.suspension);
  } finally {
    race.dispose();
  }
});

for (const mapId of ['forest', 'volcano'] as const)
  for (const index of [0, 1])
    test(`${mapId}: eight human cars jump crossing ${index + 1} together and recover their suspension`, (t) => {
      const race = setup(mapId),
        ramp = race.track.RAMPS[index],
        gap = race.track.GAPS[index],
        at = race.track.trackAt(ramp.s);
      try {
        for (const car of race.cars.values()) {
          const along = -ramp.length / 2 - 4 - Math.floor(car.slot / 4) * 5;
          pose(
            car,
            at.p
              .clone()
              .addScaledVector(at.t, along)
              .addScaledVector(at.n, ((car.slot % 4) - 1.5) * 2.7)
              .setY(VEHICLE_RIDE_HEIGHT),
            at.yaw,
            DRIVING.speed,
          );
          car.progress = ramp.s + along;
        }
        race.world.step();
        const peaks = Array(8).fill(0) as number[],
          airTicks = Array(8).fill(0) as number[],
          landing = Array(8).fill(-1) as number[],
          settled = new Set<number>();
        let compression = 0;
        for (let tick = 0; tick < 230 && settled.size < 8; tick++) {
          step(race);
          for (const car of race.cars.values()) {
            const p = car.body.translation(),
              lane = car.slot;
            assert.ok(car.alive, `${car.id} survives crossing at ${tick}`);
            assert.ok(Number.isFinite(p.x + p.y + p.z));
            assert.ok(
              new Vector3().copy(car.body.linvel()).length() < 55,
              'bounded contact impulses',
            );
            peaks[lane] = Math.max(peaks[lane], p.y);
            compression = Math.max(compression, ...car.vehicle.suspension);
            if (p.y > 2 && !car.grounded) airTicks[lane]++;
            const progress = race.track.projectOnTrack(p).s;
            if (
              landing[lane] < 0 &&
              airTicks[lane] > 2 &&
              progress > gap.s + gap.length / 2 &&
              car.vehicle.contacts >= 2 &&
              p.y < 0.95
            )
              landing[lane] = tick;
            if (!settled.has(lane) && landing[lane] >= 0 && tick - landing[lane] >= 15) {
              assert.ok(upright(car) > 0.85, `${car.id} remains upright after touchdown`);
              assert.ok(car.vehicle.contacts >= 2, `${car.id} regains tyre contact`);
              assert.ok(
                Math.abs(car.body.linvel().y) < 1.5,
                `${car.id} damps vertical bounce vy=${car.body.linvel().y}, y=${p.y}, s=${progress}, landing=${landing[lane]}, tick=${tick}`,
              );
              settled.add(lane);
            }
          }
        }
        assert.equal(settled.size, 8, `landings: ${landing}`);
        assert.ok(
          peaks.every((peak) => peak > ramp.height + 0.3),
          `peaks: ${peaks}`,
        );
        assert.ok(compression > 0.04, 'landing visibly compresses the springs');
        t.diagnostic(
          `8/8 landed; peaks ${Math.min(...peaks).toFixed(2)}–${Math.max(...peaks).toFixed(2)}m; max suspension compression ${compression.toFixed(2)}m`,
        );
      } finally {
        race.dispose();
      }
    });

for (const mapId of ['desert', 'forest', 'volcano'] as const)
  test(`${mapId}: eight-car head-on pileup transfers momentum and settles without roof traction`, (t) => {
    const race = setup(mapId),
      at = race.track.trackAt(80);
    try {
      const handles = new Set([...race.cars.values()].map((car) => car.body.handle));
      for (const car of race.cars.values()) {
        const group = car.slot < 4 ? 1 : -1;
        pose(
          car,
          at.p
            .clone()
            .addScaledVector(at.t, -group * 4)
            .addScaledVector(at.n, ((car.slot % 4) - 1.5) * 2.4)
            .setY(VEHICLE_RIDE_HEIGHT),
          at.yaw + (group < 0 ? Math.PI : 0),
          DRIVING.speed,
        );
        car.progress = 80 - group * 4;
      }
      race.world.step();
      const collisions = new Set<string>(),
        braked = new Set<string>();
      let peakSpeed = 0;
      for (let tick = 0; tick < 180; tick++) {
        step(race, tick >= 20);
        for (const car of race.cars.values()) {
          const p = car.body.translation(),
            v = car.body.linvel();
          assert.ok(car.alive && Number.isFinite(p.x + p.y + p.z + v.x + v.y + v.z));
          const speed = new Vector3().copy(v).length();
          if (tick >= 20 && !car.reversing && speed < 1) braked.add(car.id);
          peakSpeed = Math.max(peakSpeed, speed);
          assert.ok(peakSpeed < 45 && p.y > 0.2 && p.y < 4, 'collision solver remains bounded');
          race.world.contactPairsWith(car.body.collider(0), (other) => {
            if (other.parent() && handles.has(other.parent()!.handle))
              collisions.add([car.body.handle, other.parent()!.handle].sort().join(':'));
          });
          for (let wheel = 0; wheel < 4; wheel++) {
            const ground = car.vehicle.controller.wheelGroundObject(wheel)?.parent();
            assert.ok(!ground || !handles.has(ground.handle), 'car roofs do not power tyres');
          }
        }
      }
      assert.ok(collisions.size >= 4, `contact pairs: ${collisions.size}`);
      for (const car of race.cars.values()) {
        assert.ok(
          upright(car) > 0.8 && car.vehicle.contacts >= 2,
          `${car.id} recovers after impact`,
        );
        assert.ok(
          braked.has(car.id),
          `${car.id} brakes to a near stop before reverse after impact`,
        );
        assert.ok(
          new Vector3().copy(car.body.linvel()).length() < DRIVING.reverseSpeed + 0.5,
          `${car.id} stays within the reverse speed limit after holding both buttons`,
        );
      }
      t.diagnostic(
        `${collisions.size} chassis contact pairs; peak speed ${peakSpeed.toFixed(2)}m/s; 8/8 recover`,
      );
    } finally {
      race.dispose();
    }
  });

test('respawn clears suspension contacts and removal releases the native controller before its chassis', () => {
  const race = setup();
  try {
    const car = race.cars.get('p0')!;
    for (let cycle = 0; cycle < 12; cycle++) {
      step(race);
      race.place(car, 80);
      assert.equal(car.vehicle.contacts, 0);
      assert.deepEqual(car.vehicle.suspension, [0, 0, 0, 0]);
      assert.equal(car.vehicle.controller.chassis().handle, car.body.handle);
      assert.equal(race.world.vehicleControllers.size, 8);
    }
    race.removeDriver(car.id);
    assert.equal(race.world.vehicleControllers.size, 7);
    for (let tick = 0; tick < 30; tick++) step(race);
    assert.equal(race.cars.size, 7);
  } finally {
    race.dispose();
  }
});
