import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const UP = new T.Vector3(0, 1, 0);
/** One vertex-coloured low-poly prototype, reused by every instance of its species. */
export class ForestModel {
  private parts: T.BufferGeometry[] = [];
  add(
    g: T.BufferGeometry,
    color: string,
    p = new T.Vector3(),
    q = new T.Quaternion(),
    scale = new T.Vector3(1, 1, 1),
  ) {
    const geometry = g.index ? g.toNonIndexed() : g;
    if (geometry !== g) g.dispose();
    geometry.deleteAttribute('uv');
    geometry.applyMatrix4(new T.Matrix4().compose(p, q, scale));
    const c = new T.Color(color),
      colors = new Float32Array(geometry.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = c.r;
      colors[i + 1] = c.g;
      colors[i + 2] = c.b;
    }
    geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
    this.parts.push(geometry);
  }
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: string, yaw = 0) {
    this.add(
      new T.BoxGeometry(w, h, d),
      color,
      new T.Vector3(x, y, z),
      new T.Quaternion().setFromAxisAngle(UP, yaw),
    );
  }
  cone(r: number, h: number, x: number, y: number, z: number, color: string, sides = 6) {
    this.add(new T.ConeGeometry(r, h, sides), color, new T.Vector3(x, y, z));
  }
  rock(w: number, h: number, d: number, x: number, y: number, z: number, color: string) {
    this.add(
      new T.IcosahedronGeometry(1, 0),
      color,
      new T.Vector3(x, y, z),
      new T.Quaternion(),
      new T.Vector3(w, h, d),
    );
  }
  beam(a: T.Vector3, b: T.Vector3, radius: number, color: string, sides = 5) {
    const delta = b.clone().sub(a);
    this.add(
      new T.CylinderGeometry(radius * 0.8, radius, delta.length(), sides),
      color,
      a.clone().add(b).multiplyScalar(0.5),
      new T.Quaternion().setFromUnitVectors(UP, delta.normalize()),
    );
  }
  finish() {
    const result = mergeGeometries(this.parts)!;
    for (const p of this.parts) p.dispose();
    this.parts = [];
    result.computeBoundingSphere();
    return result;
  }
}

export function forestTree(kind: number) {
  const m = new ForestModel();
  if (kind === 2) {
    m.beam(new T.Vector3(), new T.Vector3(0.35, 11, 0), 0.32, '#d5d5b9');
    for (let i = 0; i < 7; i++) m.box(0.42, 0.13, 0.64, 0.18, i * 1.3 + 0.7, 0, '#4b5446', i * 0.7);
    for (let i = 0; i < 5; i++) {
      const a = i * 2.4,
        y = 7.5 + i * 0.9;
      m.beam(
        new T.Vector3(0.15, y - 1, 0),
        new T.Vector3(Math.sin(a) * 2.1, y, Math.cos(a) * 2.1),
        0.11,
        '#b7bba1',
      );
      m.rock(
        2.9,
        2.2,
        2.7,
        Math.sin(a) * 1.7,
        y + 0.8,
        Math.cos(a) * 1.7,
        i % 2 ? '#748a41' : '#a5b65a',
      );
    }
  } else {
    const h = kind ? 15 : 12.5;
    m.beam(new T.Vector3(), new T.Vector3(0, h * 0.8, 0), 0.39, '#6c5140');
    for (let i = 0; i < 4; i++) {
      const r = (kind ? 3.8 : 4.1) - i * 0.73,
        y = 3.5 + i * (kind ? 2.65 : 2.1);
      m.cone(
        r,
        kind ? 6.1 : 5.4,
        0,
        y + 2.4,
        0,
        (kind
          ? ['#244e43', '#326354', '#487951', '#6b9458']
          : ['#1f4a36', '#2f5b3c', '#477346', '#6d8b49'])[i],
      );
    }
    for (let i = 0; i < 3; i++)
      m.beam(
        new T.Vector3(0, 2.6 + i * 0.7, 0),
        new T.Vector3(i % 2 ? 1.5 : -1.5, 2.9 + i * 0.8, 0),
        0.1,
        '#72563d',
      );
  }
  return m.finish();
}
export function forestRock() {
  const m = new ForestModel();
  m.rock(1, 0.8, 0.8, 0, 0.52, 0, '#717e7a');
  m.rock(0.7, 0.6, 0.72, 0.32, 0.42, 0.12, '#89918a');
  m.rock(0.76, 0.12, 0.64, -0.05, 1.03, 0.05, '#6e8950');
  m.rock(0.4, 0.08, 0.44, 0.45, 0.82, 0.15, '#9da25c');
  return m.finish();
}
export function forestFern(mushroom = false) {
  const m = new ForestModel();
  if (mushroom) {
    for (let i = 0; i < 3; i++) {
      const x = Math.sin(i * 2.4) * 0.4,
        z = Math.cos(i * 2.4) * 0.4;
      m.beam(new T.Vector3(x, 0, z), new T.Vector3(x, 0.35 + i * 0.14, z), 0.07, '#d9d3ab');
      m.add(
        new T.SphereGeometry(0.3, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2),
        '#ac6748',
        new T.Vector3(x, 0.35 + i * 0.14, z),
      );
    }
  } else
    for (let j = 0; j < 7; j++) {
      const a = (j * Math.PI * 2) / 7,
        c = Math.cos(a),
        s = Math.sin(a);
      const geometry = new T.BufferGeometry();
      const vertices: number[] = [];
      for (let i = 0; i < 3; i++) {
        const t = (i + 1) / 3,
          x = s * t * 1.25,
          z = c * t * 1.25,
          y = 0.12 + Math.sin(t * Math.PI) * 0.65;
        vertices.push(0, 0.12, 0, x - c * 0.26, y, z + s * 0.26, x + c * 0.26, y, z - s * 0.26);
      }
      geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
      geometry.computeVertexNormals();
      m.add(geometry, j % 2 ? '#77954b' : '#456f43');
    }
  return m.finish();
}
export function forestLog(stump = false) {
  const m = new ForestModel();
  if (stump) {
    m.beam(new T.Vector3(), new T.Vector3(0, 1.5, 0), 0.85, '#65503b', 7);
    m.add(new T.CylinderGeometry(0.68, 0.7, 0.12, 7), '#c4aa73', new T.Vector3(0, 1.52, 0));
    m.add(new T.CylinderGeometry(0.37, 0.4, 0.14, 7), '#9b8058', new T.Vector3(0, 1.54, 0));
    for (let i = 0; i < 4; i++)
      m.beam(
        new T.Vector3(),
        new T.Vector3(Math.sin(i * 1.6) * 1.3, 0.06, Math.cos(i * 1.6) * 1.3),
        0.21,
        '#66513b',
      );
  } else {
    m.beam(new T.Vector3(0, 0.5, -2.8), new T.Vector3(0, 0.5, 2.8), 0.5, '#6b5038', 7);
    for (const side of [-1, 1])
      m.add(
        new T.CircleGeometry(0.44, 7),
        '#d3b57c',
        new T.Vector3(0, 0.5, side * 2.81),
        new T.Quaternion().setFromAxisAngle(UP, side < 0 ? Math.PI : 0),
      );
    m.rock(0.38, 0.12, 2, 0, 0.97, 0, '#6f8848');
    m.beam(new T.Vector3(0, 0.5, -0.7), new T.Vector3(1.2, 1.2, -1), 0.12, '#71543a');
  }
  return m.finish();
}
export function deerBody() {
  const m = new ForestModel();
  m.rock(0.66, 0.78, 1.45, 0, 1.62, 0, '#ad8356');
  m.rock(0.46, 0.65, 0.6, 0, 1.56, 0.72, '#d2b482');
  for (const x of [-0.38, 0.38])
    for (const z of [-0.88, 0.85]) {
      m.beam(new T.Vector3(x, 0.14, z), new T.Vector3(x, 1.45, z), 0.105, '#96734e');
      m.box(0.2, 0.21, 0.28, x, 0.12, z, '#3e3b30');
    }
  m.rock(0.19, 0.3, 0.34, 0, 1.8, -1.38, '#e0d5b1');
  return m.finish();
}
export const DEER_HEAD_PIVOT = new T.Vector3(0, 1.82, 0.74);
export function deerHead(stag = false) {
  const m = new ForestModel();
  m.beam(new T.Vector3(0, 1.8, 0.72), new T.Vector3(0, 2.65, 1.15), 0.27, '#ad8356');
  m.rock(0.32, 0.34, 0.61, 0, 2.7, 1.28, '#b58d5c');
  m.rock(0.19, 0.17, 0.22, 0, 2.57, 1.82, '#443a2d');
  for (const side of [-1, 1]) {
    m.beam(
      new T.Vector3(side * 0.19, 2.94, 1.03),
      new T.Vector3(side * 0.52, 3.3, 1.02),
      0.13,
      '#c4a274',
    );
    m.box(0.06, 0.1, 0.1, side * 0.285, 2.8, 1.52, '#222f28');
    if (stag) {
      const a = new T.Vector3(side * 0.17, 2.95, 1.05),
        b = new T.Vector3(side * 0.5, 3.85, 0.72);
      m.beam(a, b, 0.065, '#d2bd92');
      m.beam(
        new T.Vector3(side * 0.36, 3.5, 0.86),
        new T.Vector3(side * 0.8, 3.85, 1.12),
        0.045,
        '#d2bd92',
      );
      m.beam(
        new T.Vector3(side * 0.43, 3.7, 0.78),
        new T.Vector3(side * 0.26, 4.02, 0.55),
        0.04,
        '#d2bd92',
      );
    }
  }
  const result = m.finish();
  result.translate(-DEER_HEAD_PIVOT.x, -DEER_HEAD_PIVOT.y, -DEER_HEAD_PIVOT.z);
  return result;
}
export function forestFox() {
  const m = new ForestModel();
  m.rock(0.38, 0.43, 0.94, 0, 0.75, 0, '#b96d3b');
  for (const x of [-0.23, 0.23])
    for (const z of [-0.53, 0.53])
      m.beam(new T.Vector3(x, 0.08, z), new T.Vector3(x, 0.72, z), 0.075, '#3b3c30');
  m.rock(0.29, 0.33, 0.46, 0, 1.12, 0.69, '#c77d42');
  m.cone(0.17, 0.47, -0.22, 1.54, 0.62, '#b16b3c', 4);
  m.cone(0.17, 0.47, 0.22, 1.54, 0.62, '#b16b3c', 4);
  m.rock(0.18, 0.17, 0.3, 0, 1.02, 1, '#e3d3ad');
  m.box(0.12, 0.12, 0.12, 0, 1.03, 1.24, '#26352d');
  m.beam(new T.Vector3(0, 0.7, -0.7), new T.Vector3(0.34, 0.42, -1.55), 0.23, '#c07b43');
  m.beam(new T.Vector3(0.3, 0.44, -1.35), new T.Vector3(0.43, 0.35, -1.8), 0.18, '#dfd9b8');
  for (const side of [-1, 1]) m.box(0.04, 0.08, 0.09, side * 0.26, 1.19, 0.82, '#25342d');
  return m.finish();
}

/** Bake only owned opaque static meshes. Keep animated group identities and shared sources. */
export function bakeForestStatics(root: T.Group, cellSize = 96) {
  root.updateWorldMatrix(true, true);
  const inverse = root.matrixWorld.clone().invert(),
    groups = new Map<string, T.BufferGeometry[]>(),
    sources: T.Mesh[] = [];
  root.traverse((node) => {
    if (
      !(node instanceof T.Mesh) ||
      node instanceof T.InstancedMesh ||
      node.name === 'biome-drivable-ground'
    )
      return;
    let parent: T.Object3D | null = node;
    while (parent && parent !== root) {
      if (parent.userData.forestDynamic) return;
      parent = parent.parent;
    }
    const material = node.material;
    if (
      !(material instanceof T.MeshStandardMaterial) ||
      material.transparent ||
      material.map ||
      material.roughness < 0.7
    )
      return;
    const g = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
    g.deleteAttribute('uv');
    g.deleteAttribute('uv1');
    g.applyMatrix4(inverse.clone().multiply(node.matrixWorld));
    const colors = new Float32Array(g.getAttribute('position').count * 3),
      c = material.color;
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = c.r;
      colors[i + 1] = c.g;
      colors[i + 2] = c.b;
    }
    g.setAttribute('color', new T.BufferAttribute(colors, 3));
    const center = new T.Vector3().setFromMatrixPosition(node.matrixWorld).applyMatrix4(inverse);
    const key = `${Math.floor(center.x / cellSize)}/${Math.floor(center.z / cellSize)}/${node.castShadow}`;
    const list = groups.get(key) ?? [];
    list.push(g);
    groups.set(key, list);
    sources.push(node);
  });
  const library = new T.Group();
  library.name = 'forest-baked-sources';
  library.visible = false;
  library.matrixAutoUpdate = false;
  library.userData.forestDynamic = true;
  for (const node of sources) {
    node.matrixAutoUpdate = false;
    library.add(node);
  }
  root.add(library);
  const material = new T.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    flatShading: true,
  });
  for (const [key, parts] of groups) {
    const g = mergeGeometries(parts)!;
    parts.forEach((p) => p.dispose());
    g.computeBoundingSphere();
    const mesh = new T.Mesh(g, material);
    mesh.castShadow = key.endsWith('/true');
    mesh.receiveShadow = true;
    mesh.name = 'forest-baked-landmark';
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
  }
  if (!groups.size) material.dispose();
  return groups.size;
}

/** Continuous moss/needle colour on the real terrain; no overlapping decal planes. */
export function forestGround(source: T.BufferGeometry) {
  const positions: number[] = [],
    colors: number[] = [];
  const dark = new T.Color('#38573e'),
    light = new T.Color('#516d45'),
    color = new T.Color();
  const input = source.getAttribute('position'),
    index = source.index;
  const read = (i: number) => new T.Vector3().fromBufferAttribute(input, index ? index.getX(i) : i);
  const emit = (a: T.Vector3, b: T.Vector3, c: T.Vector3) => {
    if (
      Math.max(a.distanceToSquared(b), b.distanceToSquared(c), c.distanceToSquared(a)) >
      48 ** 2
    ) {
      const ab = a.clone().add(b).multiplyScalar(0.5),
        bc = b.clone().add(c).multiplyScalar(0.5),
        ca = c.clone().add(a).multiplyScalar(0.5);
      emit(a, ab, ca);
      emit(ab, b, bc);
      emit(ca, bc, c);
      emit(ab, bc, ca);
      return;
    }
    for (const p of [a, b, c]) {
      const n =
        0.5 +
        0.22 * Math.sin(p.x * 0.035 + Math.cos(p.z * 0.021)) +
        0.13 * Math.cos(p.z * 0.054 + p.x * 0.018);
      color.lerpColors(dark, light, n);
      positions.push(p.x, p.y, p.z);
      colors.push(color.r, color.g, color.b);
    }
  };
  for (let i = 0; i < (index?.count ?? input.count); i += 3)
    emit(read(i), read(i + 1), read(i + 2));
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  source.dispose();
  return geometry;
}
