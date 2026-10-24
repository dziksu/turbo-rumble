import { Vector3 } from 'three';
import { inForestRiver } from '../shared/forest-river.ts';
import type { Track } from '../shared/track.ts';
import { BIOME_GROUND_Y } from '../shared/biome-layout.ts';

export interface ForestPose {
  position: Vector3;
  yaw: number;
  scale: number;
  variant: number;
}
export interface ForestAccess {
  origin: Vector3;
  direction: Vector3;
  across: Vector3;
  length: number;
  halfWidth: number;
}
export const FOREST_COUNTS = { treeCandidates: 3200, detailCandidates: 2200 } as const;
const fract = (x: number) => x - Math.floor(x);
const noise = (i: number, salt = 0) => fract(Math.sin(i * 127.1 + salt * 311.7) * 43758.5453);

/** Visual vegetation only. Preserve the existing server terrain, jumps and off-road space. */
export function createForestLayout(track: Track) {
  const access: ForestAccess[] = [];
  for (let i = 0; i < 12; i++) {
    const at = track.trackAt(((i + 0.27) / 12) * track.TRACK_LENGTH);
    for (const side of [-1, 1])
      access.push({
        origin: at.p.clone().addScaledVector(at.n, side * (at.width + 4)),
        direction: at.n.clone().multiplyScalar(side),
        across: at.t.clone(),
        length: 52,
        halfWidth: 7,
      });
  }
  const inAccess = (p: Vector3, radius = 0) =>
    access.some((a) => {
      const dx = p.x - a.origin.x,
        dz = p.z - a.origin.z;
      const along = dx * a.direction.x + dz * a.direction.z;
      return (
        along >= -radius &&
        along <= a.length + radius &&
        Math.abs(dx * a.across.x + dz * a.across.z) < a.halfWidth + radius
      );
    });
  const river = track.biome!.river!;
  const inRiver = (p: Vector3, radius = 0) => inForestRiver(river, p, radius);
  const clearings: Vector3[] = [];
  for (const [u, side] of [
    [0.08, 1],
    [0.43, 1],
    [0.56, 1],
    [0.76, -1],
  ] as const) {
    const at = track.trackAt(u * track.TRACK_LENGTH);
    const p = at.p
      .clone()
      .addScaledVector(at.n, side * (at.width + 28))
      .setY(BIOME_GROUND_Y);
    if (!inRiver(p, 18)) clearings.push(p);
  }
  const clearance = (p: Vector3) => {
    const projected = track.projectOnTrack(p);
    return projected.distance - track.trackAt(projected.s).width;
  };
  const byProp = (p: Vector3, radius: number) =>
    track.biome!.props.some(
      (prop) =>
        Math.hypot(prop.position.x - p.x, prop.position.z - p.z) <
        Math.hypot(prop.size.x, prop.size.z) / 2 + radius + 3,
    );
  const safe = (p: Vector3, radius: number, margin = 6) =>
    clearance(p) > radius + margin && !inRiver(p, radius) && !byProp(p, radius);
  const trees: ForestPose[] = [],
    rocks: ForestPose[] = [],
    plants: ForestPose[] = [],
    logs: ForestPose[] = [];
  const extent = track.OVERVIEW_RADIUS + 58;
  for (let i = 0; i < FOREST_COUNTS.treeCandidates; i++) {
    const x = (noise(i, 1) * 2 - 1) * extent,
      z = (noise(i, 2) * 2 - 1) * extent;
    const p = new Vector3(x + track.OVERVIEW_CENTER.x, BIOME_GROUND_Y, z + track.OVERVIEW_CENTER.z);
    if (Math.hypot(x, z) > extent || !safe(p, 3.5, 7) || inAccess(p, 3.5)) continue;
    if (clearings.some((c) => c.distanceTo(p) < 16)) continue;
    const density = 0.55 + 0.2 * Math.sin(x * 0.038) * Math.cos(z * 0.045);
    if (noise(i, 3) > density) continue;
    if (trees.some((t) => Math.hypot(t.position.x - p.x, t.position.z - p.z) < 5.8)) continue;
    trees.push({
      position: p,
      yaw: noise(i, 4) * Math.PI * 2,
      scale: 0.8 + noise(i, 5) * 0.65,
      variant: i % 7 === 0 ? 2 : i % 3 === 0 ? 1 : 0,
    });
  }
  for (let i = 0; i < FOREST_COUNTS.detailCandidates; i++) {
    const p = new Vector3(
      (noise(i, 7) * 2 - 1) * extent + track.OVERVIEW_CENTER.x,
      BIOME_GROUND_Y,
      (noise(i, 8) * 2 - 1) * extent + track.OVERVIEW_CENTER.z,
    );
    if (p.distanceTo(track.OVERVIEW_CENTER) > extent || !safe(p, 0.8, 3)) continue;
    const pose = {
      position: p,
      yaw: noise(i, 9) * Math.PI * 2,
      scale: 0.65 + noise(i, 10) * 1.5,
      variant: i % 4,
    };
    const rockScale = 1.2 + noise(i, 12) * 2.6;
    const logScale = 1 + noise(i, 13);
    if (
      i % 7 === 0 &&
      safe(p, rockScale * 1.1, 4) &&
      !inAccess(p, rockScale * 1.1) &&
      !clearings.some((c) => c.distanceTo(p) < 12)
    )
      rocks.push({ ...pose, scale: rockScale });
    else if (i % 23 === 0 && safe(p, logScale * 3, 4) && !inAccess(p, logScale * 3))
      logs.push({ ...pose, scale: logScale });
    else plants.push(pose);
  }
  // Granite follows the same curved banks as water and terrain, without blocking jump approaches.
  for (const [i, at] of river.sections.entries()) {
    if (i % 2) continue;
    for (const side of [-1, 1]) {
      const scale = 1.5 + noise(i, side) * 1.5;
      const p = at.p
        .clone()
        .addScaledVector(at.n, side * (at.halfWidth + scale * 1.2 + 0.9))
        .setY(BIOME_GROUND_Y);
      if (
        p.distanceTo(track.OVERVIEW_CENTER) > extent ||
        clearance(p) < 9 ||
        byProp(p, 4) ||
        inAccess(p, 4)
      )
        continue;
      rocks.push({ position: p, yaw: i * 0.43, scale, variant: 2 });
    }
  }
  const deer: ForestPose[] = [],
    foxes: ForestPose[] = [];
  for (const [i, center] of clearings.entries()) {
    for (let j = 0; j < 3; j++) {
      const p = center.clone().add(new Vector3((j - 1) * 4, 0, j % 2 ? 3 : -2));
      if (safe(p, 2.6, 9))
        deer.push({
          position: p,
          yaw: i * 1.8 + j * 0.5,
          scale: j === 2 ? 0.7 : 1.15,
          variant: j === 0 ? 1 : 0,
        });
    }
    const p = center.clone().add(new Vector3(8, 0, 5));
    if (safe(p, 2, 8)) foxes.push({ position: p, yaw: i * 2.1, scale: 1.25, variant: 0 });
  }
  return {
    trees,
    rocks,
    plants,
    logs,
    deer,
    foxes,
    clearings,
    access,
    inAccess,
    inRiver,
    clearance,
  };
}
export type ForestLayout = ReturnType<typeof createForestLayout>;
