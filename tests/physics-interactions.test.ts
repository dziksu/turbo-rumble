import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import { Race, initPhysics } from '../shared/simulation.ts';
import {
  trackAt,
  OBSTACLES,
  RAMPS,
  TRACK_LENGTH,
  CENTER,
  TANGENTS,
  ROAD_WIDTH,
} from '../shared/track.ts';
before(async () => {
  await initPhysics();
});
function setup(n = 2) {
  const race = new Race(67);
  for (let i = 0; i < n; i++)
    race.addDriver({
      id: 'p' + i,
      name: 'P' + i,
      slot: i,
      bot: false,
      ready: true,
      connected: true,
      wins: 0,
    });
  race.start();
  race.phase = 'racing';
  race.roundStart = race.tick;
  race.cameraProgress = 80;
  for (const c of race.cars.values()) {
    c.weapon = null;
    c.invulnerableUntil = 100000;
  }
  return race;
}
function move(r: Race, id: string, s: number, side = 0, y = 0.65) {
  const c = r.cars.get(id)!,
    a = trackAt(s),
    p = a.p.clone().addScaledVector(a.n, side);
  c.progress = s;
  c.body.setTranslation({ x: p.x, y: r.track.surfaceHeight(p) + y, z: p.z }, true);
  c.body.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), a.yaw), true);
  c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  return c;
}
function run(r: Race, ticks: number) {
  for (let i = 0; i < ticks; i++) {
    for (const c of r.cars.values())
      r.input(c.id, { seq: c.input.seq + 1, left: false, right: false, actionSeq: 0 });
    r.step();
  }
}
test('larger road has no overlapping distant branches', () => {
  let closest = Infinity;
  for (let i = 0; i < CENTER.length; i += 8)
    for (let j = i + 8; j < CENTER.length; j += 8) {
      const along = (Math.min(j - i, CENTER.length - j + i) / CENTER.length) * TRACK_LENGTH;
      if (along < 35) continue;
      closest = Math.min(closest, CENTER[i].distanceTo(CENTER[j]));
    }
  assert.ok(closest > ROAD_WIDTH * 2 + 1, `branch separation ${closest}`);
});
test('corner curvature leaves a positive inner road radius', () => {
  let minimum = Infinity;
  for (let i = 0; i < TANGENTS.length; i++) {
    const dot = Math.max(-1, Math.min(1, TANGENTS[i].dot(TANGENTS[(i + 1) % TANGENTS.length]))),
      angle = Math.acos(dot);
    minimum = Math.min(minimum, TRACK_LENGTH / TANGENTS.length / Math.max(0.000001, angle));
  }
  assert.ok(minimum > ROAD_WIDTH + 2, `minimum radius ${minimum}`);
});
test('a dropped mine falls, settles on the road and has a physical body', () => {
  const r = setup();
  try {
    const c = move(r, 'p0', 80),
      other = move(r, 'p1', 100);
    c.weapon = 'mine';
    r.useWeapon(c);
    const shot = r.shots[0],
      initial = shot.position.y;
    assert.ok(shot.body?.isDynamic());
    run(r, 35);
    assert.ok(shot.position.y < initial - 0.1);
    assert.ok(shot.position.y > 0.08 && shot.position.y < 0.3, `mine height ${shot.position.y}`);
    assert.ok(Math.abs(shot.body!.linvel().y) < 0.2);
    assert.ok(other.alive);
  } finally {
    r.dispose();
  }
});
test('mine explosion launches the victim, then the physical wreck expires', () => {
  const r = setup();
  try {
    const a = move(r, 'p0', 80),
      at = trackAt(80),
      b = move(r, 'p1', 77);
    const behind = at.p.clone().addScaledVector(at.t, -3.1);
    b.body.setTranslation({ x: behind.x, y: 0.65, z: behind.z }, true);
    a.invulnerableUntil = b.invulnerableUntil = 0;
    a.weapon = 'mine';
    r.useWeapon(a);
    const mineHandle = r.shots[0].body!.handle;
    r.world.step();
    r.updateShots();
    assert.ok(b.body.linvel().y > 5);
    assert.ok(r.pendingDeaths.has(b.id));
    assert.equal(r.world.bodies.get(mineHandle), null);
    run(r, 1);
    assert.equal(b.alive, false);
    assert.equal(r.snapshot('TEST77').cars.find((c) => c.id === b.id)!.wrecked, true);
    const initial = b.body.translation().y;
    run(r, 8);
    assert.ok(b.body.translation().y > initial + 0.5);
    run(r, 65);
    assert.equal(b.body.isEnabled(), false);
    assert.equal(r.snapshot('TEST77').cars.find((c) => c.id === b.id)!.wrecked, false);
  } finally {
    r.dispose();
  }
});
test('rocket core is lethal and its outer blast physically pushes a survivor', () => {
  const r = setup(3);
  try {
    const a = move(r, 'p0', 80),
      b = move(r, 'p1', 89),
      c = move(r, 'p2', 89, 5);
    a.invulnerableUntil = b.invulnerableUntil = c.invulnerableUntil = 0;
    r.world.step();
    a.weapon = 'rocket';
    r.useWeapon(a);
    for (let i = 0; i < 30 && r.shots.length; i++) {
      r.tick++;
      r.updateShots();
    }
    assert.ok(r.pendingDeaths.has(b.id));
    assert.equal(r.pendingDeaths.has(c.id), false);
    assert.ok(Math.hypot(c.body.linvel().x, c.body.linvel().z) > 2);
    assert.ok(c.body.linvel().y > 0.2);
    run(r, 1);
    assert.equal(b.alive, false);
    assert.equal(c.alive, true);
  } finally {
    r.dispose();
  }
});
test('swept rocket hits a wall first and the wall shields a car behind it', () => {
  const r = setup();
  try {
    const a = move(r, 'p0', 80),
      b = move(r, 'p1', 90),
      at = trackAt(84.5);
    a.invulnerableUntil = b.invulnerableUntil = 0;
    r.world.createCollider(
      RAPIER.ColliderDesc.cuboid(4, 2, 0.4)
        .setTranslation(at.p.x, 2, at.p.z)
        .setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), at.yaw)),
    );
    r.world.step();
    a.weapon = 'rocket';
    r.useWeapon(a);
    const tangent = trackAt(80).t;
    r.shots[0].velocity = { x: tangent.x * 800, y: 0, z: tangent.z * 800 };
    r.tick++;
    r.updateShots();
    assert.equal(r.shots.length, 0);
    assert.equal(r.pendingDeaths.has(b.id), false);
    assert.ok(Math.hypot(b.body.linvel().x, b.body.linvel().z) < 0.5);
    assert.ok(r.events.some((e) => e.type === 'explosion'));
  } finally {
    r.dispose();
  }
});
test('car-to-car contacts transfer momentum and prevent interpenetration', () => {
  const r = setup();
  try {
    const a = move(r, 'p0', 80, -1.5, 0.55),
      b = move(r, 'p1', 80, 1.5, 0.55),
      normal = trackAt(80).n;
    a.body.setLinvel(normal.clone().multiplyScalar(10), true);
    b.body.setLinvel(normal.clone().multiplyScalar(-10), true);
    for (let i = 0; i < 15; i++) r.world.step();
    const va = a.body.linvel(),
      vb = b.body.linvel();
    assert.ok(va.x * normal.x + va.z * normal.z < -1);
    assert.ok(vb.x * normal.x + vb.z * normal.z > 1);
    assert.ok(new Vector3().copy(a.body.translation()).distanceTo(b.body.translation()) > 1.5);
  } finally {
    r.dispose();
  }
});
test('a car physically displaces a crate and snapshots carry the moved pose', () => {
  const r = setup();
  try {
    const obstacle = OBSTACLES.find((o) => o.kind === 'crate')!,
      at = trackAt(obstacle.s),
      a = move(r, 'p0', obstacle.s - 5, obstacle.side, 0.55);
    move(r, 'p1', obstacle.s + 30, 3);
    const body = r.obstacleBodies.get(obstacle.id)!,
      before = { ...body.translation() };
    a.body.setLinvel(at.t.clone().multiplyScalar(22), true);
    for (let i = 0; i < 20; i++) r.world.step();
    assert.ok(new Vector3().copy(body.translation()).distanceTo(before) > 0.6);
    const state = r.snapshot('TEST77').obstacles!.find((o) => o.id === obstacle.id)!;
    assert.deepEqual(state.position, { ...body.translation() });
    r.lobby();
    assert.ok(new Vector3().copy(body.translation()).distanceTo(obstacle.position) < 0.05);
  } finally {
    r.dispose();
  }
});
test('blast impulses move loose props and round reset removes mine bodies', () => {
  const r = setup();
  try {
    move(r, 'p0', 80);
    move(r, 'p1', 100);
    const o = OBSTACLES.find((o) => o.dynamic)!,
      body = r.obstacleBodies.get(o.id)!,
      origin = o.position.clone().addScaledVector(trackAt(o.s).n, -2);
    r.world.step();
    r.blast(origin, 'rocket');
    assert.ok(Math.hypot(body.linvel().x, body.linvel().z) > 5);
    assert.ok(body.linvel().y > 1);
    const count = r.world.bodies.len();
    const c = r.cars.get('p0')!;
    c.weapon = 'mine';
    r.useWeapon(c);
    assert.equal(r.world.bodies.len(), count + 1);
    r.lobby();
    assert.equal(r.world.bodies.len(), count);
    assert.equal(r.shots.length, 0);
    for (const ramp of RAMPS) assert.ok(ramp.height > 1);
  } finally {
    r.dispose();
  }
});
for (const [index, ramp] of RAMPS.entries())
  if (index > 0)
    test(`additional ramp ${index + 1} launches the car and permits a landing`, () => {
      const r = setup();
      try {
        const c = move(r, 'p0', ramp.s - ramp.length / 2 - 4, ramp.side, 0.55),
          a = trackAt(ramp.s);
        // Aim down the actual straight ramp; the road tangent before this curved section differs.
        const approach = a.p
          .clone()
          .addScaledVector(a.t, -ramp.length / 2 - 4)
          .addScaledVector(a.n, ramp.side);
        c.body.setTranslation({ ...approach, y: r.track.surfaceHeight(approach) + 0.69 }, true);
        c.body.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), a.yaw), true);
        move(r, 'p1', ramp.s + 20, -ramp.side);
        r.cameraProgress = ramp.s;
        c.body.setLinvel(a.t.clone().multiplyScalar(16), true);
        let highest = 0,
          landed = false;
        for (let i = 0; i < 180; i++) {
          run(r, 1);
          const p = c.body.translation(),
            y = p.y - r.track.surfaceHeight(p);
          highest = Math.max(highest, y);
          if (highest > ramp.height + 0.2 && y < 1.3) {
            landed = true;
            break;
          }
        }
        assert.ok(highest > ramp.height + 0.2, `highest ${highest}`);
        assert.equal(landed, true);
        assert.equal(c.alive, true);
      } finally {
        r.dispose();
      }
    });
