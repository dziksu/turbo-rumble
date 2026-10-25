import * as T from 'three';
import { SceneryModel } from './scenery-geometry.ts';
import type { Track } from '../shared/track.ts';

function leaf(
  m: SceneryModel,
  root: T.Vector3,
  angle: number,
  length: number,
  width: number,
  rise: number,
  color: string,
) {
  const vertices: number[] = [];
  const point = (u: number, side: number) => {
    const spread = Math.sin(u * Math.PI) * width * side,
      d = u * length;
    return [
      root.x + Math.sin(angle) * d + Math.cos(angle) * spread,
      root.y + Math.sin(u * Math.PI) * rise - u * u * 0.8,
      root.z + Math.cos(angle) * d - Math.sin(angle) * spread,
    ];
  };
  for (let i = 0; i < 3; i++) {
    const a = point(i / 3, -1),
      b = point(i / 3, 1),
      c = point((i + 1) / 3, -1),
      d = point((i + 1) / 3, 1);
    vertices.push(...a, ...c, ...b, ...b, ...c, ...d);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
  g.computeVertexNormals();
  m.add(g, color);
}
export function tropicalTree(kind: number) {
  const m = new SceneryModel();
  if (kind === 2) {
    m.beam(new T.Vector3(), new T.Vector3(0.2, 9.5, 0.3), 0.4, '#63563b', 6);
    for (let i = 0; i < 5; i++) {
      const a = i * 2.4,
        end = new T.Vector3(Math.sin(a) * 2, 7.2 + i * 0.45, Math.cos(a) * 2);
      m.beam(new T.Vector3(0, 5.6, 0), end, 0.17, '#6a6242');
      m.rock(3.2, 2.7, 3.1, end.x, end.y + 0.8, end.z, i % 2 ? '#6d9842' : '#3f7946');
    }
  } else {
    const lean = kind === 1 ? 2.7 : 0.7,
      h = kind === 1 ? 12 : 10.5;
    let previous = new T.Vector3();
    for (let i = 1; i <= 6; i++) {
      const u = i / 6,
        p = new T.Vector3(lean * u * u, h * u, Math.sin(u * 1.7) * lean * 0.32);
      m.beam(previous, p, 0.33 - u * 0.1, i % 2 ? '#9a7c4c' : '#785c3c', 6);
      previous = p;
    }
    const crown = new T.Vector3(lean, h, Math.sin(1.7) * lean * 0.32);
    for (let i = 0; i < 8; i++)
      leaf(
        m,
        crown,
        (i * Math.PI) / 4 + (kind ? 0.2 : 0),
        4.4 + (i % 3) * 0.45,
        0.72,
        1.15 + (i % 2) * 0.6,
        i % 2 ? '#6aa344' : '#35804b',
      );
    for (let i = 0; i < 3; i++)
      m.rock(
        0.3,
        0.4,
        0.28,
        crown.x + Math.sin(i * 2.1) * 0.38,
        h - 0.55,
        crown.z + Math.cos(i * 2.1) * 0.38,
        '#a88c45',
      );
  }
  return m.finish();
}
export function tropicalPlant(flower = false) {
  const m = new SceneryModel();
  for (let i = 0; i < 7; i++)
    leaf(
      m,
      new T.Vector3(0, 0.95, 0),
      i * 2.4,
      flower ? 1.45 : 2.2,
      flower ? 0.35 : 0.65,
      flower ? 0.25 : 1.1,
      i % 2 ? '#78a943' : '#3d8150',
    );
  if (flower)
    for (let i = 0; i < 3; i++) {
      const x = Math.sin(i * 2.4) * 0.6,
        z = Math.cos(i * 2.4) * 0.6;
      m.beam(new T.Vector3(x, 0.12, z), new T.Vector3(x, 1.5, z), 0.045, '#477a45');
      for (let j = 0; j < 5; j++) {
        const a = j * 1.26,
          dx = Math.sin(a),
          dz = Math.cos(a),
          px = x + dx * 0.28,
          pz = z + dz * 0.28;
        const g = new T.BufferGeometry();
        g.setAttribute(
          'position',
          new T.Float32BufferAttribute(
            [
              x,
              1.48,
              z,
              px + dz * 0.2,
              1.53,
              pz - dx * 0.2,
              x + dx * 0.65,
              1.48,
              z + dz * 0.65,
              x,
              1.48,
              z,
              x + dx * 0.65,
              1.48,
              z + dz * 0.65,
              px - dz * 0.2,
              1.53,
              pz + dx * 0.2,
            ],
            3,
          ),
        );
        g.computeVertexNormals();
        m.add(g, i % 2 ? '#f2b54a' : '#d76b49');
      }
      m.cone(0.12, 0.3, x, 1.62, z, '#ffd66b', 5);
    }
  return m.finish();
}
export function basaltRock(columns = false) {
  const m = new SceneryModel();
  if (columns)
    for (let i = 0; i < 4; i++) {
      const h = 2.2 + (i % 3) * 1.6;
      m.add(
        new T.CylinderGeometry(0.65, 0.85, h, 6),
        i % 2 ? '#485052' : '#343f45',
        new T.Vector3(Math.sin(i * 2.4) * 0.9, h / 2, Math.cos(i * 2.4) * 0.8),
      );
    }
  else {
    m.rock(1.65, 1.3, 1.35, 0, 0.82, 0, '#3c484d');
    m.rock(0.9, 0.85, 0.88, 1, 0.5, 0.3, '#59625c');
    m.rock(1.15, 0.18, 0.75, -0.1, 1.93, 0.1, '#666e5b');
  }
  return m.finish();
}
export function beachFurniture() {
  const m = new SceneryModel();
  for (const x of [-1.2, 1.2]) m.box(0.15, 2.7, 0.15, x, 1.35, 0, '#977445');
  m.box(3, 0.18, 0.18, 0, 1.5, 0, '#a38a5a');
  for (let i = 0; i < 3; i++) {
    m.rock(0.31, 1.7, 0.15, -0.8 + i * 0.8, 1.45, 0.35, i % 2 ? '#ce7450' : '#e9bd5a');
    m.box(0.16, 0.8, 0.17, -0.8 + i * 0.8, 1.2, 0.54, '#416d73');
  }
  m.rock(0.9, 0.28, 2.5, 3, 0.35, 0, '#bd9b62');
  m.rock(0.63, 0.2, 2.1, 3, 0.53, 0, '#745740');
  m.beam(new T.Vector3(3.8, 0.65, -1), new T.Vector3(5.2, 0.65, 1.6), 0.08, '#b7a06d');
  return m.finish();
}

/** Subdivide the exact visual terrain without changing the shared collision mesh or its cuts. */
export function tropicalGround(source: T.BufferGeometry) {
  const pos: number[] = [],
    colors: number[] = [],
    c = new T.Color();
  const ash = new T.Color('#39474a'),
    green = new T.Color('#527947'),
    sand = new T.Color('#d8bf83');
  const input = source.getAttribute('position'),
    idx = source.index;
  const read = (i: number) => new T.Vector3().fromBufferAttribute(input, idx ? idx.getX(i) : i);
  const emit = (a: T.Vector3, b: T.Vector3, d: T.Vector3) => {
    if (
      Math.max(a.distanceToSquared(b), b.distanceToSquared(d), d.distanceToSquared(a)) >
      36 ** 2
    ) {
      const ab = a.clone().add(b).multiplyScalar(0.5),
        bd = b.clone().add(d).multiplyScalar(0.5),
        da = d.clone().add(a).multiplyScalar(0.5);
      emit(a, ab, da);
      emit(ab, b, bd);
      emit(da, bd, d);
      emit(ab, bd, da);
      return;
    }
    for (const p of [a, b, d]) {
      const r = Math.hypot(p.x, p.z),
        vegetation =
          Math.max(0, Math.min(1, (r - 65) / 32)) *
          (0.65 + 0.15 * Math.sin(p.x * 0.041) + 0.12 * Math.cos(p.z * 0.036));
      c.copy(ash)
        .lerp(green, vegetation)
        .lerp(sand, T.MathUtils.smoothstep(r, 214, 233));
      pos.push(p.x, p.y, p.z);
      colors.push(c.r, c.g, c.b);
    }
  };
  for (let i = 0; i < (idx?.count ?? input.count); i += 3) emit(read(i), read(i + 1), read(i + 2));
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  source.dispose();
  return g;
}
const RADII = [70, 57, 43, 31, 26, 19],
  HEIGHTS = [-0.18, 8, 23, 42, 49, 43.2],
  SECTORS = 48;
export function craterPoint(track: Track, ring: number, sector: number) {
  const angle = (sector / SECTORS) * Math.PI * 2,
    variation = ring === 5 ? 0 : Math.sin(angle * 5 + 0.6) * 1.8 + Math.cos(angle * 9) * 0.8;
  const r = RADII[ring] + variation * (ring < 3 ? 1.7 : 0.7);
  return new T.Vector3(
    Math.sin(angle) * r,
    HEIGHTS[ring] + (ring === 0 || ring === 5 ? 0 : variation),
    Math.cos(angle) * r,
  ).add(track.OVERVIEW_CENTER);
}
export function craterGeometry(track: Track) {
  const pos: number[] = [],
    col: number[] = [],
    indices: number[] = [],
    c = new T.Color();
  for (let ring = 0; ring < RADII.length; ring++)
    for (let i = 0; i <= SECTORS; i++) {
      const p = craterPoint(track, ring, i);
      pos.push(p.x, p.y, p.z);
      c.set(ring > 2 ? (i % 3 ? '#514a44' : '#6e5e4a') : i % 3 ? '#333f44' : '#4a5352');
      col.push(c.r, c.g, c.b);
      if (ring && i) {
        const a = (ring - 1) * (SECTORS + 1) + i - 1,
          b = ring * (SECTORS + 1) + i - 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  g.setIndex(indices);
  const flat = g.toNonIndexed();
  g.dispose();
  flat.computeVertexNormals();
  return flat;
}
