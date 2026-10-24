import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import * as T from 'three';
import { Race, initPhysics } from '../shared/simulation.ts';
import { ForestRiverScenery } from '../client/forest-river.ts';
import { forestFern } from '../client/forest-models.ts';
import { disposeResources } from '../client/resources.ts';

before(initPhysics);

test('one continuous meandering river has matching visible water, supported banks and open physics along every bend', () => {
  const race = new Race(127, { mapId: 'forest', lapLimit: 3, winningScore: 10 });
  const track = race.track,
    river = track.biome!.river!,
    data = track.biome!.terrain;
  const root = new T.Group();
  new ForestRiverScenery(root, river);
  const water = root.getObjectByName('timber-continuous-river') as T.Mesh;
  root.updateWorldMatrix(true, true);
  assert.ok(river.length > 700 && river.length < 1000);
  assert.ok(data.indices.length / 3 < 500, 'curved channel retains a compact physics mesh');
  let leftTurns = 0,
    rightTurns = 0;
  for (let i = 1; i < river.sections.length; i++) {
    const a = river.sections[i - 1],
      b = river.sections[i];
    assert.ok(a.p.distanceTo(b.p) < 5.5, 'no disconnected reaches');
    const turn = a.t.x * b.t.z - a.t.z * b.t.x;
    if (turn > 0.02) leftTurns++;
    if (turn < -0.02) rightTurns++;
  }
  assert.ok(leftTurns > 12 && rightTurns > 12, 'several bends in both directions');
  try {
    race.world.step();
    const ray = new T.Raycaster();
    for (const s of river.sections.slice(2, -2)) {
      for (const lane of [-0.65, 0, 0.65]) {
        const p = s.p.clone().addScaledVector(s.n, lane * s.halfWidth);
        assert.equal(
          race.world.castRay(new RAPIER.Ray({ ...p, y: 1 }, { x: 0, y: -1, z: 0 }), 3, true),
          null,
          'river has no invisible floor',
        );
        ray.set(p.clone().setY(1), new T.Vector3(0, -1, 0));
        assert.ok(ray.intersectObject(water).length > 0, 'visible water follows every hole');
      }
      for (const side of [-1, 1]) {
        const p = s.p.clone().addScaledVector(s.n, side * (s.halfWidth + 1.5));
        assert.ok(
          race.world.castRay(new RAPIER.Ray({ ...p, y: 1 }, { x: 0, y: -1, z: 0 }), 2, true),
          'both banks support off-road driving',
        );
      }
      const projected = track.projectOnTrack(s.p);
      if (projected.distance < track.trackAt(projected.s).width + s.halfWidth) {
        assert.ok(
          track.GAPS.some((g) => Math.abs(projected.s - g.s) < 16),
          'no new crossing outside existing jumps',
        );
      }
    }
  } finally {
    race.dispose();
    disposeResources([root]);
  }
});

test('fern leaf bases and tips stay above the forest floor to prevent coplanar flicker', () => {
  const g = forestFern();
  g.computeBoundingBox();
  assert.ok(g.boundingBox!.min.y >= 0.119, 'every leaf is lifted, including roots and outer tips');
  const normals = g.getAttribute('normal');
  for (let i = 0; i < normals.count; i++)
    assert.ok(normals.getY(i) > 0, 'leaves face the camera above the ground');
  g.dispose();
});

test('falling into a forest bend away from the road is treated as river water', () => {
  const race = new Race(31, { mapId: 'forest', lapLimit: 3, winningScore: 10 });
  for (let i = 0; i < 3; i++)
    race.addDriver({
      id: `p${i}`,
      name: `P${i}`,
      slot: i,
      bot: false,
      connected: true,
      ready: true,
      wins: 0,
    });
  race.start();
  race.phase = 'racing';
  race.roundStart = race.tick;
  const car = race.cars.get('p0')!,
    river = race.track.biome!.river!;
  const bend = river.sections.find((s) => Math.abs(s.p.z) < 3)!;
  const projected = race.track.projectOnTrack(bend.p);
  assert.ok(projected.distance > 40 && !race.track.isGap(projected.s));
  try {
    car.progress = projected.s;
    race.cameraProgress = car.progress;
    car.body.setTranslation({ ...bend.p, y: -1.1 }, true);
    race.step();
    assert.equal(car.alive, false);
    assert.ok(race.events.some((e) => e.type === 'elimination' && e.text?.includes('rzeka')));
  } finally {
    race.dispose();
  }
});
