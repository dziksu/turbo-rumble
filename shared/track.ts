import { createBiomeLayout, biomeRoadWidth } from './biome-layout.ts';
import {
  createDesertLayout,
  desertRoadWidth,
  desertTerrainGeometry,
  desertElevation,
} from './desert-layout.ts';
import { CatmullRomCurve3, Vector3 } from 'three';
import { MAPS, type MapId } from './maps.ts';

function createTrack(id: MapId) {
  const definition = MAPS[id];
  const TRACK_NAME = definition.name;
  const ROAD_WIDTH = definition.roadWidth;
  const SAMPLES = 1280;
  const controlPoints = definition.points.map(([x, z]) => new Vector3(x, 0, z));
  // Cut sharp polygon corners before interpolation; inner road edges must never fold back.
  const curvePoints =
    id === 'desert'
      ? controlPoints.flatMap((a, i) => {
          const b = controlPoints[(i + 1) % controlPoints.length];
          return [a.clone().lerp(b, 0.2), a.clone().lerp(b, 0.8)];
        })
      : controlPoints;
  const curve = new CatmullRomCurve3(curvePoints, true, 'centripetal');
  curve.arcLengthDivisions = 3200;
  const TRACK_LENGTH = curve.getLength();
  const CENTER = Array.from({ length: SAMPLES }, (_, i) => curve.getPointAt(i / SAMPLES));
  const TANGENTS = Array.from({ length: SAMPLES }, (_, i) =>
    curve.getTangentAt(i / SAMPLES).normalize(),
  );
  const min = new Vector3(Infinity, 0, Infinity),
    max = new Vector3(-Infinity, 0, -Infinity);
  for (const p of CENTER) {
    min.min(p);
    max.max(p);
  }
  const OVERVIEW_CENTER = min.clone().add(max).multiplyScalar(0.5);
  const OVERVIEW_RADIUS =
    Math.max(...CENTER.map((p) => p.distanceTo(OVERVIEW_CENTER))) + ROAD_WIDTH;
  const GAPS = definition.gaps.map((gap) => ({ ...gap, s: gap.u * TRACK_LENGTH }));
  const isGap = (s: number, margin = 0) =>
    GAPS.some(
      (g) =>
        Math.abs(((s - g.s + TRACK_LENGTH * 1.5) % TRACK_LENGTH) - TRACK_LENGTH / 2) <
        g.length / 2 + margin,
    );
  const wrap = (s: number) => ((s % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH;
  function trackAt(s: number) {
    const f = (wrap(s) / TRACK_LENGTH) * SAMPLES,
      i = Math.floor(f),
      j = (i + 1) % SAMPLES,
      a = f - i;
    const p = CENTER[i].clone().lerp(CENTER[j], a);
    if (id === 'desert') p.y = desertElevation(p.z);
    const t = TANGENTS[i].clone().lerp(TANGENTS[j], a).normalize();
    const width =
      id === 'desert'
        ? desertRoadWidth(wrap(s) / TRACK_LENGTH)
        : biomeRoadWidth(id, wrap(s) / TRACK_LENGTH);
    return { p, t, n: new Vector3(t.z, 0, -t.x), yaw: Math.atan2(t.x, t.z), width };
  }
  const surfaceHeight = (p: { z: number }) => (id === 'desert' ? desertElevation(p.z) : 0);
  const desert = id === 'desert' ? createDesertLayout(TRACK_LENGTH, trackAt) : null;
  const biome = id === 'desert' ? null : createBiomeLayout(id, TRACK_LENGTH, trackAt, GAPS);
  const terrainData = desert ? desertTerrainGeometry(desert) : biome!.terrain;
  const terrainGeometry = () => terrainData;
  const hasGuardrail = (s: number) => {
    if (desert) {
      const u = wrap(s) / TRACK_LENGTH;
      return !isGap(s, 5) && ((u > 0.16 && u < 0.39) || (u > 0.43 && u < 0.71));
    }
    const u = wrap(s) / TRACK_LENGTH;
    return (
      !isGap(s, 4) &&
      (id === 'forest'
        ? (u > 0.43 && u < 0.52) || (u > 0.94 && u < 0.985)
        : (u > 0.07 && u < 0.12) || (u > 0.52 && u < 0.59))
    );
  };
  function botLane(s: number, slot: number) {
    return Math.sin(s / 32 + slot * 2) * 2.6;
  }

  function projectOnTrack(p: { x: number; z: number }, previous?: number) {
    let best = Infinity,
      index = 0;
    const base = previous === undefined ? 0 : Math.round((wrap(previous) / TRACK_LENGTH) * SAMPLES);
    const radius = previous === undefined ? SAMPLES : 42;
    for (
      let k = previous === undefined ? 0 : -radius;
      k < (previous === undefined ? SAMPLES : radius + 1);
      k++
    ) {
      const i = (base + k + SAMPLES * 2) % SAMPLES,
        c = CENTER[i],
        d = (c.x - p.x) ** 2 + (c.z - p.z) ** 2;
      if (d < best) {
        best = d;
        index = i;
      }
    }
    // Refine the nearest vertex onto its adjacent segments. Progress and finish order
    // need sub-metre precision even on the longer canyon circuit.
    let s = (index / SAMPLES) * TRACK_LENGTH;
    for (const start of [(index + SAMPLES - 1) % SAMPLES, index]) {
      const a = CENTER[start],
        b = CENTER[(start + 1) % SAMPLES];
      const dx = b.x - a.x,
        dz = b.z - a.z;
      const f = Math.max(
        0,
        Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)),
      );
      const distance = (p.x - a.x - f * dx) ** 2 + (p.z - a.z - f * dz) ** 2;
      if (distance <= best) {
        best = distance;
        s = wrap(((start + f) / SAMPLES) * TRACK_LENGTH);
      }
    }
    let delta = previous === undefined ? 0 : s - wrap(previous);
    if (delta > TRACK_LENGTH / 2) delta -= TRACK_LENGTH;
    if (delta < -TRACK_LENGTH / 2) delta += TRACK_LENGTH;
    const at = trackAt(s),
      lateral = (p.x - at.p.x) * at.n.x + (p.z - at.p.z) * at.n.z;
    return { s, delta, lateral, distance: Math.sqrt(best) };
  }
  function roadGeometry(width = ROAD_WIDTH, y = 0) {
    const vertices: number[] = [],
      indices: number[] = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const a = trackAt((i / SAMPLES) * TRACK_LENGTH);
      const localWidth = a.width + width - ROAD_WIDTH;
      for (const side of [-1, 1]) {
        const p = a.p.clone().addScaledVector(a.n, localWidth * side);
        vertices.push(p.x, surfaceHeight(p) + y, p.z);
      }
      if (i < SAMPLES && !isGap(((i + 0.5) / SAMPLES) * TRACK_LENGTH)) {
        const v = i * 2;
        indices.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
      }
    }
    return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
  }
  function cameraPose(s: number) {
    const a = trackAt(s),
      target = trackAt(s + 12).p.clone();
    return {
      position: a.p
        .clone()
        .addScaledVector(a.t, -21)
        .add(new Vector3(0, 33 + Math.max(0, a.width - 9) * 0.8, 0)),
      target,
    };
  }
  function outsideCamera(p: { x: number; y: number; z: number }, s: number) {
    const { position, target } = cameraPose(s),
      forward = target.sub(position).normalize();
    const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize();
    const up = new Vector3().crossVectors(right, forward),
      rel = new Vector3(p.x, p.y, p.z).sub(position);
    const depth = rel.dot(forward),
      half = Math.tan((55 * Math.PI) / 360);
    return (
      depth < 1 ||
      Math.abs(rel.dot(right) / ((depth * half * 16) / 9)) > 1.12 ||
      Math.abs(rel.dot(up) / (depth * half)) > 1.12
    );
  }
  const PICKUP_SPAWNS = Array.from({ length: 72 }, (_, id) => {
    const a = trackAt(((Math.floor(id / 3) + 1) / 25) * TRACK_LENGTH);
    const p = a.p.addScaledVector(a.n, ((id % 3) - 1) * 3.7);
    p.y = surfaceHeight(p) + 1.15;
    return { id, position: p };
  }).filter((pickup) => !isGap(projectOnTrack(pickup.position).s, 20));
  type ObstacleKind = 'crate' | 'barrel' | 'barrier' | 'rock' | 'log';
  const obstaclePlan: [number, number, ObstacleKind][] = [
    [0.14, -4.2, 'crate'],
    [0.17, 4.1, 'barrel'],
    [0.205, -3.8, 'barrier'],
    [0.24, 3.8, 'crate'],
    [0.24, -3.8, 'barrel'],
    [0.275, 4.4, 'rock'],
    [0.31, -3.8, 'barrel'],
    [0.345, 4.3, 'crate'],
    [0.395, -3.8, 'barrier'],
    [0.425, 4.1, 'barrel'],
    [0.455, -4.2, 'rock'],
    [0.49, 3.8, 'crate'],
    [0.49, -3.8, 'crate'],
    [0.525, -3.8, 'barrier'],
    [0.56, 4.1, 'barrel'],
    [0.595, -3.8, 'crate'],
    [0.595, 3.8, 'barrel'],
    [0.63, 4.3, 'rock'],
    [0.655, -4.2, 'barrier'],
    [0.725, -3.8, 'barrel'],
    [0.755, 4.1, 'crate'],
    [0.79, -3.8, 'barrier'],
    [0.825, 3.8, 'barrel'],
    [0.825, -3.8, 'crate'],
    [0.86, 4.3, 'rock'],
    [0.895, -4.1, 'crate'],
    [0.925, 3.8, 'barrier'],
    [0.955, -4.0, 'barrel'],
  ];
  const themedPlan =
    id === 'desert'
      ? obstaclePlan.filter(([u]) => ![0.125, 0.455, 0.69].some((r) => Math.abs(u - r) < 0.012))
      : obstaclePlan.map(([u, side, kind], index): [number, number, ObstacleKind] => [
          u,
          side * 1.35,
          id === 'forest' && index % 3 !== 1 ? 'log' : kind === 'barrier' ? 'rock' : kind,
        ]);
  const OBSTACLES = themedPlan
    .filter(([u]) => !isGap(u * TRACK_LENGTH, 25))
    .map(([u, side, kind], id) => {
      const a = trackAt(u * TRACK_LENGTH),
        size =
          kind === 'log'
            ? { x: 5.4, y: 1.1, z: 1.1 }
            : kind === 'barrier'
              ? { x: 4, y: 1.15, z: 1 }
              : kind === 'barrel'
                ? { x: 1.5, y: 1.9, z: 1.5 }
                : kind === 'rock'
                  ? { x: 2.7, y: 2.2, z: 2.5 }
                  : { x: 2, y: 1.8, z: 2 };
      const position = a.p.addScaledVector(a.n, side);
      position.y = surfaceHeight(position) + size.y / 2;
      return {
        id,
        s: u * TRACK_LENGTH,
        side,
        kind,
        size,
        position,
        yaw: a.yaw,
        dynamic: kind === 'crate' || kind === 'barrel' || kind === 'log',
        mass: kind === 'log' ? 110 : kind === 'barrel' ? 28 : 45,
      };
    });
  const RAMPS = [
    ...GAPS.map((gap) => ({
      s: gap.s - gap.length / 2 - 9,
      side: 0,
      length: 18,
      width: trackAt(gap.s).width * 2 + 0.5,
      height: 3.6,
    })),
    ...(id === 'desert'
      ? [
          { s: TRACK_LENGTH * 0.125, side: 3.4, length: 9, width: 3.2, height: 1.35 },
          { s: TRACK_LENGTH * 0.455, side: -3.3, length: 11, width: 3.2, height: 1.9 },
          { s: TRACK_LENGTH * 0.69, side: 3.4, length: 12, width: 3.2, height: 2.1 },
        ]
      : []),
  ];
  const RAMP = RAMPS[id === 'desert' ? 1 : 0];
  function rampGeometry(ramp: typeof RAMP) {
    const a = trackAt(ramp.s),
      vertices: number[] = [];
    for (const top of [true, false])
      for (const along of [-ramp.length / 2, ramp.length / 2])
        for (const side of [-ramp.width / 2, ramp.width / 2]) {
          const p = a.p
            .clone()
            .addScaledVector(a.t, along)
            .addScaledVector(a.n, ramp.side + side);
          const base = id === 'desert' ? desertElevation(p.z) : 0;
          vertices.push(p.x, base + (top ? (along < 0 ? -0.03 : ramp.height) : -0.15), p.z);
        }
    return {
      vertices: new Float32Array(vertices),
      indices: new Uint32Array([
        0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1,
        3, 5, 3, 7, 5,
      ]),
    };
  }

  return {
    id,
    desert,
    biome,
    terrainGeometry,
    surfaceHeight,
    hasGuardrail,
    botLane,
    TRACK_NAME,
    ROAD_WIDTH,
    SAMPLES,
    TRACK_LENGTH,
    CENTER,
    TANGENTS,
    OVERVIEW_CENTER,
    OVERVIEW_RADIUS,
    wrap,
    trackAt,
    projectOnTrack,
    roadGeometry,
    cameraPose,
    outsideCamera,
    PICKUP_SPAWNS,
    OBSTACLES,
    RAMPS,
    RAMP,
    rampGeometry,
    GAPS,
    isGap,
  };
}
export type Track = ReturnType<typeof createTrack>;
const tracks = new Map<MapId, Track>();
export function getTrack(id: MapId = 'desert'): Track {
  let track = tracks.get(id);
  if (!track) {
    track = createTrack(id);
    tracks.set(id, track);
  }
  return track;
}
// Default exports preserve existing driving labs and desert regression fixtures.
export const {
  TRACK_NAME,
  ROAD_WIDTH,
  SAMPLES,
  TRACK_LENGTH,
  CENTER,
  TANGENTS,
  OVERVIEW_CENTER,
  OVERVIEW_RADIUS,
  wrap,
  trackAt,
  projectOnTrack,
  roadGeometry,
  cameraPose,
  outsideCamera,
  PICKUP_SPAWNS,
  OBSTACLES,
  RAMPS,
  RAMP,
  rampGeometry,
} = getTrack();
