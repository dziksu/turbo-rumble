import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { Race, initPhysics } from '../shared/simulation.ts';
import { trackAt, TRACK_LENGTH, PICKUP_SPAWNS, RAMP, projectOnTrack } from '../shared/track.ts';
before(async () => {
  await initPhysics();
});
function setup(n = 2) {
  const r = new Race(83);
  for (let i = 0; i < n; i++)
    r.addDriver({
      id: 'p' + i,
      name: 'Driver ' + i,
      slot: i,
      bot: false,
      ready: true,
      connected: true,
      wins: 0,
    });
  r.start();
  r.phase = 'racing';
  r.roundStart = r.tick;
  for (const c of r.cars.values()) {
    c.weapon = null;
    c.invulnerableUntil = 100000;
  }
  return r;
}
function step(r: Race, n = 1) {
  for (let i = 0; i < n; i++) {
    for (const c of r.cars.values())
      r.input(c.id, { seq: c.input.seq + 1, left: false, right: false, actionSeq: 0 });
    r.step();
  }
}
function move(r: Race, id: string, s: number, side = 0, y = 0.7) {
  const c = r.cars.get(id)!,
    a = trackAt(s),
    p = a.p.clone().addScaledVector(a.n, side);
  c.progress = s;
  c.body.setTranslation({ x: p.x, y, z: p.z }, true);
  c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  c.body.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), a.yaw), true);
  return c;
}
for (const n of [3, 4, 8])
  test(`${n}-player scoring gives rank-dependent signed deltas`, () => {
    const r = setup(n);
    try {
      for (let i = n - 1; i >= 1; i--) {
        r.eliminate('p' + i, 'ordered test');
        step(r);
      }
      const expected = n === 3 ? [6, 5, 4] : n === 4 ? [7, 6, 4, 3] : [7, 6, 5, 5, 5, 5, 4, 3];
      assert.deepEqual(
        [...r.cars.values()].map((c) => c.score),
        expected,
      );
      assert.equal(r.phase, 'segment');
    } finally {
      r.dispose();
    }
  });
test('simultaneous last-place tie gives both players lower occupied rank', () => {
  const r = setup(4);
  try {
    r.eliminate('p2', 'tie');
    r.eliminate('p3', 'tie');
    step(r);
    r.eliminate('p1', 'second');
    step(r);
    assert.deepEqual(
      [...r.cars.values()].map((c) => c.score),
      [7, 6, 3, 3],
    );
  } finally {
    r.dispose();
  }
});
test('complete simultaneous eight-player wipe preserves scores', () => {
  const r = setup(8);
  try {
    for (const c of r.cars.values()) r.eliminate(c.id, 'wipe');
    step(r);
    assert.deepEqual(
      [...r.cars.values()].map((c) => c.score),
      Array(8).fill(5),
    );
  } finally {
    r.dispose();
  }
});
test('a real frost projectile hits, consumes its slot and leaves its victim alive', () => {
  const r = setup();
  try {
    const s = 60,
      a = move(r, 'p0', s),
      b = move(r, 'p1', s + 9);
    a.invulnerableUntil = b.invulnerableUntil = 0;
    r.cameraProgress = s;
    r.world.step();
    a.weapon = 'frost';
    r.useWeapon(a);
    assert.equal(a.weapon, null);
    for (let i = 0; i < 20 && !b.frostUntil; i++) {
      r.tick++;
      r.updateShots();
    }
    assert.ok(b.frostUntil > r.tick);
    assert.equal(b.alive, true);
    assert.equal(r.shots.length, 0);
    assert.ok(r.events.some((e) => e.type === 'frost'));
    assert.equal(b.frostUntil - r.tick, 80);
  } finally {
    r.dispose();
  }
});
test('pickup fills a single inventory slot and respawns after 250 ticks', () => {
  const r = setup();
  try {
    const pickup = PICKUP_SPAWNS[1],
      s = projectOnTrack(pickup.position).s,
      c = move(r, 'p0', s),
      d = move(r, 'p1', s + 14);
    r.cameraProgress = s;
    step(r);
    assert.ok(c.weapon);
    assert.equal(r.pickupUntil[pickup.id], r.tick + 250);
    const first = c.weapon;
    step(r);
    assert.equal(c.weapon, first);
    c.weapon = null;
    move(r, 'p0', s);
    step(r);
    assert.equal(c.weapon, null);
    r.tick = r.pickupUntil[pickup.id];
    move(r, 'p0', s);
    step(r);
    assert.ok(c.weapon);
    assert.equal(d.alive, true);
  } finally {
    r.dispose();
  }
});
test('camera timeout eliminates a lagging vehicle after its grace period', () => {
  const r = setup();
  try {
    const lag = move(r, 'p1', 40),
      lead = move(r, 'p0', 120);
    r.cameraProgress = 120;
    lag.invulnerableUntil = 0;
    for (let i = 0; i < 25; i++) {
      r.cameraProgress = 120;
      step(r);
      assert.equal(lag.alive, true);
    }
    r.cameraProgress = 120;
    step(r);
    assert.equal(lag.alive, false);
    assert.ok(r.events.some((e) => e.text?.includes('poza kadrem')));
    assert.equal(lead.score, 6);
  } finally {
    r.dispose();
  }
});
test('a fall below the track eliminates despite spawn protection', () => {
  const r = setup();
  try {
    const c = move(r, 'p1', 5, 0, -3.5);
    step(r);
    assert.equal(c.alive, false);
    assert.ok(r.events.some((e) => e.text?.includes('wypadnięcie z toru')));
  } finally {
    r.dispose();
  }
});
test('physical ramp elevates a car and it returns to the road', () => {
  const r = setup();
  try {
    const c = move(r, 'p0', RAMP.s - RAMP.length / 2 - 4, RAMP.side),
      a = trackAt(c.progress);
    move(r, 'p1', RAMP.s + 15, -3);
    r.cameraProgress = RAMP.s;
    c.body.setLinvel({ x: a.t.x * 16, y: 0, z: a.t.z * 16 }, true);
    let maxY = 0;
    for (let i = 0; i < 140; i++) {
      step(r);
      maxY = Math.max(maxY, c.body.translation().y);
    }
    assert.ok(maxY > 1.45, `highest y=${maxY}`);
    assert.ok(c.alive);
    assert.ok(c.body.translation().y < 1.3, `landing y=${c.body.translation().y}`);
  } finally {
    r.dispose();
  }
});
test('third lap terminates match and rematch clears all transient effects', () => {
  const r = setup(4);
  try {
    const c = move(r, 'p0', TRACK_LENGTH * 3 + 0.2);
    r.cameraProgress = c.progress;
    c.boostUntil = 5000;
    c.frostUntil = 5000;
    r.eliminate('p3', 'pre-finish');
    step(r);
    assert.equal(r.phase, 'finished');
    assert.equal(r.results.length, 4);
    r.start();
    assert.equal(r.phase, 'countdown');
    assert.equal(r.round, 1);
    assert.equal(r.results.length, 0);
    assert.equal(c.boostUntil, 0);
    assert.equal(c.frostUntil, 0);
    assert.equal(c.score, 5);
    assert.equal(c.alive, true);
    assert.equal(r.shots.length, 0);
    assert.ok(r.pickupUntil.every((t) => t === 0));
  } finally {
    r.dispose();
  }
});
test('pulse respects immunity and distance beyond its radius', () => {
  const r = setup(3);
  try {
    const a = move(r, 'p0', 60),
      b = move(r, 'p1', 60, 3),
      c = move(r, 'p2', 80);
    a.weapon = 'pulse';
    b.invulnerableUntil = 1000;
    c.invulnerableUntil = 0;
    r.useWeapon(a);
    const bV = b.body.linvel(),
      cV = c.body.linvel();
    assert.equal(Math.hypot(bV.x, bV.y, bV.z), 0);
    assert.equal(Math.hypot(cV.x, cV.y, cV.z), 0);
  } finally {
    r.dispose();
  }
});
test('nitro gives speed and progress benefits when used from rest', () => {
  const measurements: { speed: number; progress: number }[] = [];
  for (const boosted of [false, true]) {
    const r = setup();
    try {
      const c = move(r, 'p0', 60, -2, 0.55);
      move(r, 'p1', 60, 2, 0.55);
      r.cameraProgress = 60;
      if (boosted) {
        c.weapon = 'boost';
        r.useWeapon(c);
      }
      step(r, 60);
      const v = c.body.linvel();
      measurements.push({ speed: Math.hypot(v.x, v.z), progress: c.progress - 60 });
    } finally {
      r.dispose();
    }
  }
  assert.ok(
    measurements[1].speed > measurements[0].speed + 2,
    `plain=${JSON.stringify(measurements[0])}, nitro=${JSON.stringify(measurements[1])}`,
  );
  assert.ok(
    measurements[1].progress > measurements[0].progress + 1,
    `plain=${JSON.stringify(measurements[0])}, nitro=${JSON.stringify(measurements[1])}`,
  );
});
