import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as T from 'three';
import { getTrack } from '../shared/track.ts';
import { createForestLayout } from '../client/forest-layout.ts';
import { addBiome } from '../client/biomes.ts';
import { bakeForestStatics } from '../client/forest-models.ts';
import { disposeResources } from '../client/resources.ts';

test('Timber Run keeps wide off-road access, open jumps and wildlife clearings', () => {
  const track = getTrack('forest');
  const before = JSON.stringify({ biome: track.biome, ramps: track.RAMPS, gaps: track.GAPS });
  const layout = createForestLayout(track);
  assert.equal(JSON.stringify(layout), JSON.stringify(createForestLayout(track)));
  assert.equal(
    JSON.stringify({ biome: track.biome, ramps: track.RAMPS, gaps: track.GAPS }),
    before,
  );
  assert.ok(layout.trees.length > 450 && layout.trees.length < 900);
  assert.equal(new Set(layout.trees.map((p) => p.variant)).size, 3);
  assert.equal(layout.access.length, 24);
  for (const a of layout.access) {
    assert.ok(a.halfWidth * 2 >= 14 && a.length >= 52);
  }
  for (const tree of layout.trees) {
    assert.ok(layout.clearance(tree.position) > 10.5);
    assert.equal(layout.inAccess(tree.position, 3.5), false);
    assert.equal(layout.inRiver(tree.position, 3.5), false);
    for (const c of layout.clearings) assert.ok(c.distanceTo(tree.position) >= 16);
  }
  for (const p of layout.rocks) {
    assert.ok(layout.clearance(p.position) > p.scale * 1.05 + 3);
    assert.equal(layout.inAccess(p.position, p.scale * 1.05), false);
  }
  for (const p of layout.logs) {
    assert.ok(layout.clearance(p.position) > p.scale * 3 + 4);
    assert.equal(layout.inAccess(p.position, p.scale * 3), false);
  }
  assert.equal(layout.clearings.length, 4);
  assert.equal(layout.deer.length, 12);
  assert.equal(layout.foxes.length, 4);
  for (const animal of [...layout.deer, ...layout.foxes]) {
    assert.ok(layout.clearance(animal.position) > 10);
    assert.equal(layout.inRiver(animal.position, 2), false);
  }
});

test('forest scenery batches geometry, reuses animation buffers, and releases all GPU owners once', () => {
  const root = new T.Group();
  const scenery = addBiome(root, getTrack('forest'), () => new T.Sprite(new T.SpriteMaterial()))!;
  const forest = scenery.forest!;
  let visibleMeshes = 0,
    triangles = 0;
  root.traverseVisible((node) => {
    if (node instanceof T.Mesh) {
      visibleMeshes++;
      triangles +=
        ((node.geometry.index?.count ?? node.geometry.getAttribute('position').count) / 3) *
        (node instanceof T.InstancedMesh ? node.count : 1);
    }
    assert.ok(!(node instanceof T.PointLight) && !(node instanceof T.SpotLight));
  });
  assert.ok(visibleMeshes < 280, `mesh budget: ${visibleMeshes}`);
  assert.ok(triangles < 280000, `triangle budget: ${triangles}`);
  for (let species = 0; species < 3; species++) {
    const geometries = new Set<T.BufferGeometry>();
    let count = 0;
    root.traverseVisible((node) => {
      if (node instanceof T.InstancedMesh && node.name === `timber-tree-${species}`) {
        geometries.add(node.geometry);
        count += node.count;
        assert.ok(node.castShadow && node.receiveShadow);
      }
    });
    assert.equal(geometries.size, 1);
    assert.ok(count > 30);
  }
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
        for (const v of Object.values(m)) if (v instanceof T.Texture) textures.add(v);
      }
  });
  const pollen = forest.motes.geometry.getAttribute('position');
  const head = forest.heads[0].mesh.instanceMatrix;
  scenery.update(3, false);
  const headAtThree = Array.from(head.array),
    pollenAtThree = Array.from(pollen.array);
  scenery.update(7, false);
  assert.notDeepEqual(Array.from(head.array), headAtThree);
  assert.notDeepEqual(Array.from(pollen.array), pollenAtThree);
  scenery.update(3, false);
  assert.deepEqual(Array.from(head.array), headAtThree);
  assert.deepEqual(Array.from(pollen.array), pollenAtThree);
  scenery.update(0, true);
  const still = Array.from(head.array),
    stillPollen = Array.from(pollen.array);
  for (let i = 0; i < 100; i++) scenery.update(i, true);
  assert.deepEqual(Array.from(head.array), still);
  assert.deepEqual(Array.from(pollen.array), stillPollen);
  assert.equal(forest.motes.geometry.getAttribute('position'), pollen);
  assert.equal(forest.heads[0].mesh.instanceMatrix, head);
  let afterObjects = 0;
  root.traverse(() => afterObjects++);
  assert.equal(afterObjects, objects);
  const counts = new Map<object, number>();
  for (const resource of [...geometries, ...materials, ...textures, ...instances]) {
    counts.set(resource, 0);
    const disposable: { addEventListener(type: 'dispose', listener: () => void): void } = resource;
    disposable.addEventListener('dispose', () => counts.set(resource, counts.get(resource)! + 1));
  }
  assert.ok(textures.size > 0, 'mist texture participates in scene ownership');
  disposeResources([root, root]);
  for (const [resource, count] of counts)
    assert.equal(count, 1, `resource disposed once: ${resource.constructor.name}`);
});

test('static batching preserves nested transforms and skips moving components', () => {
  const root = new T.Group(),
    group = new T.Group();
  root.position.set(20, 1, -10);
  root.rotation.y = 0.5;
  group.position.set(-8, 3, 12);
  group.rotation.y = -0.8;
  root.add(group);
  const source = new T.Mesh(
    new T.BoxGeometry(2, 4, 6),
    new T.MeshStandardMaterial({ color: '#54835a', roughness: 0.9 }),
  );
  source.position.set(3, 2, -1);
  source.castShadow = true;
  group.add(source);
  const dynamic = new T.Group();
  dynamic.userData.forestDynamic = true;
  const wheel = source.clone();
  dynamic.add(wheel);
  root.add(dynamic);
  root.updateWorldMatrix(true, true);
  const originalBounds = new T.Box3().setFromObject(source, true);
  assert.equal(bakeForestStatics(root), 1);
  root.updateWorldMatrix(true, true);
  const baked = root.getObjectByName('forest-baked-landmark') as T.Mesh;
  const bakedBounds = new T.Box3().setFromObject(baked, true);
  assert.ok(originalBounds.min.distanceTo(bakedBounds.min) < 1e-5);
  assert.ok(originalBounds.max.distanceTo(bakedBounds.max) < 1e-5);
  assert.equal(wheel.parent, dynamic);
  assert.ok(dynamic.visible && wheel.visible && baked.castShadow);
  assert.equal(source.parent?.visible, false);
  disposeResources([root]);
});

test('disposing map instances also releases pollen while retaining shared source assets', () => {
  const geometry = new T.BoxGeometry(),
    material = new T.MeshStandardMaterial();
  const source = new T.Mesh(geometry, material),
    root = new T.Group();
  const batch = new T.InstancedMesh(geometry, material, 5);
  const pollenGeometry = new T.BufferGeometry(),
    pollenMaterial = new T.PointsMaterial();
  root.add(batch, new T.Points(pollenGeometry, pollenMaterial));
  let instanceDisposals = 0,
    pollenDisposals = 0,
    sourceDisposals = 0;
  batch.addEventListener('dispose', () => instanceDisposals++);
  pollenGeometry.addEventListener('dispose', () => pollenDisposals++);
  geometry.addEventListener('dispose', () => sourceDisposals++);
  disposeResources([root], [source]);
  assert.equal(instanceDisposals, 1);
  assert.equal(pollenDisposals, 1);
  assert.equal(sourceDisposals, 0);
  disposeResources([source]);
  assert.equal(sourceDisposals, 1);
});
