import { cutTerrain } from './terrain.ts';
import { Vector3 } from 'three';

export const DESERT_GROUND_Y = -0.18;
export const DESERT_TERRAIN_SIZE = 640;
export const DESERT_JUMP_U = 0.192;
export const DESERT_TOWN_U = 0.79;
export const CORRAL_FENCE_HEIGHT = 2.2;
// The same piecewise planar elevation is used by the road, dirt and Rapier.
const HEIGHTS = [0, 0, 1.2, 3.8, 6.5, 8, 9, 9, 8, 7, 7];
export function desertElevation(z: number) {
  const f = Math.max(0, Math.min(HEIGHTS.length - 1, (20 - z) / 20));
  const i = Math.min(HEIGHTS.length - 2, Math.floor(f));
  return HEIGHTS[i] + (HEIGHTS[i + 1] - HEIGHTS[i]) * (f - i);
}
const smooth = (v: number) => {
  const t = Math.max(0, Math.min(1, v));
  return t * t * (3 - 2 * t);
};
export function desertRoadWidth(u: number) {
  const town = smooth((u - 0.735) / 0.025) * smooth((0.86 - u) / 0.025);
  return 7 + town * 2;
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
export interface DesertBuilding {
  id: string;
  kind: 'saloon' | 'store' | 'church' | 'shed' | 'station';
  position: Vector3;
  size: Vector3;
  yaw: number;
}
export function createDesertLayout(length: number, sample: (s: number) => RoutePoint) {
  const route = Array.from({ length: 800 }, (_, i) => sample((i / 800) * length));
  const clearance = (p: Vector3) =>
    Math.min(...route.map((at) => Math.hypot(at.p.x - p.x, at.p.z - p.z) - at.width));
  const jump = { s: DESERT_JUMP_U * length, length: 8, ...sample(DESERT_JUMP_U * length) };
  const cuts = [
    { ...jump, halfWidth: 46, halfLength: jump.length / 2 + 0.08 },
    // The narrow racing jump opens into a long fault between the canyon hairpin's arms.
    {
      ...jump,
      p: new Vector3(120, 0, -58),
      t: new Vector3(0, 0, 1),
      n: new Vector3(1, 0, 0),
      yaw: 0,
      width: 0,
      halfWidth: 8,
      halfLength: 55,
    },
    {
      ...jump,
      p: new Vector3(120, 0, 3),
      t: new Vector3(0, 0, 1),
      n: new Vector3(1, 0, 0),
      yaw: 0,
      width: 0,
      halfWidth: 8,
      halfLength: 8,
    },
  ];
  const inCanyon = (p: Vector3, margin = 0) =>
    cuts.some((cut) => {
      const dx = p.x - cut.p.x,
        dz = p.z - cut.p.z;
      return (
        Math.abs(dx * cut.n.x + dz * cut.n.z) < cut.halfWidth + margin &&
        Math.abs(dx * cut.t.x + dz * cut.t.z) < cut.halfLength + margin
      );
    });
  const buildings: DesertBuilding[] = [];
  const kinds = ['saloon', 'store', 'shed', 'church', 'station'] as const;
  for (const [index, u] of [0.725, 0.748, 0.77, 0.795, 0.82, 0.845, 0.87, 0.9, 0.965].entries())
    for (const side of [-1, 1]) {
      const at = sample(u * length);
      const size = new Vector3(10 + (index % 3) * 2, 6 + (index % 3), 9);
      const position = at.p.clone().addScaledVector(at.n, side * (at.width + 9 + size.z / 2));
      position.y = desertElevation(position.z) + DESERT_GROUND_Y;
      if (clearance(position) < Math.hypot(size.x, size.z) / 2 + 3) continue;
      buildings.push({
        id: `western-${index}-${side}`,
        kind: kinds[(index + (side > 0 ? 1 : 0)) % kinds.length],
        position,
        size,
        yaw: at.yaw - (side * Math.PI) / 2,
      });
    }
  const landforms: { position: Vector3; radius: number; height: number; yaw: number }[] = [];
  const addMesa = (x: number, z: number, radius: number, height: number) => {
    const position = new Vector3(x, desertElevation(z) + DESERT_GROUND_Y, z);
    const r = Math.min(radius, clearance(position) - 4);
    if (r < 5 || inCanyon(position, r)) return;
    if (buildings.some((b) => Math.hypot(b.position.x - x, b.position.z - z) < r + 12)) return;
    landforms.push({ position, radius: r, height, yaw: landforms.length * 2.399 });
  };
  for (const [x, z, r, h] of [
    [-10, 50, 36, 39],
    [33, 62, 26, 27],
    [-42, 30, 22, 25],
    [22, 5, 20, 20],
    [125, -93, 19, 29],
    [62, -122, 15, 26],
    [-98, -142, 10, 15],
    [-44, -112, 10, 16],
    [-80, -42, 20, 24],
  ])
    addMesa(x, z, r, h);
  for (let i = 0; i < 64; i++) {
    const a = (i * Math.PI * 2) / 64;
    addMesa(
      Math.sin(a) * (223 + (i % 3) * 8),
      Math.cos(a) * (210 + (i % 4) * 7),
      13 + (i % 9),
      14 + (i % 23),
    );
  }
  // Selected downloaded rocks are actual obstacles; foliage remains cheap decoration.
  const objects: DesertObject[] = [];
  for (let i = 0; i < 30; i++) {
    const at = sample(((0.25 + i * 0.0143) % 1) * length);
    const p = at.p.clone().addScaledVector(at.n, (i % 2 ? 1 : -1) * (at.width + 7 + (i % 4)));
    p.y = desertElevation(p.z) + DESERT_GROUND_Y;
    if (clearance(p) < 6 || inCanyon(p, 8)) continue;
    if (landforms.some((m) => Math.hypot(m.position.x - p.x, m.position.z - p.z) < m.radius + 6))
      continue;
    objects.push({
      id: `sandstone-${i}`,
      asset: `nature/rock_tall${i % 2 ? 'C' : 'D'}`,
      position: p,
      size: new Vector3(4 + (i % 3), 4 + (i % 5), 4),
      yaw: i * 2.399,
      solid: true,
    });
  }
  // A closed cattle pen follows the inside of the opening bend, blocking the field shortcut.
  const corralOutline: Vector3[] = [];
  for (let s = -35; s <= 250; s += 5) {
    const at = sample(s);
    corralOutline.push(at.p.clone().addScaledVector(at.n, at.width + 3));
  }
  corralOutline.push(new Vector3(105, 0, 85), new Vector3(5, 0, 110));
  const fence: { a: Vector3; b: Vector3 }[] = [];
  for (const [i, a] of corralOutline.entries()) {
    const b = corralOutline[(i + 1) % corralOutline.length];
    const count = Math.ceil(a.distanceTo(b) / 5);
    for (let j = 0; j < count; j++) {
      const from = a.clone().lerp(b, j / count),
        to = a.clone().lerp(b, (j + 1) / count);
      from.y = desertElevation(from.z) + DESERT_GROUND_Y;
      to.y = desertElevation(to.z) + DESERT_GROUND_Y;
      fence.push({ a: from, b: to });
    }
  }
  const inCorral = (p: Vector3) => {
    let inside = false;
    for (let i = 0, j = corralOutline.length - 1; i < corralOutline.length; j = i++) {
      const a = corralOutline[i],
        b = corralOutline[j];
      if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x)
        inside = !inside;
    }
    return inside;
  };
  const cattle = [
    [115, 125],
    [126, 119],
    [117, 106],
    [94, 133],
    [73, 130],
    [78, 117],
  ].map(([x, z], i) => ({
    position: new Vector3(x, desertElevation(z) + DESERT_GROUND_Y, z),
    yaw: i * 2.399,
  }));
  const corral = { fence, cattle, trough: new Vector3(135, DESERT_GROUND_Y, 111) };
  const town = sample(DESERT_TOWN_U * length);
  const fountain = town.p.clone().addScaledVector(town.n, town.width + 7);
  fountain.y = desertElevation(fountain.z);
  const landmarks = [
    { name: '01 · SUNDOWN JUNCTION', s: 0 },
    { name: '02 · CANYON BEND', s: length * 0.335 },
    { name: '03 · RED ROCK SWITCHBACKS', s: length * 0.585 },
    { name: '04 · RAVINE JUMP', s: jump.s },
    { name: '05 · OLD TOWN', s: length * DESERT_TOWN_U },
  ];
  return {
    objects,
    buildings,
    landforms,
    cuts,
    jump,
    fountain,
    landmarks,
    corral,
    clearance,
    inCanyon,
    inCorral,
  };
}
export type DesertLayout = ReturnType<typeof createDesertLayout>;

export function desertTerrainGeometry(layout: DesertLayout) {
  const vertices: number[] = [],
    indices: number[] = [];
  // 32 broad planar strips instead of a dense heightfield: exact cuts, < 200 triangles.
  for (let z = -320; z < 320; z += 20) {
    const intersecting = layout.cuts.filter((c) => {
      const reach = Math.abs(c.n.z) * c.halfWidth + Math.abs(c.t.z) * c.halfLength;
      return c.p.z + reach > z && c.p.z - reach < z + 20;
    });
    const strip = cutTerrain(intersecting, 0, 320, [
      { x: -320, z },
      { x: -320, z: z + 20 },
      { x: 320, z: z + 20 },
      { x: 320, z },
    ]);
    const offset = vertices.length / 3;
    for (let i = 0; i < strip.vertices.length; i += 3)
      vertices.push(
        strip.vertices[i],
        desertElevation(strip.vertices[i + 2]) + DESERT_GROUND_Y,
        strip.vertices[i + 2],
      );
    for (const index of strip.indices) indices.push(index + offset);
  }
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}
