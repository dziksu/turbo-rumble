import * as T from 'three';
import { NITRO_EXHAUST } from '../shared/rules.ts';

/** Local +Z is the nose. Flame length and server contact capsule share one configuration. */
export function createNitroExhaust() {
  const group = new T.Group();
  group.name = 'nitro-exhaust';
  group.visible = false;
  for (const [radius, length, color] of [
    [NITRO_EXHAUST.radius, NITRO_EXHAUST.length, '#ff9d46'],
    [NITRO_EXHAUST.radius * 0.56, NITRO_EXHAUST.length * 0.72, '#d9faff'],
  ] as const) {
    const mesh = new T.Mesh(
      new T.ConeGeometry(radius, length, 8),
      new T.MeshBasicMaterial({ color }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.z = -(NITRO_EXHAUST.rearOffset + length / 2);
    group.add(mesh);
  }
  return group;
}
