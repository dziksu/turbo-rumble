interface GroundPoint {
  x: number;
  z: number;
}
function halfPlane(polygon: GroundPoint[], nx: number, nz: number, limit: number, inside: boolean) {
  const result: GroundPoint[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length];
    const av = a.x * nx + a.z * nz - limit,
      bv = b.x * nx + b.z * nz - limit;
    const keepA = inside ? av <= 1e-7 : av >= -1e-7,
      keepB = inside ? bv <= 1e-7 : bv >= -1e-7;
    if (keepA) result.push(a);
    if (keepA !== keepB) {
      const t = av / (av - bv);
      result.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return result;
}
/** Subtract convex canyon rectangles exactly; no stair-stepped grid edges or giant physics mesh. */
export interface TerrainCut {
  p: { x: number; z: number };
  t: { x: number; z: number };
  n: { x: number; z: number };
  halfWidth: number;
  halfLength: number;
}
export function cutTerrain(cuts: TerrainCut[], y: number, extent = 320, boundary?: GroundPoint[]) {
  let polygons: GroundPoint[][] = [
    boundary ?? [
      { x: -extent, z: -extent },
      { x: -extent, z: extent },
      { x: extent, z: extent },
      { x: extent, z: -extent },
    ],
  ];
  for (const bridge of cuts) {
    const outside: GroundPoint[][] = [];
    for (const polygon of polygons) {
      let remainder = polygon;
      for (const [normal, distance] of [
        [bridge.n, bridge.halfWidth],
        [{ x: -bridge.n.x, z: -bridge.n.z }, bridge.halfWidth],
        [bridge.t, bridge.halfLength],
        [{ x: -bridge.t.x, z: -bridge.t.z }, bridge.halfLength],
      ] as const) {
        const limit = bridge.p.x * normal.x + bridge.p.z * normal.z + distance;
        const piece = halfPlane(remainder, normal.x, normal.z, limit, false);
        if (piece.length >= 3) outside.push(piece);
        remainder = halfPlane(remainder, normal.x, normal.z, limit, true);
        if (remainder.length < 3) break;
      }
    }
    polygons = outside;
  }
  const vertices: number[] = [],
    indices: number[] = [];
  for (const polygon of polygons) {
    const offset = vertices.length / 3;
    for (const p of polygon) vertices.push(p.x, y, p.z);
    for (let i = 1; i < polygon.length - 1; i++) {
      const a = polygon[0],
        b = polygon[i],
        c = polygon[i + 1];
      if (Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) > 1e-7)
        indices.push(offset, offset + i, offset + i + 1);
    }
  }
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}
