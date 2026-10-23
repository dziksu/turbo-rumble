import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { Race, initPhysics } from '../shared/simulation.ts';
import { trackAt, roadGeometry, ROAD_WIDTH, projectOnTrack } from '../shared/track.ts';
import { ImpactShake, scorchGeometry } from '../client/race-effects.ts';
before(async () => {
  await initPhysics();
});
function setup(speed = 16) {
  const r = new Race(97);
  for (let i = 0; i < 2; i++)
    r.addDriver({
      id: 'p' + i,
      name: 'Drift ' + i,
      slot: i,
      bot: false,
      ready: true,
      connected: true,
      wins: 0,
    });
  r.start();
  r.phase = 'racing';
  // Drift recovery needs open runoff; the opening bend now has a solid cattle fence.
  const start = -100;
  r.cameraProgress = start;
  for (const [i, c] of [...r.cars.values()].entries()) {
    const a = trackAt(start + i * 20);
    c.progress = start + i * 20;
    c.weapon = null;
    c.invulnerableUntil = 10000;
    const p = a.p.clone().addScaledVector(a.n, i === 0 ? -3 : 0);
    c.body.setTranslation({ x: p.x, y: 0.55, z: p.z }, true);
    c.body.setRotation(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), a.yaw), true);
    c.body.setLinvel(a.t.clone().multiplyScalar(speed), true);
  }
  r.world.step();
  return r;
}
function run(r: Race, n: number, left = false, right = false) {
  for (let i = 0; i < n; i++) {
    for (const c of r.cars.values())
      r.input(c.id, {
        seq: c.input.seq + 1,
        left: c.id === 'p0' && left,
        right: c.id === 'p0' && right,
        actionSeq: 0,
      });
    r.step();
  }
}
const car = (r: Race) => r.snapshot('DRIFT').cars.find((c) => c.id === 'p0')!;
const angle = (v: number) => Math.atan2(Math.sin(v), Math.cos(v));
test('a fast car turns over one radian in 400 ms, with real sideways slip', () => {
  const r = setup();
  try {
    const start = car(r).yaw;
    run(r, 20, true);
    const c = car(r);
    assert.ok(angle(c.yaw - start) > 1.05);
    assert.ok(c.drift! > 0.7);
    assert.ok(Math.abs(c.slip!) > 0.2);
    assert.ok(c.speed > 8);
    assert.equal(c.alive, true);
  } finally {
    r.dispose();
  }
});
test('release recovers tyre grip while keeping the manually chosen heading', () => {
  const r = setup();
  try {
    run(r, 20, true);
    const before = car(r);
    run(r, 20);
    const after = car(r);
    assert.ok(Math.abs(after.slip!) < Math.abs(before.slip!) * 0.3);
    assert.ok(after.drift! < 0.03);
    assert.ok(Math.abs(angle(after.yaw - before.yaw)) < 0.22, 'bounded steering unwind');
    assert.ok(Math.abs(r.cars.get('p0')!.body.angvel().y) < 0.02);
    const settled = after.yaw;
    run(r, 10);
    assert.ok(Math.abs(angle(car(r).yaw - settled)) < 0.01, 'heading stays manual after unwind');
  } finally {
    r.dispose();
  }
});
test('countersteering rotates back and reduces the drift angle', () => {
  const r = setup();
  try {
    run(r, 20, true);
    const before = car(r);
    run(r, 8, false, true);
    const after = car(r);
    assert.ok(angle(after.yaw - before.yaw) < -0.15);
    assert.ok(Math.abs(after.slip!) < Math.abs(before.slip!));
    assert.ok(after.drift! < before.drift!);
  } finally {
    r.dispose();
  }
});
test('braking both directions slows the car and smoothly settles its yaw', () => {
  const r = setup();
  try {
    run(r, 20, true);
    const before = car(r);
    run(r, 30, true, true);
    const after = car(r);
    assert.ok(after.speed < before.speed * 0.35);
    assert.equal(after.drift, 0);
    assert.ok(Math.abs(angle(after.yaw - before.yaw)) < 0.22);
    assert.ok(Math.abs(r.cars.get('p0')!.body.angvel().y) < 0.02);
  } finally {
    r.dispose();
  }
});
test('airborne humans cannot accelerate or build a powered drift above the road', () => {
  const r = setup(0);
  try {
    const c = r.cars.get('p0')!,
      p = c.body.translation();
    c.body.setTranslation({ x: p.x, y: 5, z: p.z }, true);
    run(r, 8, true);
    const s = car(r);
    assert.equal(s.grounded, false);
    assert.equal(s.drift, 0);
    assert.ok(s.speed < 0.1);
  } finally {
    r.dispose();
  }
});
test('round placement resets steering and drift telemetry', () => {
  const r = setup();
  try {
    run(r, 20, true);
    assert.ok(car(r).drift! > 0.5);
    r.lobby();
    assert.equal(car(r).drift, 0);
    assert.equal(car(r).steering, 0);
  } finally {
    r.dispose();
  }
});

test('explosion shake is bounded, decays to zero and respects reduced motion', () => {
  const shake = new ImpactShake();
  for (let i = 0; i < 20; i++) shake.trigger();
  assert.equal(shake.pulses.length, 6);
  let moved = false;
  for (let i = 0; i < 40; i++) {
    const p = shake.sample(0.016);
    moved ||= Math.abs(p.x) + Math.abs(p.y) > 0;
    assert.ok(Math.abs(p.x) <= 0.25 && Math.abs(p.y) <= 0.18 && Math.abs(p.roll) <= 0.006);
  }
  assert.equal(moved, true);
  assert.deepEqual(shake.sample(0.016), { x: 0, y: 0, roll: 0 });
  shake.trigger();
  assert.deepEqual(shake.sample(0.016, true), { x: 0, y: 0, roll: 0 });
  shake.clear();
  shake.trigger(1, 100);
  assert.equal(shake.pulses.length, 0);
});
test('soot decals are clipped to variable-width asphalt edges', () => {
  const data = roadGeometry(ROAD_WIDTH, 0.02),
    geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.BufferAttribute(data.vertices, 3));
  geometry.setIndex(new T.BufferAttribute(data.indices, 1));
  const surface = new T.Mesh(geometry),
    a = trackAt(80),
    origin = a.p.clone().addScaledVector(a.n, a.width - 0.2),
    decal = scorchGeometry(surface, origin, 2);
  try {
    const p = decal.getAttribute('position');
    assert.ok(p.count > 0);
    for (let i = 0; i < p.count; i++) {
      const point = new T.Vector3(p.getX(i), p.getY(i), p.getZ(i));
      assert.ok(Math.abs(point.y - 0.02) < 0.001);
      assert.ok(projectOnTrack(point).distance < trackAt(projectOnTrack(point).s).width + 0.05);
    }
    const nowhere = scorchGeometry(surface, { x: 1000, y: 0, z: 1000 });
    assert.equal(nowhere.getAttribute('position').count, 0);
    nowhere.dispose();
  } finally {
    geometry.dispose();
    decal.dispose();
  }
});
