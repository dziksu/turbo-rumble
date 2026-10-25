import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as T from 'three';
import { getTrack } from '../shared/track.ts';
import { addBiome } from '../client/biomes.ts';
import { createVolcanoLayout, CRATER_RADIUS } from '../client/volcano-layout.ts';
import { tropicalPlant } from '../client/volcano-models.ts';
import { disposeResources } from '../client/resources.ts';

test('Aloha vegetation leaves the original road, ramps, lava cuts and off-road approaches intact', () => {
  const track = getTrack('volcano');
  const original = JSON.stringify({
    biome: track.biome,
    ramps: track.RAMPS,
    gaps: track.GAPS,
    obstacles: track.OBSTACLES,
  });
  const layout = createVolcanoLayout(track);
  assert.equal(JSON.stringify(layout), JSON.stringify(createVolcanoLayout(track)));
  assert.ok(layout.trees.length > 350 && layout.trees.length < 650);
  assert.equal(new Set(layout.trees.map((p) => p.variant)).size, 3);
  assert.equal(layout.access.length, 24);
  for (const p of layout.trees) {
    assert.ok(layout.clearance(p.position) > 9.5);
    assert.equal(layout.inLava(p.position, 4.5), false);
    assert.equal(layout.inAccess(p.position, 4.5), false);
    assert.ok(p.position.distanceTo(track.OVERVIEW_CENTER) > CRATER_RADIUS + 7);
    assert.ok(Math.hypot(p.position.x, p.position.z) < 230.5);
  }
  const root = new T.Group(),
    scenery = addBiome(root, track, () => new T.Sprite(new T.SpriteMaterial()))!;
  assert.equal(
    JSON.stringify({
      biome: track.biome,
      ramps: track.RAMPS,
      gaps: track.GAPS,
      obstacles: track.OBSTACLES,
    }),
    original,
  );
  const ray = new T.Raycaster();
  root.updateWorldMatrix(true, true);
  for (const g of track.GAPS)
    for (const offset of [-15, 0, 15]) {
      const at = track.trackAt(g.s),
        p = at.p.clone().addScaledVector(at.n, offset).setY(1);
      ray.set(p, new T.Vector3(0, -1, 0));
      assert.equal(
        ray.intersectObject(scenery.ground).length,
        0,
        'visual ground retains every real lava hole',
      );
    }
  disposeResources([root]);
});

test('Aloha bounds total geometry, spatially instances prototypes and adds no shadow lights or full-screen effects', () => {
  const root = new T.Group();
  addBiome(root, getTrack('volcano'), () => new T.Sprite(new T.SpriteMaterial()));
  let meshes = 0,
    triangles = 0,
    transparent = 0,
    shaders = 0;
  const trees = new Map<string, { geometry: Set<T.BufferGeometry>; count: number }>();
  root.traverseVisible((node) => {
    assert.ok(!(node instanceof T.Light));
    if (node instanceof T.Mesh) {
      meshes++;
      triangles +=
        ((node.geometry.index?.count ?? node.geometry.getAttribute('position').count) / 3) *
        (node instanceof T.InstancedMesh ? node.count : 1);
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      if (materials.some((m) => m.transparent)) transparent++;
      if (materials.some((m) => m instanceof T.ShaderMaterial)) shaders++;
    }
    if (node instanceof T.InstancedMesh && node.name.startsWith('aloha-tree-')) {
      const species = trees.get(node.name) ?? { geometry: new Set<T.BufferGeometry>(), count: 0 };
      species.geometry.add(node.geometry);
      species.count += node.count;
      trees.set(node.name, species);
      assert.ok(node.castShadow && node.receiveShadow);
      assert.ok(node.boundingSphere && Number.isFinite(node.boundingSphere.radius));
    }
  });
  assert.ok(meshes < 210, `visible mesh budget ${meshes}`);
  assert.ok(triangles < 210000, `triangle budget ${triangles}`);
  assert.ok(transparent <= 6, `transparent mesh budget ${transparent}`);
  assert.equal(shaders, 2, 'one lava material on the crater pool and combined flows');
  assert.equal(trees.size, 3);
  for (const species of trees.values()) {
    assert.equal(species.geometry.size, 1);
    assert.ok(species.count > 50);
  }
  disposeResources([root]);
});

test('lava, steam, embers and surf follow snapshot time, freeze on pause and reduced motion, and reuse resources', () => {
  const root = new T.Group(),
    scenery = addBiome(root, getTrack('volcano'), () => new T.Sprite(new T.SpriteMaterial()))!,
    v = scenery.volcano!;
  const smoke = v.smoke.geometry.getAttribute('position'),
    embers = v.embers.geometry.getAttribute('position');
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>(),
    textures = new Set<T.Texture>(),
    instances = new Set<T.InstancedMesh>();
  let objects = 0;
  root.traverse((node) => {
    objects++;
    if (node instanceof T.InstancedMesh) instances.add(node);
    if (node instanceof T.Mesh || node instanceof T.Points) geometries.add(node.geometry);
    if (node instanceof T.Mesh || node instanceof T.Points || node instanceof T.Sprite)
      for (const m of Array.isArray(node.material) ? node.material : [node.material]) {
        materials.add(m);
        for (const item of Object.values(m)) if (item instanceof T.Texture) textures.add(item);
      }
  });
  const snapshot = () => ({
    lava: v.lava.uniforms.uTime.value,
    smoke: Array.from(smoke.array),
    embers: Array.from(embers.array),
    surf: v.surf.map((s) => s.scale.toArray()),
  });
  scenery.update(4, false);
  const four = snapshot();
  scenery.update(8, false);
  assert.notDeepEqual(snapshot(), four);
  scenery.update(4, false);
  assert.deepEqual(snapshot(), four, 'same server tick freezes all effects');
  scenery.update(0, true);
  const still = snapshot();
  for (let i = 0; i < 150; i++) scenery.update(i, true);
  assert.deepEqual(snapshot(), still);
  assert.equal(v.smoke.geometry.getAttribute('position'), smoke);
  assert.equal(v.embers.geometry.getAttribute('position'), embers);
  let after = 0;
  root.traverse(() => after++);
  assert.equal(after, objects);
  const disposals = new Map<object, number>();
  for (const resource of [...geometries, ...materials, ...textures, ...instances]) {
    disposals.set(resource, 0);
    const owned: { addEventListener(type: 'dispose', listener: () => void): void } = resource;
    owned.addEventListener('dispose', () => disposals.set(resource, disposals.get(resource)! + 1));
  }
  assert.equal(textures.size, 1, 'only one tiny smoke texture');
  disposeResources([root, root]);
  for (const count of disposals.values())
    assert.equal(count, 1, 'release every GPU owner exactly once');
});

test('tropical undergrowth has no coplanar ground leaves', () => {
  for (const flowers of [false, true]) {
    const g = tropicalPlant(flowers);
    g.computeBoundingBox();
    assert.ok(
      g.boundingBox!.min.y > 0.1,
      'leaf tips and stems clear the terrain before instance scaling',
    );
    g.dispose();
  }
});

test('the sandy shore meets the exact physical island boundary without a visible slit', () => {
  const track = getTrack('volcano'),
    root = new T.Group();
  addBiome(root, track, () => new T.Sprite(new T.SpriteMaterial()));
  const beach = root.getObjectByName('aloha-sandy-shore') as T.Mesh;
  const edge = beach.geometry.getAttribute('position'),
    terrain = track.biome!.terrain.vertices;
  let boundaryVertices = 0;
  for (let i = 0; i < edge.count; i++) {
    if (Math.abs(edge.getY(i) + 0.18) > 1e-5) continue;
    boundaryVertices++;
    let nearest = Infinity;
    for (let j = 0; j < terrain.length; j += 3)
      nearest = Math.min(
        nearest,
        Math.hypot(edge.getX(i) - terrain[j], edge.getZ(i) - terrain[j + 2]),
      );
    assert.ok(
      nearest < 0.0001,
      'shore vertices coincide with the actual island polygon, including lava cut endpoints',
    );
  }
  assert.ok(boundaryVertices > 100);
  disposeResources([root]);
});
