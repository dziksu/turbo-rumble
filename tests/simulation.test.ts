import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { Race, initPhysics } from '../shared/simulation.ts';
import { trackAt, TRACK_LENGTH, projectOnTrack } from '../shared/track.ts';

before(async () => {
  await initPhysics();
});
function setup(n = 2) {
  const race = new Race(42);
  for (let i = 0; i < n; i++)
    race.addDriver({
      id: 'p' + i,
      name: 'Gracz ' + i,
      slot: i,
      bot: false,
      ready: true,
      connected: true,
      wins: 0,
    });
  race.start();
  race.phase = 'racing';
  race.roundStart = race.tick;
  for (const c of race.cars.values()) {
    c.weapon = null;
    c.invulnerableUntil = 10000;
  }
  return race;
}
function run(r: Race, ticks: number, inputs: (i: number) => void = () => {}) {
  for (let i = 0; i < ticks; i++) {
    inputs(i);
    for (const c of r.cars.values())
      if (!c.bot && c.connected && c.lastInputTick < r.tick - 1)
        r.input(c.id, { seq: c.input.seq + 1, left: false, right: false, actionSeq: 0 });
    r.step();
  }
}
test('automatic throttle accelerates without any steering input', () => {
  const r = setup();
  try {
    run(r, 100);
    const c = r.cars.get('p0')!;
    assert.ok(c.progress > 10, `progress ${c.progress}`);
    assert.ok(c.body.translation().y > -1);
    assert.ok(Math.abs(projectOnTrack(c.body.translation(), c.progress).lateral) < 7);
  } finally {
    r.dispose();
  }
});
test('both directions brake rather than steer', () => {
  const r = setup();
  try {
    run(r, 140);
    const c = r.cars.get('p0')!,
      before = c.body.linvel();
    assert.ok(Math.hypot(before.x, before.z) > 10);
    run(r, 60, () =>
      r.input('p0', { seq: c.input.seq + 1, left: true, right: true, actionSeq: 0 }),
    );
    const after = c.body.linvel();
    assert.ok(Math.hypot(after.x, after.z) < 2.5);
  } finally {
    r.dispose();
  }
});
test('left and right create opposite lateral motion without car-to-car interference', () => {
  const lateral: number[] = [];
  for (const [left, right] of [
    [false, false],
    [true, false],
    [false, true],
  ]) {
    const r = setup();
    try {
      const a = r.cars.get('p0')!,
        b = r.cars.get('p1')!,
        far = trackAt(80),
        origin = { ...a.body.translation() },
        normal = trackAt(a.progress).n;
      b.progress = 80;
      b.body.setTranslation({ x: far.p.x, y: 0.65, z: far.p.z }, true);
      run(r, 30, () => r.input(a.id, { seq: a.input.seq + 1, left, right, actionSeq: 0 }));
      const p = a.body.translation();
      lateral.push((p.x - origin.x) * normal.x + (p.z - origin.z) * normal.z);
    } finally {
      r.dispose();
    }
  }
  assert.ok(lateral[1] > lateral[0] + 0.1);
  assert.ok(lateral[2] < lateral[0] - 0.1);
});
test('out-of-order or malformed input is rejected', () => {
  const r = setup();
  try {
    assert.equal(r.input('p0', { seq: 5, left: true, right: false, actionSeq: 0 }), true);
    assert.equal(r.input('p0', { seq: 4, left: false, right: true, actionSeq: 0 }), false);
    assert.equal(
      r.input('p0', { seq: 6, left: 'yes' as unknown as boolean, right: false, actionSeq: 0 }),
      false,
    );
    assert.equal(r.cars.get('p0')!.input.left, true);
  } finally {
    r.dispose();
  }
});
test('an action sequence cannot fire a second item twice', () => {
  const r = setup();
  try {
    const c = r.cars.get('p0')!;
    c.weapon = 'mine';
    r.input(c.id, { seq: 1, left: false, right: false, actionSeq: 1 });
    r.step();
    assert.equal(r.shots.length, 1);
    c.weapon = 'mine';
    r.input(c.id, { seq: 2, left: false, right: false, actionSeq: 1 });
    r.step();
    assert.equal(r.shots.length, 1);
    assert.equal(c.weapon, 'mine');
  } finally {
    r.dispose();
  }
});
test('two-player elimination awards +1 and -1 once', () => {
  const r = setup();
  try {
    r.eliminate('p1', 'test');
    r.eliminate('p1', 'duplicate');
    r.step();
    assert.equal(r.cars.get('p0')!.score, 6);
    assert.equal(r.cars.get('p1')!.score, 4);
    assert.equal(r.phase, 'segment');
    run(r, 20);
    assert.equal(r.cars.get('p0')!.score, 6);
  } finally {
    r.dispose();
  }
});
test('simultaneous complete wipe is a draw', () => {
  const r = setup();
  try {
    r.eliminate('p0', 'test');
    r.eliminate('p1', 'test');
    r.step();
    assert.equal(r.cars.get('p0')!.score, 5);
    assert.equal(r.cars.get('p1')!.score, 5);
  } finally {
    r.dispose();
  }
});
test('ten points finish the match, rematch resets race scores', () => {
  const r = setup();
  try {
    r.cars.get('p0')!.score = 9;
    r.eliminate('p1', 'test');
    r.step();
    assert.equal(r.phase, 'finished');
    assert.equal(r.results[0].id, 'p0');
    assert.equal(r.results[0].score, 10);
    r.start();
    assert.equal(r.phase, 'countdown');
    assert.equal(r.cars.get('p0')!.score, 5);
    assert.equal(r.cars.get('p0')!.wins, 1);
  } finally {
    r.dispose();
  }
});
test('rocket sweeps into a target and eliminates it', () => {
  const r = setup();
  try {
    const a = r.cars.get('p0')!,
      b = r.cars.get('p1')!,
      start = trackAt(60),
      target = trackAt(69);
    a.progress = 60;
    b.progress = 69;
    a.body.setTranslation({ x: start.p.x, y: 0.65, z: start.p.z }, true);
    b.body.setTranslation({ x: target.p.x, y: 0.65, z: target.p.z }, true);
    a.invulnerableUntil = 0;
    b.invulnerableUntil = 0;
    a.body.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), start.yaw), true);
    b.body.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), target.yaw), true);
    r.cameraProgress = 60;
    a.weapon = 'rocket';
    r.useWeapon(a);
    run(r, 25);
    assert.equal(b.alive, false);
    assert.ok(r.events.some((e) => e.type === 'explosion'));
  } finally {
    r.dispose();
  }
});
test('frost reduces target speed and expires on authoritative ticks', () => {
  const r = setup();
  try {
    const c = r.cars.get('p0')!;
    c.frostUntil = r.tick + 200;
    run(r, 120);
    const v = c.body.linvel();
    assert.ok(Math.hypot(v.x, v.z) < 12);
    assert.equal(r.snapshot('TEST22').cars[0].frozen, true);
    run(r, 90);
    assert.equal(r.snapshot('TEST22').cars[0].frozen, false);
  } finally {
    r.dispose();
  }
});
test('pulse gives nearby opponents a physical impulse', () => {
  const r = setup();
  try {
    const a = r.cars.get('p0')!,
      b = r.cars.get('p1')!;
    a.invulnerableUntil = 0;
    b.invulnerableUntil = 0;
    a.weapon = 'pulse';
    r.useWeapon(a);
    const velocity = b.body.linvel();
    assert.ok(Math.hypot(velocity.x, velocity.z) > 3);
    assert.ok(velocity.y > 0);
  } finally {
    r.dispose();
  }
});
test('boost raises actual driving speed and expires', () => {
  const r = setup();
  try {
    run(r, 110);
    const a = r.cars.get('p0')!,
      b = r.cars.get('p1')!;
    a.weapon = 'boost';
    r.useWeapon(a);
    run(r, 50);
    const va = a.body.linvel(),
      vb = b.body.linvel();
    assert.ok(Math.hypot(va.x, va.z) > Math.hypot(vb.x, vb.z) + 2);
    assert.equal(r.snapshot('TEST22').cars[0].boosted, true);
    run(r, 30);
    assert.equal(r.snapshot('TEST22').cars[0].boosted, false);
  } finally {
    r.dispose();
  }
});
test('a dropped mine immediately explodes on opponent contact', () => {
  const r = setup();
  try {
    const a = r.cars.get('p0')!,
      b = r.cars.get('p1')!,
      at = trackAt(60);
    a.progress = 60;
    b.progress = 57;
    a.body.setTranslation({ x: at.p.x, y: 0.65, z: at.p.z }, true);
    const behind = at.p.clone().addScaledVector(at.t, -3.1);
    b.body.setTranslation({ x: behind.x, y: 0.65, z: behind.z }, true);
    a.invulnerableUntil = 0;
    b.invulnerableUntil = 0;
    a.body.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), at.yaw), true);
    r.cameraProgress = 60;
    a.weapon = 'mine';
    r.useWeapon(a);
    assert.equal(r.shots[0].armed, true);
    r.world.propagateModifiedBodyPositionsToColliders();
    r.updateShots();
    assert.equal(r.shots.length, 0);
    assert.ok(r.pendingDeaths.has(b.id));
    r.step();
    assert.equal(b.alive, false);
    assert.ok(r.events.some((e) => e.type === 'explosion'));
  } finally {
    r.dispose();
  }
});
test('track projection handles lap wrap without inventing a whole lap', () => {
  const before = TRACK_LENGTH - 1,
    point = trackAt(0.7).p,
    projected = projectOnTrack(point, before);
  assert.ok(projected.delta > 0 && projected.delta < 3);
});
test('disconnected stale control is neutral and player is eventually eliminated', () => {
  const r = setup();
  try {
    r.input('p1', { seq: 2, left: true, right: false, actionSeq: 0 });
    r.setConnected('p1', false);
    assert.equal(r.cars.get('p1')!.input.left, false);
    run(r, 110);
    assert.ok(r.events.some((e) => e.text?.includes('utrata połączenia')));
  } finally {
    r.dispose();
  }
});
test('eight bots can complete a full match with finite state', () => {
  const r = new Race(2026);
  try {
    for (let i = 0; i < 8; i++)
      r.addDriver({
        id: 'bot' + i,
        name: 'Bot ' + i,
        slot: i,
        bot: true,
        ready: true,
        connected: true,
        wins: 0,
      });
    r.start();
    for (let i = 0; i < 12000 && r.phase !== 'finished'; i++) r.step();
    assert.equal(r.phase, 'finished');
    assert.equal(r.results.length, 8);
    assert.ok(r.results.every((p) => Number.isFinite(p.score) && p.score >= 0 && p.score <= 10));
    assert.equal(r.results[0].place, 1);
  } finally {
    r.dispose();
  }
});
