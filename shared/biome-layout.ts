import { Quaternion, Vector3 } from 'three';
import { cutTerrain } from './terrain.ts';
import type { MapId } from './maps.ts';

export const BIOME_GROUND_Y = -0.18;
export const VOLCANO_ISLAND_RADIUS = 240;
interface RoutePoint {
  p: Vector3;
  t: Vector3;
  n: Vector3;
  yaw: number;
  width: number;
}
export interface BiomeProp {
  id: string;
  kind: 'cabin' | 'mill' | 'tent' | 'tower' | 'logpile' | 'basalt' | 'station' | 'hut';
  position: Vector3;
  size: Vector3;
  yaw: number;
  solid: boolean;
}
export interface MovingHazard {
  id: number;
  kind: 'timber' | 'thermal';
  s: number;
  position: Vector3;
  size: Vector3;
  yaw: number;
  phase: number;
}
const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};
const district = (u: number, start: number, end: number) =>
  smooth((u - start + 0.025) / 0.025) * smooth((end + 0.025 - u) / 0.025);
export function biomeRoadWidth(id: MapId, u: number) {
  if (id === 'forest') return 9 + 6 * district(u, 0.27, 0.38) + 4 * district(u, 0.81, 0.9);
  return 8.5 + 6.5 * district(u, 0.35, 0.46) + 4.5 * district(u, 0.8, 0.89);
}
export function movingHazardPose(hazard: MovingHazard, tick: number) {
  const seconds = tick / 50;
  const yaw =
    hazard.yaw +
    (hazard.kind === 'timber'
      ? Math.sin(seconds * 0.85 + hazard.phase) * 1.1
      : seconds * 0.7 + hazard.phase);
  return {
    position: hazard.position.clone(),
    rotation: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw),
  };
}

export function createBiomeLayout(
  id: MapId,
  length: number,
  sample: (s: number) => RoutePoint,
  gaps: { s: number; length: number }[],
) {
  const forest = id === 'forest';
  const props: BiomeProp[] = [];
  const add = (u: number, side: number, kind: BiomeProp['kind'], size: Vector3, extra = 0) => {
    const at = sample(u * length);
    const position = at.p.clone().addScaledVector(at.n, side * (at.width + 8 + size.z / 2 + extra));
    position.y = BIOME_GROUND_Y;
    props.push({
      id: `${kind}-${props.length}`,
      kind,
      position,
      size,
      yaw: at.yaw - (side * Math.PI) / 2,
      solid: true,
    });
  };
  if (forest) {
    for (const u of [0.285, 0.32, 0.355])
      for (const side of [-1, 1]) add(u, side, 'cabin', new Vector3(12, 8, 10));
    for (const u of [0.82, 0.85, 0.88])
      for (const side of [-1, 1]) add(u, side, 'tent', new Vector3(7, 4, 6));
    for (const u of [0.255, 0.395, 0.78]) add(u, 1, 'tower', new Vector3(6, 12, 6), 3);
    for (const u of [0.25, 0.3, 0.36, 0.41, 0.74, 0.93])
      add(u, -1, 'logpile', new Vector3(8, 3, 5));
    for (const gap of gaps)
      add((gap.s + gap.length / 2 + 11) / length, 1, 'mill', new Vector3(13, 9, 11), 4);
  } else {
    for (const u of [0.355, 0.39, 0.425, 0.46])
      for (const side of [-1, 1]) add(u, side, 'station', new Vector3(11, 7, 10));
    for (const u of [0.8, 0.835, 0.87])
      for (const side of [-1, 1]) add(u, side, 'hut', new Vector3(9, 7, 8));
    for (let i = 0; i < 30; i++) {
      const u = (0.04 + i * 0.0321) % 1;
      if (gaps.some((g) => Math.abs(u * length - g.s) < 28)) continue;
      add(
        u,
        i % 2 ? 1 : -1,
        'basalt',
        new Vector3(5 + (i % 4), 5 + (i % 6), 5 + (i % 3)),
        (i % 3) * 4,
      );
    }
    for (const u of [0.32, 0.49]) add(u, -1, 'tower', new Vector3(6, 13, 6), 5);
  }
  const clearProps = props.filter((prop, index) => {
    const radius = Math.hypot(prop.size.x, prop.size.z) / 2;
    for (let i = 0; i < 320; i++) {
      const at = sample((i / 320) * length);
      if (at.p.distanceTo(prop.position) < at.width + radius + 2) return false;
    }
    return !props
      .slice(0, index)
      .some(
        (other) =>
          other.position.distanceTo(prop.position) <
          radius + Math.hypot(other.size.x, other.size.z) / 2 + 1,
      );
  });
  const hazards: MovingHazard[] = (forest ? [0.32, 0.85] : [0.405, 0.845]).map((u, index) => {
    const at = sample(u * length),
      side = index % 2 ? 1 : -1;
    const position = at.p
      .clone()
      .addScaledVector(at.n, side * at.width * 0.64)
      .setY(0.85);
    return {
      id: 1000 + index,
      kind: forest ? 'timber' : 'thermal',
      s: u * length,
      position,
      size: new Vector3(7.6, 1.1, 1.1),
      yaw: at.yaw,
      phase: (index * Math.PI) / 2,
    };
  });
  const landmarks = forest
    ? [
        { name: 'TIMBER WORKS', s: length * 0.32 },
        { name: 'RANGER CAMP', s: length * 0.85 },
      ]
    : [
        { name: 'LAVA WORKS', s: length * 0.405 },
        { name: 'PALM COAST', s: length * 0.845 },
      ];
  const fixtures: { position: Vector3; size: Vector3; yaw: number }[] = [];
  for (const landmark of landmarks) {
    const at = sample(landmark.s - 25);
    for (const side of [-1, 1])
      fixtures.push({
        position: at.p
          .clone()
          .addScaledVector(at.n, side * (at.width + 2))
          .setY(3),
        size: new Vector3(1.1, 6, 1.1),
        yaw: at.yaw,
      });
  }
  if (!forest)
    for (const u of [0.095, 0.55]) {
      const at = sample(u * length);
      for (const side of [-1, 1])
        for (let i = 0; i < 3; i++)
          fixtures.push({
            position: at.p
              .clone()
              .addScaledVector(at.n, side * (at.width + 2 + i * 0.8))
              .addScaledVector(at.t, i - 1)
              .setY((5 + i) / 2),
            size: new Vector3(2.6, 5 + i, 2.6),
            yaw: at.yaw,
          });
    }
  const cuts = gaps.map((g) => ({
    ...sample(g.s),
    halfWidth: 90,
    halfLength: g.length / 2 + 0.08,
  }));
  const boundary = forest
    ? undefined
    : Array.from({ length: 64 }, (_, i) => {
        const a = (-i / 64) * Math.PI * 2;
        return { x: Math.sin(a) * VOLCANO_ISLAND_RADIUS, z: Math.cos(a) * VOLCANO_ISLAND_RADIUS };
      });
  // cutTerrain expects clockwise x/z boundary vertices (upward-facing triangles).
  const terrain = cutTerrain(cuts, BIOME_GROUND_Y, 320, boundary?.reverse());
  return {
    props: clearProps,
    hazards,
    terrain,
    fixtures,
    landmarks,
  };
}
export type BiomeLayout = ReturnType<typeof createBiomeLayout>;
