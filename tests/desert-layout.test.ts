import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { before, test } from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import { Box3, Quaternion, Vector3, Group, Sprite, Mesh } from 'three';
import { Race, initPhysics } from '../shared/simulation.ts';
import { getTrack } from '../shared/track.ts';
import { DESERT_GROUND_Y } from '../shared/desert-layout.ts';
import { addDesertTerrain, desertAssetMatrix } from '../client/desert-scenery.ts';
import { disposeResources } from '../client/resources.ts';

before(initPhysics);
const track = getTrack();
const down = { x: 0, y: -1, z: 0 };
function fixture(s: number, lane = 0, bot = false) {
  const race = new Race(751);
  for (let slot = 0; slot < 3; slot++)
    race.addDriver({
      id: `p${slot}`,
      name: `Desert ${slot}`,
      slot,
      bot,
      connected: true,
      ready: true,
      wins: 0,
    });
  race.start();
  race.phase = 'racing';
  race.roundStart = race.tick;
  for (const [index, car] of [...race.cars.values()].entries()) {
    const at = track.trackAt(s + index * 8),
      p = at.p.clone().addScaledVector(at.n, index === 0 ? lane : index === 1 ? -3 : 3);
    car.progress = s + index * 8;
    car.body.setTranslation({ ...p, y: track.surfaceHeight(p) + 0.6 }, true);
    car.body.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), at.yaw), true);
    car.body.setLinvel(at.t.clone().multiplyScalar(22), true);
    car.invulnerableUntil = 100000;
    car.weapon = null;
  }
  race.cameraProgress = s - 4;
  race.world.step();
  return race;
}
function drive(race: Race) {
  for (const car of race.cars.values()) {
    car.weapon = null;
    race.input(car.id, { seq: car.input.seq + 1, left: false, right: false, actionSeq: 0 });
  }
  race.cameraProgress = race.cars.get('p0')!.progress - 4;
  race.step();
}

test('reference layout has a long start straight, five districts, raised switchbacks and economical exact terrain', () => {
  assert.equal(track.TRACK_NAME, 'Sundown Junction');
  assert.ok(track.TRACK_LENGTH > 1500 && track.TRACK_LENGTH < 1700);
  assert.ok(track.trackAt(50).t.x > 0.99);
  assert.equal(track.desert!.landmarks.length, 5);
  assert.ok(track.desert!.buildings.length >= 12);
  assert.ok(track.desert!.landforms.length >= 48);
  assert.equal(track.GAPS.length, 1);
  assert.equal(track.RAMPS.length, 4);
  const heights = Array.from(
    { length: 200 },
    (_, i) => track.trackAt((i / 200) * track.TRACK_LENGTH).p.y,
  );
  assert.ok(Math.max(...heights) >= 9 && Math.min(...heights) === 0);
  assert.ok(track.terrainGeometry()!.indices.length / 3 < 200);
  for (let s = 0; s < track.TRACK_LENGTH; s += 4) {
    const a = track.trackAt(s),
      b = track.trackAt(s + 1);
    assert.ok(Math.abs(a.p.y - b.p.y) < 0.14, 'gentle drivable grades');
    assert.ok(a.width >= 7 && a.width <= 9);
  }
});

test('road, raised shoulders and town fixtures agree with authoritative height', () => {
  const race = fixture(20);
  try {
    for (const u of [0.04, 0.26, 0.33, 0.44, 0.58, 0.76, 0.9])
      for (const lane of [-11, 0, 11]) {
        const at = track.trackAt(u * track.TRACK_LENGTH),
          p = at.p.clone().addScaledVector(at.n, lane),
          y = track.surfaceHeight(p);
        const hit = race.world.castRay(
          new RAPIER.Ray({ ...p, y: y + 2 }, down),
          3,
          true,
          RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC,
        );
        assert.ok(hit, `ground at ${u}/${lane}`);
        assert.ok(
          Math.abs(2 - hit.timeOfImpact - (Math.abs(lane) > at.width + 1 ? DESERT_GROUND_Y : 0)) <
            0.06,
          `ground mismatch ${u}/${lane}: ${2 - hit.timeOfImpact}`,
        );
      }
    for (const b of track.desert!.buildings) {
      assert.ok(
        race.world.castRay(
          new RAPIER.Ray({ ...b.position, y: b.position.y + b.size.y + 1 }, down),
          2,
          true,
        ),
      );
    }
    for (const car of race.cars.values()) {
      race.place(car, track.TRACK_LENGTH * 0.31);
      const p = car.body.translation();
      assert.ok(p.y > 7, 'respawn follows plateau instead of burying cars');
      assert.equal(
        race.world.intersectionWithShape(
          p,
          car.body.rotation(),
          car.body.collider(0).shape,
          RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC,
        ),
        null,
      );
    }
  } finally {
    race.dispose();
  }
});

test('closed cattle pen blocks opening-bend shortcuts while preserving the full road width', () => {
  const layout = track.desert!,
    fence = layout.corral.fence;
  for (const [i, panel] of fence.entries()) {
    assert.ok(
      panel.b.distanceTo(fence[(i + 1) % fence.length].a) < 1e-6,
      'no open fence endpoints',
    );
    assert.ok(layout.clearance(panel.a) > 2.6, 'fence remains outside the usable shoulder');
  }
  for (const cow of layout.corral.cattle) assert.ok(layout.inCorral(cow.position));
  const race = fixture(20);
  try {
    for (const s of [0, 80, 140, 180, 220, 245]) {
      const at = track.trackAt(s),
        edge = at.p.clone().addScaledVector(at.n, at.width);
      const hit = race.world.castRay(
        new RAPIER.Ray({ ...edge, y: 0.8 }, at.n),
        6,
        true,
        RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC,
      );
      assert.ok(hit && hit.timeOfImpact > 2.5 && hit.timeOfImpact < 3.4, `solid fence at ${s}`);
      assert.equal(
        race.world.castRay(
          new RAPIER.Ray({ ...at.p, y: 0.8 }, at.n),
          at.width,
          true,
          RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC,
        ),
        null,
        `clear racing lane at ${s}`,
      );
    }
  } finally {
    race.dispose();
  }
});

for (const s of [80, 175, 225])
  test(`a car cannot drive through the corral fence at ${s} m`, () => {
    const race = fixture(s, 5),
      car = race.cars.get('p0')!,
      at = track.trackAt(s);
    try {
      for (const body of race.obstacleBodies.values()) body.setEnabled(false);
      car.body.setRotation(
        new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(at.n.x, at.n.z)),
        true,
      );
      car.body.setLinvel(at.n.clone().multiplyScalar(30), true);
      for (let i = 0; i < 45; i++) {
        race.world.step();
        const p = car.body.translation();
        assert.ok(
          new Vector3(p.x, 0, p.z).sub(at.p).dot(at.n) < at.width + 3,
          'car stays outside the cattle pen',
        );
      }
    } finally {
      race.dispose();
    }
  });

test('ravine is a true hole in both road and terrain, with supported banks', () => {
  const race = fixture(20),
    gap = track.GAPS[0];
  try {
    for (const lane of [-20, -4, 0, 4, 20]) {
      const at = track.trackAt(gap.s),
        p = at.p.addScaledVector(at.n, lane);
      assert.equal(race.world.castRay(new RAPIER.Ray({ ...p, y: 1 }, down), 7, true), null);
    }
    for (const offset of [-30, 25]) {
      const p = track.trackAt(gap.s + offset).p;
      assert.ok(race.world.castRay(new RAPIER.Ray({ ...p, y: 2 }, down), 3, true));
    }
  } finally {
    race.dispose();
  }
});

for (const lane of [-4, 0, 4])
  test(`normal throttle clears the canyon and lands in lane ${lane}`, () => {
    const gap = track.GAPS[0],
      ramp = track.RAMPS[0],
      start = ramp.s - ramp.length / 2 - 7;
    const race = fixture(start, lane),
      car = race.cars.get('p0')!;
    try {
      for (const body of race.obstacleBodies.values()) body.setEnabled(false);
      let peak = 0,
        landed = false;
      for (let tick = 0; tick < 220; tick++) {
        drive(race);
        const p = car.body.translation();
        peak = Math.max(peak, p.y);
        if (car.progress > gap.s + gap.length / 2 + 5 && p.y > 0.35 && p.y < 0.9 && car.grounded) {
          landed = true;
          break;
        }
        if (!car.alive) break;
      }
      assert.ok(peak > 3.9, `launch peak ${peak}`);
      assert.ok(
        landed,
        `progress=${car.progress}, y=${car.body.translation().y}, alive=${car.alive}`,
      );
    } finally {
      race.dispose();
    }
  });

test('falling into the ravine eliminates and elevated crystals can actually be collected', () => {
  const race = fixture(track.GAPS[0].s),
    car = race.cars.get('p0')!;
  try {
    car.body.setTranslation({ ...track.trackAt(track.GAPS[0].s).p, y: -1.1 }, true);
    race.step();
    assert.equal(car.alive, false);
    assert.ok(race.events.some((e) => e.type === 'elimination' && e.text?.includes('wąwóz')));
  } finally {
    race.dispose();
  }
  const crystal = track.PICKUP_SPAWNS.find((p) => p.position.y > 9 && p.id % 3 === 1)!;
  const r = fixture(track.projectOnTrack(crystal.position).s),
    c = r.cars.get('p0')!;
  try {
    c.body.setTranslation({ ...crystal.position, y: crystal.position.y - 0.5 }, true);
    c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    r.step();
    assert.ok(c.weapon);
    assert.ok(r.pickupUntil[crystal.id] > r.tick);
  } finally {
    r.dispose();
  }
});

test('downloaded CC0 models have local dependencies and match declared obstacle bounds', () => {
  for (const object of track.desert!.objects) {
    const file = new URL(`../public/assets/desert/${object.asset}.glb`, import.meta.url);
    assert.ok(existsSync(file));
    const b = readFileSync(file),
      gltf = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
    for (const image of gltf.images ?? [])
      if (image.uri && !image.uri.startsWith('data:'))
        assert.ok(existsSync(new URL(image.uri, file)));
    const bounds = new Box3(new Vector3(-1, -0.2, -2), new Vector3(2, 3, 2));
    const fitted = bounds.clone().applyMatrix4(desertAssetMatrix(bounds, { ...object, yaw: 0 }));
    assert.ok(fitted.getSize(new Vector3()).distanceTo(object.size) < 1e-6);
    assert.ok(Math.abs(fitted.min.y - object.position.y) < 1e-6);
  }
  assert.match(
    readFileSync(new URL('../public/assets/desert/nature/LICENSE.txt', import.meta.url), 'utf8'),
    /CC0/i,
  );
});

test('village geometry bakes successfully and stays under a fixed scenery draw budget', () => {
  const root = new Group();
  try {
    addDesertTerrain(root, track, () => new Sprite());
    let draws = 0,
      triangles = 0;
    root.traverse((n) => {
      if (n instanceof Mesh) {
        draws++;
        triangles += (n.geometry.index?.count ?? n.geometry.getAttribute('position').count) / 3;
      }
    });
    assert.ok(draws < 150, `${draws} static scenery batches`);
    assert.ok(triangles < 45000, `${triangles} base triangles`);
    assert.ok(root.children.some((n) => n.name === 'sundown-baked-scenery'));
  } finally {
    disposeResources([root]);
  }
});

test('a bot drives an entire canyon lap using normal vehicle physics, grades and the jump', () => {
  const race = fixture(20, 0, true),
    car = race.cars.get('p0')!;
  try {
    for (const body of race.obstacleBodies.values()) body.setEnabled(false);
    for (let tick = 0; tick < 5000 && car.progress < track.TRACK_LENGTH + 20; tick++) {
      race.roundStart = race.tick;
      drive(race);
      assert.equal(car.alive, true, `lap traversal at ${car.progress}`);
    }
    assert.ok(car.progress >= track.TRACK_LENGTH + 20, `completed distance ${car.progress}`);
  } finally {
    race.dispose();
  }
});
