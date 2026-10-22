import * as T from 'three';
import type { PickupState } from '../shared/types.ts';
import { PICKUP_RADIUS } from '../shared/rules.ts';
import { disposeResources } from './resources.ts';

/** Every snapshot owns collectible positions, including IDs reused by another map. */
export function syncPickupVisuals(
  scene: T.Scene,
  visuals: Map<number, T.Group>,
  pickups: readonly PickupState[],
) {
  const activeIds = new Set<number>();
  for (const pickup of pickups) {
    activeIds.add(pickup.id);
    let group = visuals.get(pickup.id);
    if (!group) {
      group = new T.Group();
      const core = new T.Mesh(
        new T.OctahedronGeometry(PICKUP_RADIUS),
        new T.MeshStandardMaterial({
          color: '#ffcc5d',
          emissive: '#b86d0a',
          emissiveIntensity: 0.45,
          metalness: 0.25,
          roughness: 0.4,
        }),
      );
      const ring = new T.Mesh(
        new T.TorusGeometry(PICKUP_RADIUS + 0.23, 0.05, 6, 24),
        new T.MeshStandardMaterial({ color: '#fff3ba', roughness: 0.8 }),
      );
      ring.rotation.x = Math.PI / 2;
      group.add(core, ring);
      visuals.set(pickup.id, group);
      scene.add(group);
    }
    group.position.copy(pickup.position);
    group.visible = pickup.active;
  }
  for (const [id, group] of visuals) {
    if (activeIds.has(id)) continue;
    scene.remove(group);
    disposeResources([group]);
    visuals.delete(id);
  }
}
