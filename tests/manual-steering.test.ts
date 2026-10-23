import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { Race, initPhysics } from '../shared/simulation.ts';
import { cameraPose, trackAt } from '../shared/track.ts';

before(async () => {
  await initPhysics();
});
function setup(s = 80, offset = 0) {
  const r = new Race(71);
  for (let i = 0; i < 2; i++)
    r.addDriver({
      id: 'p' + i,
      name: 'Manual ' + i,
      slot: i,
      bot: false,
      ready: true,
      connected: true,
      wins: 0,
    });
  r.start();
  r.phase = 'racing';
  r.roundStart = r.tick;
  r.cameraProgress = s;
  for (const [i, c] of [...r.cars.values()].entries()) {
    const a = trackAt(s + i * 20);
    c.progress = s + i * 20;
    c.weapon = null;
    c.invulnerableUntil = 10000;
    c.body.setTranslation({ x: a.p.x, y: a.p.y + 0.55, z: a.p.z }, true);
    c.body.setRotation(
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), a.yaw + (i === 0 ? offset : 0)),
      true,
    );
  }
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
function yaw(r: Race) {
  return r.snapshot('MANUAL').cars.find((c) => c.id === 'p0')!.yaw;
}
const angle = (v: number) => Math.atan2(Math.sin(v), Math.cos(v));

for (const s of [80, 250, 520, 740])
  for (const direction of ['left', 'right'] as const)
    test(`${direction} turns to the correct screen side at track metre ${s}`, () => {
      const r = setup(s);
      try {
        const c = r.cars.get('p0')!,
          a = trackAt(s),
          start = { ...c.body.translation() };
        c.body.setLinvel(a.t.clone().multiplyScalar(10), true);
        run(r, 20, direction === 'left', direction === 'right');
        const sign = direction === 'left' ? 1 : -1;
        assert.ok(angle(yaw(r) - a.yaw) * sign > 0.35, 'heading turns in the requested direction');
        const velocity = c.body.linvel();
        assert.ok(
          (velocity.x * a.n.x + velocity.z * a.n.z) * sign > 0.5,
          'actual velocity follows the turn',
        );
        const pose = cameraPose(s),
          camera = new PerspectiveCamera(55, 16 / 9, 0.1, 1000);
        camera.position.copy(pose.position);
        camera.lookAt(pose.target);
        camera.updateMatrixWorld();
        const origin = new Vector3(start.x, start.y, start.z),
          straight = origin.clone().addScaledVector(a.t, 3).project(camera);
        const turned = origin
          .clone()
          .add(new Vector3(Math.sin(yaw(r)) * 3, 0, Math.cos(yaw(r)) * 3))
          .project(camera);
        assert.ok(
          (turned.x - straight.x) * sign < -0.005,
          'rendered nose moves left for left, right for right',
        );
      } finally {
        r.dispose();
      }
    });
test('neutral human input retains an off-track heading and accelerates along the car, without a racing-line servo', () => {
  const r = setup(80, 0.4);
  try {
    const initial = yaw(r);
    run(r, 55);
    const c = r.cars.get('p0')!,
      v = c.body.linvel();
    assert.ok(Math.abs(angle(yaw(r) - initial)) < 0.01);
    assert.ok(Math.hypot(v.x, v.z) > 8);
    assert.ok(Math.abs(angle(Math.atan2(v.x, v.z) - initial)) < 0.02);
    assert.equal(c.alive, true);
  } finally {
    r.dispose();
  }
});
test('releasing steering stops the turn without straightening the car towards the track', () => {
  // Keep this steering-only fixture on the open straight, clear of the cattle fence.
  const r = setup(-100);
  try {
    run(r, 25, true);
    const released = yaw(r);
    run(r, 20);
    assert.ok(
      Math.abs(angle(yaw(r) - released)) < 0.22,
      'turn settles without snapping angular velocity',
    );
    const settled = yaw(r);
    run(r, 15);
    assert.ok(Math.abs(angle(yaw(r) - settled)) < 0.01);
    assert.ok(Math.abs(angle(yaw(r) - trackAt(r.cars.get('p0')!.progress).yaw)) > 0.1);
  } finally {
    r.dispose();
  }
});
test('rockets and frost launch from the actual nose, and mines drop behind the actual heading', () => {
  for (const kind of ['rocket', 'frost', 'mine'] as const) {
    const r = setup(80, 0.8);
    try {
      const c = r.cars.get('p0')!,
        p = c.body.translation(),
        heading = yaw(r),
        forward = new Vector3(Math.sin(heading), 0, Math.cos(heading));
      c.weapon = kind;
      r.useWeapon(c);
      const shot = r.shots[0],
        delta = new Vector3(shot.position.x - p.x, 0, shot.position.z - p.z);
      assert.ok(Math.abs(delta.dot(forward) - (kind === 'mine' ? -3.1 : 3.1)) < 0.001);
      assert.ok(Math.abs(angle(shot.yaw - heading)) < 0.001);
      if (kind !== 'mine')
        assert.ok(new Vector3().copy(shot.velocity).normalize().dot(forward) > 0.999);
    } finally {
      r.dispose();
    }
  }
});
