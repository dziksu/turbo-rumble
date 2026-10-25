import { Vector3 } from 'three';
import type { Track } from '../shared/track.ts';
import { BIOME_GROUND_Y, VOLCANO_ISLAND_RADIUS } from '../shared/biome-layout.ts';

export interface IslandPose {
  position: Vector3;
  yaw: number;
  scale: number;
  variant: number;
}
export const CRATER_RADIUS = 70;
const fract = (n: number) => n - Math.floor(n);
const noise = (i: number, salt: number) => fract(Math.sin(i * 127.1 + salt * 311.7) * 43758.5453);

/** Decorative island only: the road, terrain colliders, jumps and hazards stay authoritative. */
export function createVolcanoLayout(track: Track) {
  const center = track.OVERVIEW_CENTER;
  const access = Array.from({ length: 12 }, (_, i) =>
    track.trackAt(((i + 0.33) / 12) * track.TRACK_LENGTH),
  ).flatMap((at) =>
    [-1, 1].map((side) => ({
      origin: at.p.clone().addScaledVector(at.n, side * (at.width + 4)),
      direction: at.n.clone().multiplyScalar(side),
      across: at.t.clone(),
      halfWidth: 7,
      length: 44,
    })),
  );
  const inAccess = (p: Vector3, r = 0) =>
    access.some((a) => {
      const dx = p.x - a.origin.x,
        dz = p.z - a.origin.z,
        d = dx * a.direction.x + dz * a.direction.z;
      return (
        d >= -r && d < a.length + r && Math.abs(dx * a.across.x + dz * a.across.z) < a.halfWidth + r
      );
    });
  const inLava = (p: Vector3, r = 0) =>
    track.GAPS.some((g) => {
      const at = track.trackAt(g.s),
        dx = p.x - at.p.x,
        dz = p.z - at.p.z;
      return (
        Math.abs(dx * at.t.x + dz * at.t.z) < g.length / 2 + 1 + r &&
        Math.abs(dx * at.n.x + dz * at.n.z) < 90 + r
      );
    });
  const clearance = (p: Vector3) => {
    const pr = track.projectOnTrack(p);
    return pr.distance - track.trackAt(pr.s).width;
  };
  const byProp = (p: Vector3, r: number) =>
    track.biome!.props.some(
      (prop) => prop.position.distanceTo(p) < Math.hypot(prop.size.x, prop.size.z) / 2 + r + 3,
    );
  const safe = (p: Vector3, r: number) =>
    Math.hypot(p.x, p.z) < VOLCANO_ISLAND_RADIUS - 5 - r &&
    p.distanceTo(center) > CRATER_RADIUS + r + 3 &&
    clearance(p) > r + 5 &&
    !inLava(p, r) &&
    !byProp(p, r) &&
    !inAccess(p, r);
  const trees: IslandPose[] = [],
    rocks: IslandPose[] = [],
    plants: IslandPose[] = [],
    reef: IslandPose[] = [],
    furniture: IslandPose[] = [];
  for (let i = 0; i < 3000; i++) {
    const p = new Vector3((noise(i, 1) * 2 - 1) * 235, BIOME_GROUND_Y, (noise(i, 2) * 2 - 1) * 235);
    if (!safe(p, 4.5) || noise(i, 3) > 0.76 || trees.some((t) => t.position.distanceTo(p) < 6.9))
      continue;
    trees.push({
      position: p,
      yaw: noise(i, 4) * Math.PI * 2,
      scale: 0.8 + noise(i, 5) * 0.55,
      variant: i % 5 === 0 ? 2 : i % 3 === 0 ? 1 : 0,
    });
  }
  for (let i = 0; i < 1900; i++) {
    const p = new Vector3((noise(i, 7) * 2 - 1) * 234, BIOME_GROUND_Y, (noise(i, 8) * 2 - 1) * 234);
    const scale = 0.8 + noise(i, 9) * 2.2;
    if (i % 5 === 0 && safe(p, scale * 2.2))
      rocks.push({ position: p, yaw: noise(i, 10) * 6.28, scale, variant: i % 2 });
    else if (safe(p, 1.4))
      plants.push({
        position: p,
        yaw: noise(i, 11) * 6.28,
        scale: 0.7 + noise(i, 12) * 1.2,
        variant: i % 4,
      });
  }
  // Rocks trace the physical lava channels; all three jump lanes remain completely clear.
  for (const gap of track.GAPS) {
    const at = track.trackAt(gap.s);
    for (const side of [-1, 1])
      for (let d = -82; d < 88; d += 8) {
        const p = at.p
          .clone()
          .addScaledVector(at.n, d)
          .addScaledVector(at.t, side * (gap.length / 2 + 4.5))
          .setY(BIOME_GROUND_Y);
        if (
          clearance(p) < 10 ||
          p.distanceTo(center) < CRATER_RADIUS + 3 ||
          byProp(p, 3) ||
          inAccess(p, 3) ||
          Math.hypot(p.x, p.z) > 230
        )
          continue;
        rocks.push({ position: p, yaw: d * 0.17, scale: 1.3 + noise(d, side), variant: 0 });
      }
  }
  for (let i = 0; i < 66; i++) {
    const a = i * 2.399,
      r = 245 + noise(i, 21) * 19;
    reef.push({
      position: new Vector3(Math.sin(a) * r, -2.1, Math.cos(a) * r),
      yaw: a,
      scale: 1.6 + noise(i, 22) * 2.3,
      variant: 0,
    });
  }
  for (const [i, prop] of track.biome!.props.entries())
    if (prop.kind === 'hut') {
      const p = prop.position
        .clone()
        .add(new Vector3(prop.size.x * 0.75, 0, 0).applyAxisAngle(new Vector3(0, 1, 0), prop.yaw));
      if (clearance(p) > 6 && !inLava(p, 4))
        furniture.push({ position: p, yaw: prop.yaw, scale: 1, variant: i % 2 });
    }
  const vents = track.GAPS.flatMap((g) => {
    const at = track.trackAt(g.s);
    return [-1, 1].map((side) =>
      at.p
        .clone()
        .addScaledVector(at.n, side * (at.width + 13))
        .setY(-1.1),
    );
  });
  return { trees, rocks, plants, reef, furniture, vents, access, inAccess, inLava, clearance };
}
