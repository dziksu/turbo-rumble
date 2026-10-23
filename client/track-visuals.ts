import { desertElevation } from '../shared/desert-layout.ts';
import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import { getTrack, type Track } from '../shared/track.ts';
const defaultTrack = getTrack();

export const SURFACE_HEIGHTS = {
  asphalt: 0.02,
  shoulder: -0.06,
  curbBase: 0.02,
  curbTop: 0.18,
  cliffBottom: -7.5,
  rampEntry: 0.035,
} as const;
export const CURB_TILE_COUNT = Math.round(defaultTrack.TRACK_LENGTH / 3.2 / 2) * 2;
const CURB_STEPS = 5;

function quad(vertices: number[], a: Vector3, b: Vector3, c: Vector3, d: Vector3) {
  for (const vertex of [a, b, c, a, c, d]) vertices.push(vertex.x, vertex.y, vertex.z);
}
function geometry(vertices: number[]) {
  const result = new BufferGeometry();
  result.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  result.computeVertexNormals();
  return result;
}
function point(track: Track, s: number, side: number, y: number) {
  const at = track.trackAt(s);
  const localSide = side + Math.sign(side) * (at.width - track.ROAD_WIDTH);
  const p = at.p.addScaledVector(at.n, localSide);
  return p.setY(track.surfaceHeight(p) + y);
}

// A continuous strip follows each curved edge. Neighboring tiles share an edge, never a face.
export function curbGeometries(track: Track = defaultTrack): [BufferGeometry, BufferGeometry] {
  const tileCount = Math.round(track.TRACK_LENGTH / 3.2 / 2) * 2;
  const colors: [number[], number[]] = [[], []];
  for (let tile = 0; tile < tileCount; tile++)
    for (let step = 0; step < CURB_STEPS; step++) {
      const start = ((tile + step / CURB_STEPS) / tileCount) * track.TRACK_LENGTH,
        end = ((tile + (step + 1) / CURB_STEPS) / tileCount) * track.TRACK_LENGTH;
      if (track.isGap((start + end) / 2)) continue;
      for (const side of [-1, 1]) {
        const near = (track.ROAD_WIDTH - 0.28) * side - 0.31,
          far = near + 0.62;
        const a = point(track, start, near, SURFACE_HEIGHTS.curbTop),
          b = point(track, end, near, SURFACE_HEIGHTS.curbTop),
          c = point(track, end, far, SURFACE_HEIGHTS.curbTop),
          d = point(track, start, far, SURFACE_HEIGHTS.curbTop);
        const bottomA = a
            .clone()
            .add(new Vector3(0, SURFACE_HEIGHTS.curbBase - SURFACE_HEIGHTS.curbTop, 0)),
          bottomB = b
            .clone()
            .add(new Vector3(0, SURFACE_HEIGHTS.curbBase - SURFACE_HEIGHTS.curbTop, 0)),
          bottomC = c
            .clone()
            .add(new Vector3(0, SURFACE_HEIGHTS.curbBase - SURFACE_HEIGHTS.curbTop, 0)),
          bottomD = d
            .clone()
            .add(new Vector3(0, SURFACE_HEIGHTS.curbBase - SURFACE_HEIGHTS.curbTop, 0));
        const vertices = colors[tile % 2];
        quad(vertices, a, b, c, d);
        quad(vertices, a, bottomA, bottomB, b);
        quad(vertices, d, c, bottomC, bottomD);
      }
    }
  return [geometry(colors[0]), geometry(colors[1])];
}

// The shoulder already caps the bed. Only side walls are needed; overlapping box tops are absent.
export function roadbedWallGeometry(track: Track = defaultTrack) {
  const vertices: number[] = [];
  for (let sample = 0; sample < track.SAMPLES; sample++)
    for (const side of [-1, 1]) {
      const s0 = (sample / track.SAMPLES) * track.TRACK_LENGTH,
        s1 = ((sample + 1) / track.SAMPLES) * track.TRACK_LENGTH;
      if (
        track.isGap((s0 + s1) / 2) ||
        (track.desert && !track.isGap((s0 + s1) / 2, 22)) ||
        (track.biome && !track.isGap((s0 + s1) / 2, 14))
      )
        continue;
      const a = point(track, s0, (track.ROAD_WIDTH + 1) * side, SURFACE_HEIGHTS.shoulder),
        b = point(track, s1, (track.ROAD_WIDTH + 1) * side, SURFACE_HEIGHTS.shoulder);
      const bottomA = a.clone().setY(track.desert ? -0.8 : -2.0),
        bottomB = b.clone().setY(track.desert ? -0.8 : -2.0);
      if (side === 1) quad(vertices, a, b, bottomB, bottomA);
      else quad(vertices, b, a, bottomA, bottomB);
    }
  return geometry(vertices);
}

// Use the original guardrail centers/open sections, but bend each visible segment along the road.
// Clip the two end segments to their shared midpoint so the closed-loop seam cannot overlap.
export function guardrailGeometry(track: Track = defaultTrack) {
  const vertices: number[] = [],
    centers = Array.from({ length: Math.ceil(track.TRACK_LENGTH / 5) }, (_, index) => index * 5),
    gap = 0.15;
  for (const [index, center] of centers.entries()) {
    if (!track.hasGuardrail(center)) continue;
    const previous =
        index === 0 ? centers[centers.length - 1] - track.TRACK_LENGTH : centers[index - 1],
      next = index === centers.length - 1 ? track.TRACK_LENGTH : centers[index + 1];
    const start = center - Math.min(2.425, (center - previous - gap) / 2),
      end = center + Math.min(2.425, (next - center - gap) / 2),
      steps = Math.ceil((end - start) / 0.5);
    for (const side of [-1, 1])
      for (let step = 0; step < steps; step++) {
        const s0 = start + ((end - start) * step) / steps,
          s1 = start + ((end - start) * (step + 1)) / steps;
        const inner = (track.ROAD_WIDTH + 0.45) * side - 0.175,
          outer = inner + 0.35;
        if (track.isGap((s0 + s1) / 2)) continue;
        const a = point(track, s0, inner, 0.975),
          b = point(track, s1, inner, 0.975),
          c = point(track, s1, outer, 0.975),
          d = point(track, s0, outer, 0.975);
        const bottomA = a.clone().add(new Vector3(0, -0.65, 0)),
          bottomB = b.clone().add(new Vector3(0, -0.65, 0)),
          bottomC = c.clone().add(new Vector3(0, -0.65, 0)),
          bottomD = d.clone().add(new Vector3(0, -0.65, 0));
        quad(vertices, a, b, c, d);
        quad(vertices, a, bottomA, bottomB, b);
        quad(vertices, d, c, bottomC, bottomD);
        if (step === 0) quad(vertices, a, d, bottomD, bottomA);
        if (step === steps - 1) quad(vertices, b, bottomB, bottomC, c);
      }
  }
  return geometry(vertices);
}

// Lift only the visible ramp entry above the asphalt. The shared collision ramp stays unchanged.
export function visibleRampGeometry(ramp: Track['RAMPS'][number], track: Track = defaultTrack) {
  const data = track.rampGeometry(ramp);
  for (let vertex = 0; vertex < 4; vertex++)
    data.vertices[vertex * 3 + 1] = Math.max(
      data.vertices[vertex * 3 + 1],
      SURFACE_HEIGHTS.rampEntry +
        (track.desert ? desertElevation(data.vertices[vertex * 3 + 2]) : 0),
    );
  const result = new BufferGeometry();
  result.setAttribute('position', new Float32BufferAttribute(data.vertices, 3));
  result.setIndex(Array.from(data.indices));
  result.computeVertexNormals();
  return result;
}

export function hasCenterDash(s: number, track: Track = defaultTrack) {
  return (
    track.id !== 'desert' &&
    !track.isGap(s, 10) &&
    (!track.desert || track.trackAt(s).p.distanceTo(track.desert.fountain) > 6) &&
    Math.round(s / 3.2) % 3 === 0 &&
    Math.min(s, track.TRACK_LENGTH - s) > 2
  );
}
