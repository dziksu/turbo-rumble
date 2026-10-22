import { cutTerrain } from './terrain.ts';
import { Vector3 } from 'three';

export const DESERT_GROUND_Y = -0.18;
export const DESERT_TERRAIN_SIZE = 640;
export const DESERT_BRIDGE_PLAN = [
  { u: 0.285, length: 66, name: 'CANYON VIADUCT' },
  { u: 0.735, length: 62, name: 'SUNDOWN CROSSING' },
] as const;
const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};
function district(u: number, start: number, end: number, fade = 0.025) {
  return smooth((u - start + fade) / fade) * smooth((end + fade - u) / fade);
}
export function desertRoadWidth(u: number) {
  const town = district(u, 0.025, 0.15),
    yard = district(u, 0.465, 0.57);
  const bridge = Math.max(
    ...DESERT_BRIDGE_PLAN.map((b) => district(u, b.u - 0.025, b.u + 0.025, 0.018)),
  );
  return 9 + town * 7 + yard * 8 + district(u, 0.865, 0.94) * 3 - bridge;
}
interface RoutePoint {
  p: Vector3;
  t: Vector3;
  n: Vector3;
  yaw: number;
  width: number;
}
export interface DesertObject {
  id: string;
  asset: string;
  position: Vector3;
  size: Vector3;
  yaw: number;
  solid: boolean;
}
export function createDesertLayout(length: number, sample: (s: number) => RoutePoint) {
  const bridges = DESERT_BRIDGE_PLAN.map((plan) => ({
    ...plan,
    s: plan.u * length,
    ...sample(plan.u * length),
  }));
  const atBridge = (s: number, margin = 0) =>
    bridges.some((bridge) => {
      const delta = ((s - bridge.s + length * 1.5) % length) - length / 2;
      return Math.abs(delta) < bridge.length / 2 + margin;
    });
  const objects: DesertObject[] = [];
  const houses = ['a', 'b', 'c', 'e', 'j', 'n', 'q', 's'];
  const blocks = [0.018, 0.045, 0.073, 0.101, 0.129, 0.157, 0.47, 0.5, 0.53, 0.56, 0.87, 0.9, 0.93];
  for (const [index, u] of blocks.entries())
    for (const side of [-1, 1]) {
      const at = sample(u * length),
        commercial = u > 0.46 && u < 0.58;
      const size = new Vector3(
        commercial ? 14 : 12,
        commercial ? 12 : 7.5 + (index % 3),
        commercial ? 12 : 10,
      );
      const position = at.p.clone().addScaledVector(at.n, side * (at.width + 6.5 + size.z / 2));
      position.y = DESERT_GROUND_Y;
      objects.push({
        id: `building-${index}-${side}`,
        asset: commercial
          ? `commercial/building-${['a', 'b', 'c', 'f'][index % 4]}`
          : `suburban/building-type-${houses[(index + (side > 0 ? 3 : 0)) % houses.length]}`,
        position,
        size,
        yaw: at.yaw - (side * Math.PI) / 2,
        solid: true,
      });
    }
  for (let i = 0; i < 30; i++) {
    const s = ((0.19 + i * 0.0237) % 1) * length;
    if (atBridge(s, 45)) continue;
    const at = sample(s),
      side = i % 2 ? 1 : -1;
    const position = at.p.clone().addScaledVector(at.n, side * (at.width + 9 + (i % 4) * 4));
    position.y = DESERT_GROUND_Y;
    objects.push({
      id: `rock-${i}`,
      asset: `nature/${i % 2 ? 'rock_tallA' : 'rock_tallB'}`,
      position,
      size: new Vector3(5 + (i % 4), 4 + (i % 5), 4 + (i % 3)),
      yaw: i * 2.399,
      solid: true,
    });
  }
  const fountain = sample(length * 0.087).p.clone();
  fountain.y = 0;
  const clearObjects = objects.filter((object, index) => {
    const radius = Math.hypot(object.size.x, object.size.z) / 2;
    for (let i = 0; i < 320; i++) {
      const at = sample((i / 320) * length);
      if (at.p.distanceTo(object.position) < at.width + radius + 2) return false;
    }
    return !objects
      .slice(0, index)
      .some(
        (other) =>
          other.position.distanceTo(object.position) <
          radius + Math.hypot(other.size.x, other.size.z) / 2 + 1,
      );
  });
  return { objects: clearObjects, bridges, atBridge, fountain };
}
export type DesertLayout = ReturnType<typeof createDesertLayout>;

export function desertTerrainGeometry(layout: DesertLayout) {
  return cutTerrain(
    layout.bridges.map((bridge) => ({ ...bridge, halfWidth: 92, halfLength: 19 })),
    DESERT_GROUND_Y,
    DESERT_TERRAIN_SIZE / 2,
  );
}
