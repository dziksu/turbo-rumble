import { Vector3, Vector2, ShapeUtils } from 'three';

interface RoutePoint {
  p: Vector3;
  n: Vector3;
  width: number;
}
export interface RiverSection {
  p: Vector3;
  t: Vector3;
  n: Vector3;
  halfWidth: number;
  distance: number;
}
export interface ForestRiver {
  sections: RiverSection[];
  length: number;
}

/** One continuous channel; straight 56m reaches preserve the two existing jumps exactly. */
export function createForestRiver(
  gaps: { s: number; length: number }[],
  sample: (s: number) => RoutePoint,
): ForestRiver {
  const a = sample(gaps[0].s),
    b = sample(gaps[1].s);
  const offset = (at: RoutePoint, d: number) => at.p.clone().addScaledVector(at.n, d).setY(0);
  // Monotonic downstream coordinate and shared tangents prevent folded inner banks at bends.
  const slopeA = -a.n.x / -a.n.z,
    slopeB = b.n.x / b.n.z;
  const knot = (p: Vector3, slope: number) => ({ x: p.x, z: p.z, slope });
  const knots = [
    { x: 24, z: -320, slope: 0 },
    { x: 22, z: -275, slope: 0 },
    { x: 65, z: -215, slope: 0 },
    knot(offset(a, 55), slopeA),
    knot(offset(a, 28), slopeA),
    knot(a.p, slopeA),
    knot(offset(a, -28), slopeA),
    { x: 45, z: -48, slope: 0 },
    { x: -35, z: 30, slope: 0 },
    knot(offset(b, -28), slopeB),
    knot(b.p, slopeB),
    knot(offset(b, 28), slopeB),
    knot(offset(b, 55), slopeB),
    { x: -101, z: 230, slope: 0 },
    { x: -59, z: 300, slope: 0 },
    { x: -59, z: 320, slope: 0 },
  ];
  const points: Vector3[] = [],
    tangents: Vector3[] = [];
  for (let i = 1; i < knots.length; i++) {
    const a = knots[i - 1],
      b = knots[i],
      dz = b.z - a.z;
    const steps = Math.ceil(Math.hypot(b.x - a.x, dz) / 3.5);
    for (let j = i === 1 ? 0 : 1; j <= steps; j++) {
      const u = j / steps,
        u2 = u * u,
        u3 = u2 * u;
      const x =
        (2 * u3 - 3 * u2 + 1) * a.x +
        (u3 - 2 * u2 + u) * dz * a.slope +
        (-2 * u3 + 3 * u2) * b.x +
        (u3 - u2) * dz * b.slope;
      const dx =
        (6 * u2 - 6 * u) * a.x +
        (3 * u2 - 4 * u + 1) * dz * a.slope +
        (-6 * u2 + 6 * u) * b.x +
        (3 * u2 - 2 * u) * dz * b.slope;
      points.push(new Vector3(x, 0, a.z + u * dz));
      tangents.push(new Vector3(dx / dz, 0, 1).normalize());
    }
  }
  let distance = 0;
  const sections = points.map((p, i) => {
    if (i) distance += p.distanceTo(points[i - 1]);
    const t = tangents[i];
    const near = Math.min(p.distanceTo(a.p), p.distanceTo(b.p));
    const blend = Math.max(0, Math.min(1, (near - 34) / 30));
    const halfWidth =
      gaps[0].length / 2 +
      0.08 +
      blend * blend * (3 - 2 * blend) * (3.7 + Math.sin(distance * 0.025) * 1.1);
    return { p, t, n: new Vector3(t.z, 0, -t.x), halfWidth, distance };
  });
  return { sections, length: distance };
}

export function inForestRiver(river: ForestRiver, p: { x: number; z: number }, radius = 0) {
  for (let i = 1; i < river.sections.length; i++) {
    const a = river.sections[i - 1],
      b = river.sections[i],
      dx = b.p.x - a.p.x,
      dz = b.p.z - a.p.z;
    const u = Math.max(
      0,
      Math.min(1, ((p.x - a.p.x) * dx + (p.z - a.p.z) * dz) / (dx * dx + dz * dz)),
    );
    const width = a.halfWidth + (b.halfWidth - a.halfWidth) * u;
    if (Math.hypot(p.x - a.p.x - dx * u, p.z - a.p.z - dz * u) < width + radius) return true;
  }
  return false;
}

/** Split the ground once along both banks instead of subtracting hundreds of overlapping cuts. */
export function forestRiverTerrain(river: ForestRiver, y: number, extent = 320) {
  const vertices: number[] = [],
    indices: number[] = [];
  for (const side of [-1, 1]) {
    const bank = river.sections.map((s) => s.p.clone().addScaledVector(s.n, s.halfWidth * side));
    const outline = [
      ...bank,
      new Vector3(side * extent, 0, extent),
      new Vector3(side * extent, 0, -extent),
    ];
    const offset = vertices.length / 3;
    for (const p of outline) vertices.push(p.x, y, p.z);
    for (const triangle of ShapeUtils.triangulateShape(
      outline.map((p) => new Vector2(p.x, p.z)),
      [],
    )) {
      const [a, b, c] = triangle.map((i) => outline[i]);
      const normal = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
      if (Math.abs(normal) < 1e-7) continue;
      if (normal > 0)
        indices.push(offset + triangle[0], offset + triangle[1], offset + triangle[2]);
      else indices.push(offset + triangle[0], offset + triangle[2], offset + triangle[1]);
    }
  }
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}
