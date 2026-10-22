import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import { Race, initPhysics } from '../shared/simulation.ts';
import { PROJECTILE_RANGE, PULSE } from '../shared/rules.ts';
import type { Car } from '../shared/entities.ts';

before(initPhysics);
const up = new Vector3(0, 1, 0);
const origin = new Vector3(1000, 20, 1000);
const distance = (a: { x: number; y: number; z: number }, b: Vector3) =>
  b.distanceTo(new Vector3().copy(a));

function pose(car: Car, point: Vector3, yaw = 0) {
  car.body.setTranslation(point, true);
  car.body.setRotation(new Quaternion().setFromAxisAngle(up, yaw), true);
  car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  car.invulnerableUntil = 0;
}

function setup(players = 2, yaw = 0) {
  const race = new Race(372);
  for (let slot = 0; slot < players; slot++)
    race.addDriver({
      id: `p${slot}`,
      name: `Weapon ${slot}`,
      slot,
      bot: false,
      connected: true,
      ready: true,
      wins: 0,
    });
  race.start();
  race.phase = 'racing';
  race.pickupUntil.fill(Infinity);
  // Empty space isolates projectile range from map walls, ramps and scenery.
  for (const car of race.cars.values())
    pose(car, origin.clone().add(new Vector3(car.slot * 100, 0, 0)), yaw);
  race.world.step();
  return race;
}

function fly(race: Race) {
  for (let tick = 0; tick < 160 && race.shots.length; tick++) {
    race.tick++;
    race.updateShots();
  }
  assert.equal(race.shots.length, 0, 'projectile has a finite lifetime');
}

for (const kind of ['rocket', 'frost'] as const)
  for (const yaw of [0, 0.93, Math.PI])
    test(`${kind}: stops exactly at its range along the actual nose (${yaw}) and emits one endpoint effect`, () => {
      const race = setup(2, yaw);
      try {
        const source = race.cars.get('p0')!;
        source.weapon = kind;
        race.useWeapon(source);
        const shot = race.shots[0],
          start = new Vector3().copy(shot.position),
          heading = new Vector3().copy(shot.velocity).normalize();
        const endpoint = start.clone().addScaledVector(heading, PROJECTILE_RANGE[kind]);
        let maximum = 0;
        for (let tick = 0; tick < 160 && race.shots.length; tick++) {
          race.tick++;
          race.updateShots();
          maximum = Math.max(maximum, distance(shot.position, start));
          assert.ok(
            maximum <= PROJECTILE_RANGE[kind] + 0.000001,
            'never overshoots its maximum range',
          );
        }
        assert.equal(race.shots.length, 0);
        assert.ok(distance(shot.position, endpoint) < 0.000001);
        const effects = race.events.filter(
          (event) => event.type === (kind === 'rocket' ? 'explosion' : 'frost'),
        );
        assert.equal(effects.length, 1);
        assert.ok(distance(effects[0].position, endpoint) < 0.000001);
        for (let tick = 0; tick < 5; tick++) race.updateShots();
        assert.equal(
          race.events.filter((event) => event.type === effects[0].type).length,
          1,
          'no duplicate blast',
        );
        assert.equal(source.weapon, null);
        assert.equal('travelled' in (race.snapshot('RANGE').projectiles[0] ?? {}), false);
      } finally {
        race.dispose();
      }
    });

for (const kind of ['rocket', 'frost'] as const) {
  test(`${kind}: clips the last sweep to its range even when one tick could cross 172 metres`, () => {
    const race = setup();
    try {
      const source = race.cars.get('p0')!;
      source.weapon = kind;
      race.useWeapon(source);
      const shot = race.shots[0],
        start = new Vector3().copy(shot.position);
      shot.velocity = { x: 0, y: 0, z: 8600 };
      race.tick++;
      race.updateShots();
      assert.equal(race.shots.length, 0);
      assert.ok(Math.abs(distance(shot.position, start) - PROJECTILE_RANGE[kind]) < 0.000001);
    } finally {
      race.dispose();
    }
  });

  test(`${kind}: a wall past the endpoint cannot cause an overshoot, while an earlier wall detonates immediately`, () => {
    for (const wallDistance of [9, PROJECTILE_RANGE[kind] + 3]) {
      const race = setup();
      try {
        const source = race.cars.get('p0')!;
        source.weapon = kind;
        race.useWeapon(source);
        const shot = race.shots[0],
          start = new Vector3().copy(shot.position);
        race.world.createCollider(
          RAPIER.ColliderDesc.cuboid(3, 3, 0.3).setTranslation(
            start.x,
            start.y,
            start.z + wallDistance,
          ),
        );
        race.world.step();
        shot.velocity = { x: 0, y: 0, z: 8600 };
        race.tick++;
        race.updateShots();
        const travelled = distance(shot.position, start);
        assert.equal(race.shots.length, 0);
        if (wallDistance < PROJECTILE_RANGE[kind])
          assert.ok(travelled < wallDistance && travelled > wallDistance - 1);
        else assert.ok(Math.abs(travelled - PROJECTILE_RANGE[kind]) < 0.000001);
      } finally {
        race.dispose();
      }
    }
  });

  test(`${kind}: stalled-projectile timeout is visible, and pause freezes its flight budget`, () => {
    const race = setup();
    try {
      const source = race.cars.get('p0')!;
      source.weapon = kind;
      race.useWeapon(source);
      const shot = race.shots[0],
        start = { ...shot.position },
        tick = race.tick;
      assert.equal(
        'travelled' in race.snapshot('WIRE').projectiles[0],
        false,
        'range accounting stays server-private',
      );
      race.pause();
      for (let n = 0; n < 30; n++) race.step();
      assert.equal(race.tick, tick);
      assert.deepEqual({ ...shot.position }, start);
      assert.equal(shot.travelled, 0);
      race.resume();
      shot.velocity = { x: 0, y: 0, z: 0 };
      race.tick = shot.expires;
      race.updateShots();
      assert.equal(race.shots.length, 0);
      assert.equal(
        race.events.filter((event) => event.type === (kind === 'rocket' ? 'explosion' : 'frost'))
          .length,
        1,
      );
    } finally {
      race.dispose();
    }
  });
}

test('a close impact cannot hurt or push the rocket owner; an opponent is still eliminated normally', () => {
  const race = setup(3);
  try {
    const source = race.cars.get('p0')!,
      target = race.cars.get('p1')!;
    pose(target, origin.clone().add(new Vector3(0, 0, 6)));
    race.world.step();
    source.weapon = 'rocket';
    race.useWeapon(source);
    const velocity = { ...source.body.linvel() },
      angular = { ...source.body.angvel() };
    fly(race);
    assert.equal(race.pendingDeaths.has(source.id), false);
    assert.equal(source.invulnerableUntil, 0, 'does not grant general spawn immunity');
    assert.equal(source.hitUntil, 0);
    assert.equal(source.wreckUntil, 0);
    assert.deepEqual({ ...source.body.linvel() }, velocity);
    assert.deepEqual({ ...source.body.angvel() }, angular);
    assert.ok(race.pendingDeaths.has(target.id));
    race.step();
    assert.equal(source.alive, true);
    assert.equal(target.alive, false);
    assert.ok(race.deaths.some((group) => group.includes(target.id)));
  } finally {
    race.dispose();
  }
});

test('firing into a nearby wall keeps a moving shooter alive without blast recoil or a hit penalty', () => {
  const race = setup();
  try {
    const source = race.cars.get('p0')!;
    race.world.createCollider(
      RAPIER.ColliderDesc.cuboid(3, 3, 0.3).setTranslation(origin.x, origin.y, origin.z + 4),
    );
    race.world.step();
    source.body.setLinvel({ x: 0, y: 0, z: 19 }, true);
    source.weapon = 'rocket';
    race.useWeapon(source);
    race.step();
    assert.equal(race.shots.length, 0, 'rocket explodes against the close wall');
    assert.equal(race.events.filter((event) => event.type === 'explosion').length, 1);
    assert.equal(source.alive, true);
    assert.equal(source.hitUntil, 0);
    assert.equal(source.wreckUntil, 0);
    assert.equal(source.invulnerableUntil, 0);
    assert.ok(source.body.linvel().z > 18, 'no self blast slows the car');
    assert.ok(source.body.linvel().y < 0, 'no blast launches the owner');
  } finally {
    race.dispose();
  }
});

test('rocket owner stays safe even after driving into its endpoint blast, while a nearby rival is eliminated', () => {
  const race = setup();
  try {
    const source = race.cars.get('p0')!,
      target = race.cars.get('p1')!;
    source.weapon = 'rocket';
    race.useWeapon(source);
    const shot = race.shots[0],
      endpoint = new Vector3().copy(shot.position).add(new Vector3(0, 0, PROJECTILE_RANGE.rocket));
    pose(source, endpoint.clone().add(new Vector3(1, 0, 0)));
    pose(target, endpoint.clone().add(new Vector3(-2, 0, 0)));
    race.world.step();
    const velocity = { ...source.body.linvel() };
    fly(race);
    assert.ok(distance(shot.position, endpoint) < 0.000001, 'sweep excludes its owner');
    assert.equal(race.pendingDeaths.has(source.id), false);
    assert.equal(source.hitUntil, 0);
    assert.deepEqual({ ...source.body.linvel() }, velocity);
    assert.ok(race.pendingDeaths.has(target.id), 'endpoint detonation still has real blast damage');
  } finally {
    race.dispose();
  }
});

test('firing a rocket never protects against a rival rocket: an exchange still resolves a simultaneous wipe', () => {
  const race = setup();
  try {
    const source = race.cars.get('p0')!,
      target = race.cars.get('p1')!;
    pose(target, origin.clone().add(new Vector3(0, 0, 12)), Math.PI);
    race.world.step();
    for (const car of [source, target]) {
      car.weapon = 'rocket';
      race.useWeapon(car);
    }
    fly(race);
    assert.ok(race.pendingDeaths.has(source.id));
    assert.ok(race.pendingDeaths.has(target.id));
    race.step();
    assert.equal(source.alive, false);
    assert.equal(target.alive, false);
    assert.equal(source.score, 5);
    assert.equal(target.score, 5);
  } finally {
    race.dispose();
  }
});

for (const separation of [2, 4, 7.5])
  test(`pulse pushes much harder at ${separation} metres without changing its radius`, () => {
    const race = setup();
    try {
      const source = race.cars.get('p0')!,
        target = race.cars.get('p1')!;
      pose(target, origin.clone().add(new Vector3(separation, 0, 0)));
      pose(source, origin.clone());
      source.weapon = 'pulse';
      target.catchUp = 1;
      race.useWeapon(source);
      const v = target.body.linvel(),
        oldPush = 11 * (1 - separation / 8);
      assert.ok(v.x > oldPush * 2.5 && v.x >= 8, `actual push speed ${v.x}`);
      assert.ok(v.y > 2);
      assert.equal(v.z, 0);
      assert.equal(target.hitUntil, race.tick + PULSE.hitTicks);
      assert.equal(target.catchUp, 0);
      assert.equal(race.pendingDeaths.size, 0, 'pulse itself is not lethal');
      assert.equal(source.weapon, null);
    } finally {
      race.dispose();
    }
  });

test('one pulse physically scatters seven rivals on the real road without moving its source or producing invalid physics', () => {
  const race = setup(8);
  try {
    const at = race.track.trackAt(20),
      start = at.p.clone().setY(0.69);
    const starts = new Map<string, Vector3>();
    for (const car of race.cars.values()) {
      const angle = ((car.slot - 1) / 7) * Math.PI * 2;
      const p = car.slot
        ? start.clone().add(new Vector3(Math.cos(angle) * 4, 0, Math.sin(angle) * 4))
        : start.clone();
      pose(car, p, at.yaw);
      car.progress = race.track.projectOnTrack(p).s;
      starts.set(car.id, p.clone());
    }
    race.world.step();
    const source = race.cars.get('p0')!,
      before = { ...source.body.linvel() };
    source.weapon = 'pulse';
    race.useWeapon(source);
    assert.deepEqual({ ...source.body.linvel() }, before);
    for (let tick = 0; tick < 8; tick++) {
      for (const car of race.cars.values())
        race.input(car.id, { seq: tick + 1, left: false, right: false, actionSeq: 0 });
      race.step();
    }
    for (const car of race.cars.values()) {
      const p = car.body.translation(),
        v = car.body.linvel();
      assert.ok(Number.isFinite(p.x + p.y + p.z + v.x + v.y + v.z));
      assert.equal(car.alive, true);
      if (car.id !== source.id) {
        const from = starts.get(car.id)!;
        assert.ok(
          Math.hypot(p.x - from.x, p.z - from.z) > 2,
          `${car.id} visibly moves over two metres in 160ms`,
        );
      }
    }
    assert.equal(race.events.filter((event) => event.type === 'pulse').length, 1);
  } finally {
    race.dispose();
  }
});
