import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Group, Mesh, BoxGeometry, MeshStandardMaterial, MeshPhysicalMaterial } from 'three';
import { WreckAppearance } from '../client/wreck-appearance.ts';
import { disposeResources } from '../client/resources.ts';

function fixture() {
  const root = new Group(),
    body = new Mesh(new BoxGeometry(), [
      new MeshStandardMaterial({ color: 'red' }),
      new MeshStandardMaterial({ color: 'black' }),
    ]),
    wheel = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  root.add(body, wheel);
  return { root, body, wheel };
}
test('ice coats the whole car, preserves source clones and restores exact materials without extra meshes', () => {
  const source = fixture(),
    root = source.root.clone(true),
    body = root.children[0] as Mesh,
    wheel = root.children[1] as Mesh;
  const appearance = new WreckAppearance(root, [wheel]),
    original = body.material,
    originalWheel = wheel.material,
    count = root.children.length;
  let sharedDisposals = 0;
  for (const material of source.body.material)
    material.addEventListener('dispose', () => sharedDisposals++);
  appearance.setFrozen(true);
  const ice = body.material;
  assert.ok(ice instanceof MeshPhysicalMaterial);
  assert.equal(wheel.material, ice);
  assert.ok(ice.color.b > ice.color.r);
  assert.ok(ice.roughness < 0.25);
  assert.equal(ice.clearcoat, 1);
  assert.equal(ice.transparent, false);
  assert.equal(ice.transmission, 0);
  assert.equal(root.children.length, count);
  assert.deepEqual(source.body.material, original);
  assert.notEqual(source.body.material, ice);
  assert.equal(wheel.visible, true);
  appearance.setFrozen(true);
  assert.equal(body.material, ice);
  appearance.setFrozen(false);
  assert.equal(body.material, original);
  assert.equal(wheel.material, originalWheel);
  appearance.setFrozen(true);
  assert.equal(body.material, ice, 'reuse the per-car ice material');
  let ownDisposals = 0;
  ice.addEventListener('dispose', () => ownDisposals++);
  appearance.dispose();
  appearance.dispose();
  disposeResources([root], [source.root]);
  assert.equal(ownDisposals, 1);
  assert.equal(sharedDisposals, 0);
  disposeResources([source.root]);
  assert.equal(sharedDisposals, 2);
});
test('burnt wreck takes priority over ice, including thaw, death and respawn transitions', () => {
  const { root, body, wheel } = fixture(),
    original = body.material,
    appearance = new WreckAppearance(root, [wheel]);
  appearance.setFrozen(true);
  const ice = body.material;
  appearance.setWrecked(true);
  const wreck = body.material;
  assert.notEqual(wreck, ice);
  assert.equal(wheel.visible, false);
  appearance.setFrozen(false);
  assert.equal(body.material, wreck);
  appearance.setFrozen(true);
  assert.equal(body.material, wreck);
  appearance.setWrecked(false);
  assert.equal(body.material, ice);
  assert.equal(wheel.visible, true);
  appearance.setFrozen(false);
  assert.equal(body.material, original);
  appearance.dispose();
  disposeResources([root]);
});
