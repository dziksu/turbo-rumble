import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DESERT_GROUND_Y, type DesertObject } from '../shared/desert-layout.ts';
import type { Track } from '../shared/track.ts';
import { disposeResources } from './resources.ts';

const material = (color: string) => new T.MeshStandardMaterial({ color, roughness: 0.92 });
function block(root: T.Group, size: T.Vector3, position: T.Vector3, color: string, yaw = 0) {
  const mesh = new T.Mesh(new T.BoxGeometry(size.x, size.y, size.z), material(color));
  mesh.position.copy(position);
  mesh.rotation.y = yaw;
  mesh.castShadow = mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}
function beam(root: T.Group, from: T.Vector3, to: T.Vector3, width: number, color: string) {
  const delta = to.clone().sub(from);
  const mesh = new T.Mesh(new T.CylinderGeometry(width, width, delta.length(), 5), material(color));
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), delta.normalize());
  mesh.castShadow = true;
  root.add(mesh);
}
function mesh(data: { vertices: Float32Array; indices: Uint32Array }, color: string) {
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.BufferAttribute(data.vertices, 3));
  geometry.setIndex(new T.BufferAttribute(data.indices, 1));
  geometry.computeVertexNormals();
  const result = new T.Mesh(geometry, material(color));
  result.receiveShadow = true;
  return result;
}

/** Fits actual source bounds to the same world-space dimensions used by the fixed colliders. */
export function desertAssetMatrix(
  bounds: T.Box3,
  object: Pick<DesertObject, 'position' | 'size' | 'yaw'>,
) {
  const original = bounds.getSize(new T.Vector3()),
    center = bounds.getCenter(new T.Vector3());
  return new T.Matrix4()
    .compose(
      object.position,
      new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), object.yaw),
      new T.Vector3(
        object.size.x / original.x,
        object.size.y / original.y,
        object.size.z / original.z,
      ),
    )
    .multiply(new T.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z));
}

function instances(root: T.Group, source: T.Group, objects: DesertObject[]) {
  source.updateWorldMatrix(true, true);
  const bounds = new T.Box3().setFromObject(source);
  const matrices = objects.map((object) => desertAssetMatrix(bounds, object));
  source.traverse((node) => {
    if (!(node instanceof T.Mesh)) return;
    const result = new T.InstancedMesh(node.geometry, node.material, objects.length);
    for (const [index, matrix] of matrices.entries())
      result.setMatrixAt(index, matrix.clone().multiply(node.matrixWorld));
    result.castShadow = result.receiveShadow = true;
    result.computeBoundingSphere();
    result.name = `desert-asset-${objects[0].asset}`;
    root.add(result);
  });
}

export function addDesertTerrain(root: T.Group, track: Track, label: (text: string) => T.Sprite) {
  const layout = track.desert;
  if (!layout) return null;
  const terrain = mesh(track.terrainGeometry()!, '#d9b280');
  terrain.name = 'desert-drivable-ground';
  root.add(terrain);
  for (const bridge of layout.bridges) {
    const crossing = new T.Group();
    crossing.position.copy(bridge.p);
    crossing.rotation.y = bridge.yaw;
    root.add(crossing);
    block(crossing, new T.Vector3(188, 0.4, 41), new T.Vector3(0, -6.8, 0), '#a66f48');
    // A lower service road makes the depth and actual bridge structure visible from above.
    block(crossing, new T.Vector3(182, 0.12, 11), new T.Vector3(0, -6.5, 0), '#5d625d');
    for (let x = -84; x <= 84; x += 10)
      block(crossing, new T.Vector3(4.5, 0.025, 0.16), new T.Vector3(x, -6.42, 0), '#e9d4a0');
    for (const side of [-1, 1]) {
      block(crossing, new T.Vector3(188, 6.3, 1.3), new T.Vector3(0, -3.4, side * 19.5), '#bc885b');
      for (let x = -84; x <= 84; x += 12)
        block(
          crossing,
          new T.Vector3(8, 3.2 + (Math.abs(x) % 4), 5),
          new T.Vector3(x, -3.1, side * 23.5),
          x % 24 ? '#c59669' : '#b98156',
        );
    }
    const segments = 10;
    for (const side of [-1, 1]) {
      let last: T.Vector3 | null = null;
      for (let i = 0; i <= segments; i++) {
        const at = track.trackAt(bridge.s - bridge.length / 2 + (i / segments) * bridge.length);
        const p = at.p.clone().addScaledVector(at.n, side * (at.width + 1.1));
        const top = p.clone().setY(3.8);
        beam(root, p.clone().setY(-0.7), top, 0.24, '#b85536');
        if (last) {
          beam(root, last, top, 0.23, '#b85536');
          beam(root, last.clone().setY(0.65), top, 0.15, '#d9894e');
        }
        if (i % 3 === 1) {
          block(root, new T.Vector3(1.5, 5.7, 2.5), p.clone().setY(-3.5), '#d7c4a1', at.yaw);
          block(
            root,
            new T.Vector3(at.width * 2 + 2, 0.5, 2.5),
            at.p.clone().setY(-0.7),
            '#cfb386',
            at.yaw,
          );
        }
        last = top;
      }
    }
    const signAt = track.trackAt(bridge.s - bridge.length / 2 - 10);
    const sign = label(bridge.name);
    sign.position
      .copy(signAt.p)
      .addScaledVector(signAt.n, signAt.width + 7)
      .setY(4.5);
    root.add(sign);
  }

  for (const object of layout.objects.filter((object) => object.asset.includes('building'))) {
    block(
      root,
      new T.Vector3(object.size.x + 3, 0.16, object.size.z + 3),
      object.position.clone().setY(-0.12),
      '#d0c4a7',
      object.yaw,
    );
    const front = new T.Vector3(Math.sin(object.yaw), 0, Math.cos(object.yaw));
    const doorstep = object.position
      .clone()
      .addScaledVector(front, object.size.z / 2 + 1.8)
      .setY(0.03);
    block(root, new T.Vector3(object.size.x * 0.85, 0.15, 1.3), doorstep, '#eee0bd', object.yaw);
    if (
      object.id.includes('-1-') ||
      object.id.includes('-3-') ||
      object.asset.includes('commercial')
    ) {
      const width = object.size.x * 0.78;
      for (let stripe = 0; stripe < 6; stripe++) {
        const p = doorstep
          .clone()
          .setY(3.6)
          .addScaledVector(
            new T.Vector3(Math.cos(object.yaw), 0, -Math.sin(object.yaw)),
            ((stripe - 2.5) * width) / 6,
          );
        block(
          root,
          new T.Vector3(width / 6, 0.16, 2.4),
          p,
          stripe % 2 ? '#f6d891' : '#cb6846',
          object.yaw,
        );
      }
    }
  }
  const fountain = new T.Group();
  fountain.position.copy(layout.fountain);
  root.add(fountain);
  const base = new T.Mesh(new T.CylinderGeometry(3, 3.3, 0.8, 12), material('#c5a883'));
  base.position.y = 0.4;
  const water = new T.Mesh(
    new T.CylinderGeometry(2.6, 2.6, 0.04, 20),
    new T.MeshStandardMaterial({ color: '#54bcbf', roughness: 0.25, metalness: 0.2 }),
  );
  water.position.y = 0.83;
  const pillar = new T.Mesh(new T.CylinderGeometry(0.45, 0.7, 2.3, 8), material('#f2d7a4'));
  pillar.position.y = 1.5;
  const bowl = new T.Mesh(new T.ConeGeometry(1.2, 0.55, 12), material('#efcf95'));
  bowl.rotation.z = Math.PI;
  bowl.position.y = 2.8;
  const island = new T.Mesh(
    new T.RingGeometry(3.4, 4.3, 40),
    new T.MeshBasicMaterial({ color: '#edbe55', side: T.DoubleSide }),
  );
  island.rotation.x = -Math.PI / 2;
  island.position.y = 0.045;
  fountain.add(base, water, pillar, bowl, island);
  fountain.traverse((node) => {
    if (node instanceof T.Mesh) node.castShadow = node.receiveShadow = true;
  });
  const market = label('SUNDOWN MARKET');
  market.position.copy(track.trackAt(track.TRACK_LENGTH * 0.06).p).setY(7.5);
  root.add(market);
  // Side streets/parking bays are away from the asphalt, on the same drivable ground.
  for (const u of [0.035, 0.115, 0.49, 0.55, 0.89]) {
    const at = track.trackAt(u * track.TRACK_LENGTH);
    for (const side of [-1, 1]) {
      const p = at.p
        .clone()
        .addScaledVector(at.n, side * (at.width + 3.2))
        .setY(-0.08);
      block(root, new T.Vector3(4, 0.08, 18), p, '#b8a68a', at.yaw);
      for (let i = -1; i <= 1; i++)
        block(
          root,
          new T.Vector3(2.7, 0.018, 0.12),
          p
            .clone()
            .addScaledVector(at.t, i * 5)
            .setY(-0.025),
          '#f4dfb2',
          at.yaw,
        );
    }
  }
  return terrain;
}

/** Repeated props share geometry/materials and use one draw per source mesh, not one per house. */
export async function addDesertAssets(
  root: T.Group,
  track: Track,
  isCurrent: () => boolean,
  onError: () => void,
) {
  const layout = track.desert;
  if (!layout) return;
  const objects = [...layout.objects];
  for (let i = 0; i < 170; i++) {
    const at = track.trackAt((i * 47.79) % track.TRACK_LENGTH);
    if (layout.atBridge(i * 47.79, 50)) continue;
    const side = i % 2 ? 1 : -1;
    const position = at.p.clone().addScaledVector(at.n, side * (at.width + 10 + (i % 7) * 6));
    if (layout.objects.some((o) => o.position.distanceTo(position) < 11)) continue;
    if (
      track.projectOnTrack(position).distance <
      track.trackAt(track.projectOnTrack(position).s).width + 5
    )
      continue;
    position.y = DESERT_GROUND_Y;
    const bush = i % 3 === 0;
    const size = bush ? new T.Vector3(2.3, 1.5, 2.1) : new T.Vector3(1.7, 3.2 + (i % 3), 1.7);
    objects.push({
      id: `plant-${i}`,
      asset: bush ? 'nature/plant_bush' : 'legacy/cactus_tall',
      position,
      size,
      yaw: i * 1.71,
      solid: false,
    });
  }
  for (let i = 0; i < 26; i++) {
    const at = track.trackAt((i / 26) * track.TRACK_LENGTH);
    if (layout.atBridge((i / 26) * track.TRACK_LENGTH, 40)) continue;
    const position = at.p.clone().addScaledVector(at.n, (i % 2 ? 1 : -1) * (at.width + 7));
    if (layout.objects.some((o) => o.position.distanceTo(position) < 10)) continue;
    position.y = DESERT_GROUND_Y;
    objects.push({
      id: `palm-${i}`,
      asset: 'legacy/tree_palm',
      position,
      size: new T.Vector3(5, 9, 5),
      yaw: i,
      solid: false,
    });
  }
  for (const [index, bridge] of layout.bridges.entries())
    for (const side of [-1, 1])
      for (let i = -4; i <= 4; i++) {
        const position = bridge.p
          .clone()
          .addScaledVector(bridge.n, i * 19)
          .addScaledVector(bridge.t, side * 17.8)
          .setY(-6.6);
        if (Math.abs(i * 19) < bridge.width + 7) continue;
        objects.push({
          id: `canyon-rock-${index}-${side}-${i}`,
          asset: 'nature/rock_tallB',
          position,
          size: new T.Vector3(12 + (Math.abs(i) % 3), 5.3 + (Math.abs(i) % 3) * 0.45, 7),
          yaw: bridge.yaw + i * 0.07,
          solid: false,
        });
      }
  for (const [i, u] of [0.045, 0.075, 0.12, 0.5, 0.535, 0.91].entries())
    for (const side of [-1, 1]) {
      const at = track.trackAt(u * track.TRACK_LENGTH),
        position = at.p
          .clone()
          .addScaledVector(at.n, side * (at.width + 3.6))
          .setY(DESERT_GROUND_Y);
      objects.push({
        id: `parasol-${i}-${side}`,
        asset: 'commercial/detail-parasol-a',
        position,
        size: new T.Vector3(3.8, 3.9, 3.8),
        yaw: at.yaw,
        solid: false,
      });
    }
  const library = new T.Group();
  library.visible = false;
  library.name = 'desert-source-assets';
  root.add(library);
  const loader = new GLTFLoader();
  await Promise.all(
    [...new Set(objects.map((object) => object.asset))].map(async (asset) => {
      try {
        const url = asset.startsWith('legacy/')
          ? `/assets/nature/${asset.slice(7)}.glb`
          : `/assets/desert/${asset}.glb`;
        const gltf = await loader.loadAsync(url);
        if (!isCurrent()) {
          disposeResources([gltf.scene]);
          return;
        }
        if (asset.includes('rock_'))
          gltf.scene.traverse((node) => {
            if (!(node instanceof T.Mesh)) return;
            for (const m of Array.isArray(node.material) ? node.material : [node.material])
              if (m instanceof T.MeshStandardMaterial && m.name === 'grass') m.color.set('#ae8158');
          });
        instances(
          root,
          gltf.scene,
          objects.filter((object) => object.asset === asset),
        );
        library.add(gltf.scene);
      } catch {
        if (isCurrent()) onError();
      }
    }),
  );
}
