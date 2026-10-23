import { BiomeScenery } from './biome-scenery.ts';
import { BIOME_GROUND_Y } from '../shared/biome-layout.ts';
import * as T from 'three';
import type { Track } from '../shared/track.ts';

export const PALETTES = {
  desert: {
    sky: '#efd3a3',
    ground: '#a5492c',
    road: '#dba96a',
    shoulder: '#ba683a',
    wall: '#984326',
    curb: '#b9492e',
    light: '#fff0c7',
  },
  forest: {
    sky: '#b5d7d0',
    ground: '#436f3c',
    road: '#816248',
    shoulder: '#69854c',
    wall: '#6b563d',
    curb: '#c5a278',
    light: '#e9fff0',
  },
  volcano: {
    sky: '#8c7195',
    ground: '#29362f',
    road: '#34343b',
    shoulder: '#55514e',
    wall: '#292b32',
    curb: '#e4a04c',
    light: '#ffdbb6',
  },
} as const;
const material = (color: string) => new T.MeshStandardMaterial({ color, roughness: 1 });
function instances(
  root: T.Group,
  geometry: T.BufferGeometry,
  color: string,
  poses: { p: T.Vector3; scale: T.Vector3; yaw: number }[],
) {
  const mesh = new T.InstancedMesh(geometry, material(color), poses.length),
    matrix = new T.Matrix4();
  for (const [i, pose] of poses.entries()) {
    matrix.compose(
      pose.p,
      new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), pose.yaw),
      pose.scale,
    );
    mesh.setMatrixAt(i, matrix);
  }
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  root.add(mesh);
}
export function addBiome(root: T.Group, track: Track, label: (text: string) => T.Sprite) {
  if (track.id === 'desert') return null;
  const flows: { mesh: T.Mesh; baseX: number; lava: boolean }[] = [];
  const forest = track.id === 'forest',
    trunks: Parameters<typeof instances>[3] = [],
    crowns: typeof trunks = [],
    rocks: typeof trunks = [];
  for (let i = 0; i < (forest ? 520 : 0); i++) {
    const at = track.trackAt(i * 47.79),
      side = i % 2 ? 1 : -1,
      p = at.p.clone().addScaledVector(at.n, side * (at.width + 8 + ((i * 13) % 57)));
    if (track.projectOnTrack(p).distance < track.trackAt(track.projectOnTrack(p).s).width + 6)
      continue;
    if (track.GAPS.some((g) => p.distanceTo(track.trackAt(g.s).p) < 19)) continue;
    if (
      track.biome?.props.some(
        (prop) => prop.position.distanceTo(p) < Math.hypot(prop.size.x, prop.size.z) / 2 + 5,
      )
    )
      continue;
    const h = 8 + (i % 5),
      y = BIOME_GROUND_Y;
    trunks.push({
      p: new T.Vector3(p.x, y + h * 0.35, p.z),
      scale: new T.Vector3(0.48, h * 0.7, 0.48),
      yaw: i,
    });
    for (let layer = 0; layer < 3; layer++)
      crowns.push({
        p: new T.Vector3(p.x, y + h * 0.55 + layer * 3, p.z),
        scale: new T.Vector3(4.5 - layer * 0.8, 7 - layer, 4.5 - layer * 0.8),
        yaw: i * 0.7,
      });
    if (i % 4 === 0)
      rocks.push({
        p: new T.Vector3(p.x + 3, 0.6, p.z + 2),
        scale: new T.Vector3(2 + (i % 3), 2, 2),
        yaw: i,
      });
  }
  if (forest) {
    instances(root, new T.CylinderGeometry(0.65, 1, 1, 7), '#65452f', trunks);
    instances(root, new T.ConeGeometry(1, 1, 7), '#244d37', crowns);
    instances(root, new T.DodecahedronGeometry(1, 0), '#758074', rocks);
  }
  for (const gap of track.GAPS) {
    const at = track.trackAt(gap.s),
      crossing = new T.Group();
    crossing.position.copy(at.p);
    crossing.rotation.y = at.yaw;
    const lava = gap.kind === 'lava',
      surface = new T.Mesh(
        new T.PlaneGeometry(forest ? 122 : 180, gap.length + 1.4),
        lava
          ? new T.MeshBasicMaterial({ color: '#e7410d', toneMapped: false })
          : new T.MeshStandardMaterial({
              color: '#267f98',
              emissive: '#164c64',
              emissiveIntensity: 0.25,
              roughness: 0.28,
              metalness: 0.2,
            }),
      );
    surface.name = lava ? 'lava-surface' : 'river-surface';
    surface.rotation.x = -Math.PI / 2;
    surface.position.y = -1.6;
    if (forest) surface.position.x = 29;
    crossing.add(surface);
    if (forest) {
      const lower = new T.Mesh(new T.PlaneGeometry(58, gap.length + 1.4), surface.material);
      lower.rotation.x = -Math.PI / 2;
      lower.position.set(-61, -6.3, 0);
      crossing.add(lower);
    }
    // Foam/current lines and hot lava veins make the crossing legible from the chase camera.
    for (let i = 0; i < 22; i++) {
      const line = new T.Mesh(
        new T.BoxGeometry(4 + (i % 4), 0.025, 0.13 + (i % 3) * 0.1),
        new T.MeshBasicMaterial({
          color: lava ? '#ffd35b' : '#95e0de',
          transparent: !lava,
          opacity: lava ? 1 : 0.55,
        }),
      );
      line.position.set(-79 + i * 7.3, -1.57, (((i % 5) - 2) * gap.length) / 6);
      if (forest && line.position.x < -32) line.position.y = -6.27;
      line.rotation.y = Math.sin(i * 2) * 0.25;
      crossing.add(line);
      flows.push({ mesh: line, baseX: line.position.x, lava });
    }
    for (const edge of [-1, 1]) {
      const bank = new T.Mesh(
        new T.BoxGeometry(180, 5, 1.5),
        material(forest ? '#72765b' : '#35313b'),
      );
      bank.position.set(0, -2.7, edge * (gap.length / 2 + 1.1));
      crossing.add(bank);
    }
    root.add(crossing);
  }
  if (!forest) {
    const volcano = new T.Group();
    volcano.position.copy(track.OVERVIEW_CENTER);
    const cone = new T.Mesh(new T.CylinderGeometry(22, 70, 54, 32, 5, true), material('#453940'));
    cone.position.y = 19.5;
    cone.castShadow = true;
    cone.receiveShadow = true;
    volcano.add(cone);
    const crater = new T.Mesh(
      new T.CircleGeometry(21.7, 32),
      new T.MeshBasicMaterial({ color: '#ff6313', toneMapped: false }),
    );
    crater.rotation.x = -Math.PI / 2;
    crater.position.y = 46;
    volcano.add(crater);
    const rim = new T.Mesh(new T.TorusGeometry(22, 2, 5, 32), material('#342c34'));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 46.5;
    volcano.add(rim);
    for (let i = 0; i < 9; i++) {
      const angle = i * 2.399,
        top = new T.Vector3(Math.cos(angle) * 22, 46, Math.sin(angle) * 22),
        bottom = new T.Vector3(Math.cos(angle) * 70, -7.2, Math.sin(angle) * 70),
        delta = top.clone().sub(bottom),
        flow = new T.Mesh(
          new T.CylinderGeometry(0.7, 2.2, delta.length(), 6),
          new T.MeshBasicMaterial({ color: '#ff6011', toneMapped: false }),
        );
      flow.position.copy(top).add(bottom).multiplyScalar(0.5);
      flow.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), delta.normalize());
      volcano.add(flow);
    }
    root.add(volcano);
  }
  return new BiomeScenery(root, track, label, flows);
}
