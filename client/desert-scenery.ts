import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  DESERT_GROUND_Y,
  CORRAL_FENCE_HEIGHT,
  desertElevation,
  type DesertObject,
  type DesertBuilding,
} from '../shared/desert-layout.ts';
import type { Track } from '../shared/track.ts';
import { disposeResources } from './resources.ts';

const material = (color: string) =>
  new T.MeshStandardMaterial({ color, roughness: 1, flatShading: true });
const UP = new T.Vector3(0, 1, 0);

/** Bake village details by colour and 80 m cell; no per-plank draws or scene updates. */
class StaticScenery {
  private batches = new Map<string, { color: string; geometries: T.BufferGeometry[] }>();
  add(
    geometry: T.BufferGeometry,
    position: T.Vector3,
    color: string,
    rotation = new T.Quaternion(),
  ) {
    if (geometry.index) {
      const plain = geometry.toNonIndexed();
      geometry.dispose();
      geometry = plain;
    }
    geometry.deleteAttribute('uv');
    geometry.applyMatrix4(new T.Matrix4().compose(position, rotation, new T.Vector3(1, 1, 1)));
    const key = `${color}/${Math.floor(position.x / 80)}/${Math.floor(position.z / 80)}`;
    let batch = this.batches.get(key);
    if (!batch) {
      batch = { color, geometries: [] };
      this.batches.set(key, batch);
    }
    batch.geometries.push(geometry);
  }
  box(size: T.Vector3, p: T.Vector3, color: string, yaw = 0) {
    this.add(
      new T.BoxGeometry(size.x, size.y, size.z),
      p,
      color,
      new T.Quaternion().setFromAxisAngle(UP, yaw),
    );
  }
  beam(a: T.Vector3, b: T.Vector3, width: number, color: string) {
    const d = b.clone().sub(a);
    this.add(
      new T.CylinderGeometry(width, width, d.length(), 5),
      a.clone().add(b).multiplyScalar(0.5),
      color,
      new T.Quaternion().setFromUnitVectors(UP, d.normalize()),
    );
  }
  finish(root: T.Group) {
    for (const { color, geometries } of this.batches.values()) {
      const merged = mergeGeometries(geometries);
      for (const source of geometries) source.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new T.Mesh(merged, material(color));
      mesh.name = 'sundown-baked-scenery';
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      root.add(mesh);
    }
    this.batches.clear();
  }
}

export function desertAssetMatrix(
  bounds: T.Box3,
  object: Pick<DesertObject, 'position' | 'size' | 'yaw'>,
) {
  const size = bounds.getSize(new T.Vector3()),
    center = bounds.getCenter(new T.Vector3());
  return new T.Matrix4()
    .compose(
      object.position,
      new T.Quaternion().setFromAxisAngle(UP, object.yaw),
      new T.Vector3(object.size.x / size.x, object.size.y / size.y, object.size.z / size.z),
    )
    .multiply(new T.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z));
}

function building(batch: StaticScenery, b: DesertBuilding) {
  const { x: w, y: h, z: d } = b.size;
  const q = new T.Quaternion().setFromAxisAngle(UP, b.yaw);
  const at = (x: number, y: number, z: number) =>
    new T.Vector3(x, y, z).applyQuaternion(q).add(b.position);
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: string) =>
    batch.box(new T.Vector3(w, h, d), at(x, y, z), c, b.yaw);
  const wall = b.kind === 'church' ? '#d5b67b' : b.kind === 'store' ? '#b78548' : '#916035';
  box(w, h, d, 0, h / 2, 0, wall);
  // Pitched corrugated roof, false western storefront and shaded timber porch.
  const roof = new T.BufferGeometry();
  const rw = w / 2 + 0.65,
    rd = d / 2 + 0.6;
  roof.setAttribute(
    'position',
    new T.Float32BufferAttribute(
      [
        -rw,
        h,
        -rd,
        0,
        h + 2,
        -rd,
        -rw,
        h,
        rd,
        -rw,
        h,
        rd,
        0,
        h + 2,
        -rd,
        0,
        h + 2,
        rd,
        0,
        h + 2,
        -rd,
        rw,
        h,
        -rd,
        0,
        h + 2,
        rd,
        0,
        h + 2,
        rd,
        rw,
        h,
        -rd,
        rw,
        h,
        rd,
      ],
      3,
    ),
  );
  roof.computeVertexNormals();
  batch.add(roof, b.position, '#51453a', q);
  if (b.kind !== 'church') box(w + 0.6, 2.5, 0.45, 0, h + 0.3, d / 2 + 0.1, wall);
  box(w + 1, 0.26, 3.3, 0, 0.18, d / 2 + 1.6, '#926337');
  box(w + 1, 0.22, 3.3, 0, 3.3, d / 2 + 1.6, '#75462d');
  for (const x of [-w / 2 + 0.3, w / 2 - 0.3]) box(0.25, 3.3, 0.25, x, 1.65, d / 2 + 3, '#51453a');
  for (const x of [-w * 0.3, w * 0.3]) {
    box(2.1, 2.4, 0.12, x, 2.1, d / 2 + 0.07, '#e2c18a');
    box(1.7, 2, 0.14, x, 2.1, d / 2 + 0.16, '#35443f');
    box(0.09, 2, 0.17, x, 2.1, d / 2 + 0.22, '#e2c18a');
  }
  box(1.6, 2.7, 0.16, 0, 1.5, d / 2 + 0.12, '#51453a');
  for (let y = 0.9; y < h; y += 0.9) box(w, 0.055, 0.035, 0, y, d / 2 + 0.03, '#75462d');
  if (b.kind === 'church') {
    box(2.7, 5, 2.7, 0, h + 1, d * 0.24, '#d5b67b');
    batch.add(new T.ConeGeometry(2.2, 3.5, 4), at(0, h + 5.2, d * 0.24), '#51453a', q);
    box(0.18, 2, 0.18, 0, h + 7.8, d * 0.24, '#51453a');
    box(1.2, 0.18, 0.18, 0, h + 8.1, d * 0.24, '#51453a');
  }
}

export function addDesertTerrain(root: T.Group, track: Track, label: (text: string) => T.Sprite) {
  const layout = track.desert;
  if (!layout) return null;
  const data = track.terrainGeometry()!;
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.BufferAttribute(data.vertices, 3));
  geometry.setIndex(new T.BufferAttribute(data.indices, 1));
  geometry.computeVertexNormals();
  const terrain = new T.Mesh(geometry, material('#b75c2d'));
  terrain.name = 'desert-drivable-ground';
  terrain.receiveShadow = true;
  root.add(terrain);
  const batch = new StaticScenery();
  for (const b of layout.buildings) building(batch, b);
  // Four shared low-poly strata. A whole mesa costs no extra draw call.
  for (let layer = 0; layer < 4; layer++) {
    const rock = new T.InstancedMesh(
      new T.CylinderGeometry(0.86, 1, 1, 7, 1),
      material(['#9b4027', '#b9542b', '#cd6630', '#e78944'][layer]),
      layout.landforms.length * 8,
    );
    for (const [i, m] of layout.landforms.entries()) {
      const h = m.height / 4,
        r = m.radius * (1 - layer * 0.13);
      rock.setMatrixAt(
        i * 8,
        new T.Matrix4().compose(
          m.position.clone().add(new T.Vector3(layer * 0.45, h * (layer + 0.5), 0)),
          new T.Quaternion().setFromAxisAngle(UP, m.yaw + layer * 0.035),
          new T.Vector3(r, h, r),
        ),
      );
      for (let column = 0; column < 7; column++) {
        const angle = (column * Math.PI * 2) / 7 + m.yaw,
          cr = r * 0.32,
          ch = h * (0.9 + (column % 3) * 0.1);
        const p = m.position
          .clone()
          .add(
            new T.Vector3(
              Math.sin(angle) * r * 0.69,
              h * layer + ch * 0.5,
              Math.cos(angle) * r * 0.69,
            ),
          );
        rock.setMatrixAt(
          i * 8 + column + 1,
          new T.Matrix4().compose(
            p,
            new T.Quaternion().setFromAxisAngle(UP, angle + layer * 0.07),
            new T.Vector3(cr, ch, cr),
          ),
        );
        rock.setColorAt(i * 8 + column + 1, new T.Color().setScalar(0.83 + (column % 3) * 0.08));
      }
    }
    rock.castShadow = rock.receiveShadow = true;
    rock.computeBoundingSphere();
    rock.name = 'sundown-sandstone-strata';
    root.add(rock);
  }
  // Real canyon cut: vertical red banks terminate at the exact collision opening.
  for (const cut of layout.cuts)
    for (const side of [-1, 1]) {
      const p = cut.p.clone().addScaledVector(cut.t, side * (cut.halfLength + 0.65));
      const top = desertElevation(p.z) + DESERT_GROUND_Y;
      batch.box(
        new T.Vector3(cut.halfWidth * 2, top + 7.3, 1.3),
        new T.Vector3(p.x, (top - 7.3) / 2, p.z),
        '#9b4027',
        cut.yaw,
      );
      for (let x = -cut.halfWidth + 4; x <= cut.halfWidth - 4; x += 7) {
        if (cut.width > 0 && Math.abs(x) < cut.width + 2) continue;
        const p = cut.p
          .clone()
          .addScaledVector(cut.n, x)
          .addScaledVector(cut.t, side * (cut.halfLength + 3.5));
        const y = desertElevation(p.z);
        batch.add(new T.CylinderGeometry(2.4, 3.4, 5 + (x % 3), 5), p.setY(y + 1), '#b9542b');
      }
    }
  for (const cut of layout.cuts.filter((c) => c.width === 0))
    for (const side of [-1, 1]) {
      // Piecewise faces follow exactly the same 20 m elevation breaks as the terrain.
      const from = cut.p.z - cut.halfLength,
        to = cut.p.z + cut.halfLength;
      const stops = [
        from,
        ...Array.from({ length: 33 }, (_, i) => -320 + i * 20).filter((z) => z > from && z < to),
        to,
      ];
      for (let i = 0; i < stops.length - 1; i++) {
        const x = cut.p.x + side * cut.halfWidth,
          z0 = stops[i],
          z1 = stops[i + 1];
        const y0 = desertElevation(z0) + DESERT_GROUND_Y,
          y1 = desertElevation(z1) + DESERT_GROUND_Y;
        const bank = new T.BufferGeometry();
        const v =
          side === 1
            ? [x, -7.5, z0, x, y0, z0, x, y1, z1, x, -7.5, z0, x, y1, z1, x, -7.5, z1]
            : [x, -7.5, z0, x, y1, z1, x, y0, z0, x, -7.5, z0, x, -7.5, z1, x, y1, z1];
        bank.setAttribute('position', new T.Float32BufferAttribute(v, 3));
        bank.computeVertexNormals();
        batch.add(bank, new T.Vector3(), '#9b4027');
      }
    }
  // Weathered rails and posts make the launch/landing silhouette legible.
  for (let s = 0; s < track.TRACK_LENGTH; s += 5) {
    if (!track.hasGuardrail(s)) continue;
    const a = track.trackAt(s);
    for (const side of [-1, 1]) {
      const p = a.p.clone().addScaledVector(a.n, side * (a.width + 0.45));
      batch.box(
        new T.Vector3(0.22, 1.35, 0.22),
        p.add(new T.Vector3(0, 0.65, 0)),
        '#51453a',
        a.yaw,
      );
    }
  }
  // Dirt racing grooves: opaque strips, one geometry, no texture/postprocessing passes.
  const grooves: number[] = [];
  for (let i = 0; i < track.SAMPLES; i++) {
    const s = (i / track.SAMPLES) * track.TRACK_LENGTH,
      end = ((i + 1) / track.SAMPLES) * track.TRACK_LENGTH;
    if (track.isGap((s + end) / 2, 0.8)) continue;
    const a = track.trackAt(s),
      b = track.trackAt(end);
    for (const lane of [-4.7, -2.9, 2.9, 4.7]) {
      const p = [
        a.p.clone().addScaledVector(a.n, lane - 0.07),
        b.p.clone().addScaledVector(b.n, lane - 0.07),
        b.p.clone().addScaledVector(b.n, lane + 0.07),
        a.p.clone().addScaledVector(a.n, lane + 0.07),
      ];
      for (const index of [0, 1, 2, 0, 2, 3])
        grooves.push(p[index].x, desertElevation(p[index].z) + 0.032, p[index].z);
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(grooves, 3));
  g.computeVertexNormals();
  const grooveMesh = new T.Mesh(g, material('#cb995e'));
  grooveMesh.receiveShadow = true;
  root.add(grooveMesh);
  for (const ramp of track.RAMPS) {
    const at = track.trackAt(ramp.s);
    // Planks sit on the exact sloping ramp; braces are baked with the village.
    for (let z = -ramp.length / 2 + 0.7; z < ramp.length / 2; z += 1.2) {
      const p = at.p.clone().addScaledVector(at.t, z).addScaledVector(at.n, ramp.side);
      p.y = desertElevation(p.z) + (z / ramp.length + 0.5) * ramp.height + 0.045;
      batch.box(new T.Vector3(ramp.width, 0.065, 0.16), p, '#75462d', at.yaw);
    }
  }
  // A water tower and windmill form readable landmarks without imported heavy buildings.
  for (const [u, side] of [
    [0.75, 1],
    [0.955, -1],
  ]) {
    const at = track.trackAt(u * track.TRACK_LENGTH),
      p = at.p.clone().addScaledVector(at.n, side * (at.width + 19));
    p.y = desertElevation(p.z);
    for (const x of [-2.3, 2.3])
      for (const z of [-2.3, 2.3])
        batch.beam(
          p.clone().add(new T.Vector3(x, 0, z)),
          p.clone().add(new T.Vector3(x * 0.65, 13, z * 0.65)),
          0.22,
          '#51453a',
        );
    for (const y of [3, 7, 11])
      for (const z of [-1.9, 1.9])
        batch.beam(
          p.clone().add(new T.Vector3(-2, y - 2, z)),
          p.clone().add(new T.Vector3(2, y + 2, z)),
          0.13,
          '#75462d',
        );
    if (u < 0.8) {
      batch.add(
        new T.CylinderGeometry(3.8, 3.8, 4.6, 12),
        p.clone().add(new T.Vector3(0, 14.7, 0)),
        '#916035',
      );
      batch.add(
        new T.ConeGeometry(4.2, 1.7, 12),
        p.clone().add(new T.Vector3(0, 17.8, 0)),
        '#51453a',
      );
      for (const y of [13, 15.8])
        batch.add(
          new T.CylinderGeometry(3.9, 3.9, 0.17, 12),
          p.clone().add(new T.Vector3(0, y, 0)),
          '#35443f',
        );
    } else
      for (let i = 0; i < 10; i++) {
        const angle = (i * Math.PI) / 5,
          center = p
            .clone()
            .add(new T.Vector3(Math.sin(angle) * 2.3, 14 + Math.cos(angle) * 2.3, 0));
        batch.add(
          new T.BoxGeometry(0.8, 2.4, 0.15),
          center,
          '#d5b67b',
          new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), -angle),
        );
      }
  }
  // All rails, posts and cattle are baked into the existing spatial/material batches.
  for (const [i, { a, b }] of layout.corral.fence.entries()) {
    const center = a.clone().add(b).multiplyScalar(0.5),
      yaw = Math.atan2(b.x - a.x, b.z - a.z);
    batch.box(
      new T.Vector3(0.32, CORRAL_FENCE_HEIGHT + 0.15, 0.32),
      a.clone().addScaledVector(UP, (CORRAL_FENCE_HEIGHT + 0.15) / 2),
      '#51453a',
    );
    for (const y of [0.65, 1.35, CORRAL_FENCE_HEIGHT - 0.1])
      batch.box(
        new T.Vector3(0.18, 0.22, a.distanceTo(b) + 0.15),
        center.clone().addScaledVector(UP, y),
        '#916035',
        yaw,
      );
    // Occasional diagonal braces make the closed ranch fence readable from the race camera.
    if (i % 8 === 0)
      batch.beam(
        a.clone().addScaledVector(UP, 0.65),
        b.clone().addScaledVector(UP, 2.1),
        0.09,
        '#916035',
      );
  }
  for (const [index, cow] of layout.corral.cattle.entries()) {
    const q = new T.Quaternion().setFromAxisAngle(UP, cow.yaw);
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: string) =>
      batch.box(
        new T.Vector3(w, h, d),
        new T.Vector3(x, y, z).applyQuaternion(q).add(cow.position),
        color,
        cow.yaw,
      );
    box(1.35, 1.15, 2.8, 0, 1.5, 0, '#e2c18a');
    for (const x of [-0.45, 0.45])
      for (const z of [-0.95, 0.95]) {
        box(0.24, 1.1, 0.26, x, 0.55, z, '#51453a');
        box(0.28, 0.2, 0.32, x, 0.1, z + 0.04, '#35443f');
      }
    box(0.85, 0.9, 1, 0, 1.7, 1.55, '#e2c18a');
    box(0.9, 0.4, 0.35, 0, 1.43, 2.04, '#916035');
    for (const side of [-1, 1]) {
      box(0.45, 0.18, 0.35, side * 0.54, 1.95, 1.42, '#51453a');
      box(0.12, 0.32, 0.12, side * 0.32, 2.25, 1.45, '#e2c18a');
      box(0.06, 0.12, 0.12, side * 0.44, 1.85, 1.85, '#35443f');
      box(0.04, 0.65, 0.9, side * 0.686, 1.65, index % 2 ? 0.5 : -0.6, '#51453a');
    }
    box(0.14, 1.3, 0.14, 0, 1, -1.47, '#51453a');
  }
  const trough = layout.corral.trough;
  batch.box(new T.Vector3(2, 0.8, 5), trough.clone().addScaledVector(UP, 0.4), '#51453a');
  batch.box(new T.Vector3(1.65, 0.04, 4.65), trough.clone().addScaledVector(UP, 0.82), '#5e9387');
  // Start-straight spectator stands face the corral from the outside of the road.
  for (const u of [0.025, 0.065, 0.975]) {
    const at = track.trackAt(u * track.TRACK_LENGTH);
    for (let row = 0; row < 3; row++)
      batch.box(
        new T.Vector3(1.7, 0.25, 15),
        at.p
          .clone()
          .addScaledVector(at.n, -(at.width + 4 + row * 1.7))
          .add(new T.Vector3(0, 0.5 + row * 0.8, 0)),
        '#916035',
        at.yaw,
      );
  }
  const f = layout.fountain;
  batch.add(
    new T.CylinderGeometry(3, 3.3, 0.8, 12),
    f.clone().add(new T.Vector3(0, 0.4, 0)),
    '#d5b67b',
  );
  batch.add(
    new T.CylinderGeometry(2.6, 2.6, 0.04, 12),
    f.clone().add(new T.Vector3(0, 0.82, 0)),
    '#5e9387',
  );
  batch.add(
    new T.CylinderGeometry(0.4, 0.65, 2.4, 8),
    f.clone().add(new T.Vector3(0, 1.5, 0)),
    '#d5b67b',
  );
  batch.finish(root);
  for (const mark of layout.landmarks) {
    const at = track.trackAt(mark.s),
      sign = label(mark.name);
    sign.position
      .copy(at.p)
      .addScaledVector(at.n, -at.width - 9)
      .add(new T.Vector3(0, 5.5, 0));
    root.add(sign);
  }
  return terrain;
}

export async function addDesertAssets(
  root: T.Group,
  track: Track,
  isCurrent: () => boolean,
  onError: () => void,
) {
  const layout = track.desert;
  if (!layout) return;
  const objects = [...layout.objects];
  const assets = ['cactus_tall', 'cactus_short', 'rock_smallC', 'plant_bushSmall', 'grass_large'];
  for (let i = 0; i < 1400; i++) {
    // Deterministic blue-noise-like placement; test all route segments, not only the nearby bend.
    const x = ((i * 97.37) % 540) - 270,
      z = ((i * 173.23) % 490) - 245;
    const p = new T.Vector3(x, desertElevation(z) + DESERT_GROUND_Y, z);
    if (layout.clearance(p) < 3 || layout.inCanyon(p, 3)) continue;
    if (layout.landforms.some((m) => Math.hypot(m.position.x - x, m.position.z - z) < m.radius + 1))
      continue;
    if (layout.buildings.some((b) => Math.hypot(b.position.x - x, b.position.z - z) < 12)) continue;
    if (layout.inCorral(p) && i % 5 !== 4) continue;
    const kind = i % 5,
      h = kind === 0 ? 4.5 + (i % 3) : kind === 1 ? 2.2 : kind === 2 ? 0.6 + (i % 3) * 0.3 : 0.75;
    const w = kind === 0 ? 2.2 : kind === 1 ? 1.5 : kind === 2 ? 1.6 : 1.4;
    objects.push({
      id: `desert-detail-${i}`,
      asset: `nature/${assets[kind]}`,
      position: p,
      size: new T.Vector3(w, h, w),
      yaw: i * 2.399,
      solid: false,
    });
  }
  const library = new T.Group();
  library.visible = false;
  library.name = 'desert-source-assets';
  root.add(library);
  const loader = new GLTFLoader();
  await Promise.all(
    [...new Set(objects.map((o) => o.asset))].map(async (asset) => {
      try {
        const gltf = await loader.loadAsync(`/assets/desert/${asset}.glb`);
        if (!isCurrent()) {
          disposeResources([gltf.scene]);
          return;
        }
        gltf.scene.updateWorldMatrix(true, true);
        const bounds = new T.Box3().setFromObject(gltf.scene);
        const cells = new Map<string, DesertObject[]>();
        for (const o of objects.filter((o) => o.asset === asset)) {
          const key = `${Math.floor(o.position.x / 120)}/${Math.floor(o.position.z / 120)}`;
          const cell = cells.get(key) ?? [];
          cell.push(o);
          cells.set(key, cell);
        }
        gltf.scene.traverse((node) => {
          if (!(node instanceof T.Mesh)) return;
          for (const m of Array.isArray(node.material) ? node.material : [node.material])
            if (m instanceof T.MeshStandardMaterial) {
              m.roughness = 1;
              m.metalness = 0;
              if (asset.includes('cactus')) m.color.set('#56773d');
              if (asset.includes('rock_')) {
                m.map = null;
                m.color.set(m.name === 'grass' ? '#b9542b' : '#d77c3e');
              }
              if (asset.includes('grass') || asset.includes('bush')) {
                m.map = null;
                m.color.set('#85733b');
              }
            }
          for (const cell of cells.values()) {
            const mesh = new T.InstancedMesh(node.geometry, node.material, cell.length);
            for (const [i, o] of cell.entries())
              mesh.setMatrixAt(i, desertAssetMatrix(bounds, o).multiply(node.matrixWorld));
            mesh.castShadow = asset.includes('tall') || asset.includes('short');
            mesh.receiveShadow = true;
            mesh.computeBoundingSphere();
            mesh.name = `desert-asset-${asset}`;
            root.add(mesh);
          }
        });
        library.add(gltf.scene);
      } catch {
        if (isCurrent()) onError();
      }
    }),
  );
}
