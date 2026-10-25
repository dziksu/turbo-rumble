import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
const UP = new T.Vector3(0, 1, 0);
/** One vertex-coloured low-poly prototype, reused by every instance of its species. */
export class SceneryModel {
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

/** Bake only owned opaque static meshes. Keep animated group identities and shared sources. */
export function bakeStaticScenery(root: T.Group, prefix = 'forest', cellSize = 96) {
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
      if (parent.userData.forestDynamic || parent.userData.sceneryDynamic) return;
      parent = parent.parent;
    }
    const material = node.material;
    if (
      !(material instanceof T.MeshStandardMaterial) ||
      material.transparent ||
      material.map ||
      material.side !== T.FrontSide ||
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
  library.name = prefix + '-baked-sources';
  library.visible = false;
  library.matrixAutoUpdate = false;
  library.userData.sceneryDynamic = true;
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
    mesh.name = prefix + '-baked-landmark';
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
  }
  if (!groups.size) material.dispose();
  return groups.size;
}
