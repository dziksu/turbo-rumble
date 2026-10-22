import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as T from 'three';
import { syncPickupVisuals } from '../client/pickup-visuals.ts';
import { getTrack } from '../shared/track.ts';
import type { MapId } from '../shared/maps.ts';

test('switching desert, forest and volcano keeps every visible crystal at the authoritative position', () => {
  const scene = new T.Scene(),
    visuals = new Map<number, T.Group>();
  try {
    for (const map of ['desert', 'forest', 'volcano', 'desert'] satisfies MapId[]) {
      const pickups = getTrack(map).PICKUP_SPAWNS.map((p) => ({ ...p, active: true }));
      syncPickupVisuals(scene, visuals, pickups);
      assert.equal(visuals.size, pickups.length);
      assert.equal(scene.children.length, pickups.length);
      for (const pickup of pickups) {
        const group = visuals.get(pickup.id)!;
        assert.deepEqual(
          group.position.toArray(),
          [pickup.position.x, pickup.position.y, pickup.position.z],
          `${map} crystal ${pickup.id}`,
        );
        assert.equal(group.visible, true);
      }
    }
  } finally {
    syncPickupVisuals(scene, visuals, []);
  }
});
test('snapshots hide collected crystals, show respawns and free removed crystals without stale ghosts', () => {
  const scene = new T.Scene(),
    visuals = new Map<number, T.Group>();
  const pickup = (id: number, x: number, active = true) => ({
    id,
    position: { x, y: 1.15, z: 0 },
    active,
  });
  syncPickupVisuals(scene, visuals, [pickup(1, 10), pickup(2, 20)]);
  const removed = visuals.get(1)!,
    retained = visuals.get(2)!;
  let disposals = 0;
  (removed.children[0] as T.Mesh).geometry.addEventListener('dispose', () => disposals++);
  syncPickupVisuals(scene, visuals, [pickup(2, 80, false), pickup(3, 90)]);
  assert.equal(disposals, 1);
  assert.equal(removed.parent, null);
  assert.equal(visuals.has(1), false);
  assert.equal(visuals.get(2), retained);
  assert.equal(retained.position.x, 80);
  assert.equal(retained.visible, false);
  syncPickupVisuals(scene, visuals, [pickup(2, 80)]);
  assert.equal(retained.visible, true);
  assert.equal(visuals.size, 1);
  syncPickupVisuals(scene, visuals, []);
  assert.equal(scene.children.length, 0);
  assert.equal(visuals.size, 0);
});
