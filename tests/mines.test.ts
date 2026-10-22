import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { Quaternion, Vector3 } from 'three';
import { Race, initPhysics } from '../shared/simulation.ts';
import { MINE_OWNER_PROTECTION_TICKS, PHYSICS_HZ } from '../shared/rules.ts';
import type { Car } from '../shared/entities.ts';

before(initPhysics);

function setup(yawOffset = 0) {
  const race = new Race(97);
  const at = race.track.trackAt(80),
    yaw = at.yaw + yawOffset,
    forward = new Vector3(Math.sin(yaw), 0, Math.cos(yaw)),
    side = new Vector3(forward.z, 0, -forward.x),
    rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  for (let slot = 0; slot < 3; slot++) {
    const car = race.addDriver({
      id: `p${slot}`,
      name: `P${slot}`,
      slot,
      bot: false,
      connected: true,
      ready: true,
      wins: 0,
    });
    car.body.setTranslation(
      { x: at.p.x + side.x * slot * 12, y: 0.65, z: at.p.z + side.z * slot * 12 },
      true,
    );
    car.body.setRotation(rotation, true);
    car.invulnerableUntil = 0;
  }
  race.phase = 'racing';
  race.cameraProgress = 80;
  const owner = race.cars.get('p0')!,
    target = race.cars.get('p1')!;
  owner.weapon = 'mine';
  race.useWeapon(owner);
  const mine = race.shots[0];
  function move(car: Car, along = 0, lateral = 0, height = 0) {
    const position = new Vector3()
      .copy(mine.position)
      .addScaledVector(forward, along)
      .addScaledVector(side, lateral);
    position.y = 0.65 + height;
    car.body.setTranslation(position, true);
    car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    // Test teleports bypass world.step(), which normally updates collider poses.
    race.world.propagateModifiedBodyPositionsToColliders();
  }
  return { race, owner, target, mine, forward, move };
}

for (const yaw of [0, 0.9, Math.PI])
  test(`a mine is live at drop and detonates once on first opponent contact (${yaw})`, () => {
    const { race, owner, target, mine, move } = setup(yaw);
    try {
      move(target);
      move(owner, 2.7);
      const handle = mine.body!.handle;
      assert.equal(mine.armed, true);
      assert.equal(race.tick, mine.born);
      race.updateShots();
      assert.ok(race.pendingDeaths.has(target.id));
      assert.equal(race.pendingDeaths.has(owner.id), false);
      assert.deepEqual({ ...owner.body.linvel() }, { x: 0, y: 0, z: 0 });
      assert.equal(owner.hitUntil, 0);
      assert.equal(owner.wreckUntil, 0);
      assert.equal(
        race.snapshot('MINE').cars.find((car) => car.id === owner.id)!.invulnerable,
        false,
      );
      assert.equal(race.shots.length, 0);
      assert.equal(race.world.bodies.get(handle), null);
      race.updateShots();
      assert.equal(race.events.filter((event) => event.type === 'explosion').length, 1);
    } finally {
      race.dispose();
    }
  });

test('owner contact is ignored until exactly three seconds, then detonates the same mine', () => {
  const { race, owner, mine, move } = setup();
  try {
    assert.equal(MINE_OWNER_PROTECTION_TICKS / PHYSICS_HZ, 3);
    move(owner);
    for (const age of [0, 75, MINE_OWNER_PROTECTION_TICKS - 1]) {
      race.tick = mine.born + age;
      race.updateShots();
      assert.equal(race.shots.length, 1);
      assert.equal(race.pendingDeaths.has(owner.id), false);
    }
    race.pause();
    for (let i = 0; i < 20; i++) race.step();
    assert.equal(race.tick, mine.born + MINE_OWNER_PROTECTION_TICKS - 1);
    race.resume();
    race.tick++;
    race.updateShots();
    assert.equal(race.shots.length, 0);
    assert.ok(race.pendingDeaths.has(owner.id));
  } finally {
    race.dispose();
  }
});

for (const age of [MINE_OWNER_PROTECTION_TICKS - 1, MINE_OWNER_PROTECTION_TICKS])
  test(`owner blast protection expires at three seconds, including an opponent's detonation (age ${age})`, () => {
    const { race, owner, target, mine, move } = setup();
    try {
      move(target);
      move(owner, 2.7);
      race.tick = mine.born + age;
      race.updateShots();
      assert.ok(race.pendingDeaths.has(target.id));
      assert.equal(race.pendingDeaths.has(owner.id), age >= MINE_OWNER_PROTECTION_TICKS);
      if (age < MINE_OWNER_PROTECTION_TICKS) assert.equal(owner.body.linvel().y, 0);
    } finally {
      race.dispose();
    }
  });

test('front bumper contact triggers a mine even when car centres are over 2.1 metres apart', () => {
  const { race, target, mine, move } = setup();
  try {
    move(target, 2.2);
    assert.ok(
      new Vector3().copy(target.body.translation()).distanceTo(new Vector3().copy(mine.position)) >
        2.1,
    );
    race.updateShots();
    assert.equal(race.shots.length, 0);
    assert.ok(race.pendingDeaths.has(target.id));
  } finally {
    race.dispose();
  }
});

for (const [name, lateral, height] of [
  ['beside', 1.7, 0],
  ['above', 0, 1.2],
] as const)
  test(`passing ${name} a mine without physical contact does not detonate it`, () => {
    const { race, target, move } = setup();
    try {
      move(target, 0, lateral, height);
      race.updateShots();
      assert.equal(race.shots.length, 1);
      assert.equal(race.pendingDeaths.size, 0);
    } finally {
      race.dispose();
    }
  });

test('a driving opponent detonates the mine on its first physical impact before the old arming delay', () => {
  const { race, target, mine, forward, move } = setup();
  try {
    move(target, -4);
    target.body.setLinvel({ x: forward.x * 24, y: 0, z: forward.z * 24 }, true);
    for (let i = 0; i < 15 && race.shots.length; i++) {
      race.tick++;
      race.world.step();
      race.updateShots();
    }
    assert.equal(race.shots.length, 0);
    assert.ok(race.tick - mine.born < 25);
    assert.ok(race.pendingDeaths.has(target.id));
  } finally {
    race.dispose();
  }
});

for (const kind of ['rocket', 'other mine'] as const)
  test(`dropping a mine does not protect its owner from a ${kind}`, () => {
    const { race, owner, target, mine, move } = setup();
    try {
      move(owner);
      if (kind === 'rocket') race.blast(owner.body.translation(), 'rocket');
      else {
        // The exact same physical mine belongs to a different player.
        mine.owner = target.id;
        race.updateShots();
      }
      assert.ok(race.pendingDeaths.has(owner.id));
    } finally {
      race.dispose();
    }
  });
