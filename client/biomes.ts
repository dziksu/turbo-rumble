import { BiomeScenery } from './biome-scenery.ts';
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
    sky: '#9eb7a9',
    ground: '#385b40',
    road: '#ae9164',
    shoulder: '#637247',
    wall: '#6b563d',
    curb: '#c7b990',
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
export function addBiome(parent: T.Group, track: Track, label: (text: string) => T.Sprite) {
  if (track.id === 'desert') return null;
  const root = new T.Group();
  root.name = track.id + '-biome-scenery';
  parent.add(root);
  const flows: { mesh: T.Mesh; baseX: number; lava: boolean }[] = [];
  const forest = track.id === 'forest';
  if (!forest)
    for (const gap of track.GAPS) {
      const at = track.trackAt(gap.s),
        crossing = new T.Group();
      crossing.position.copy(at.p);
      crossing.rotation.y = at.yaw;
      const surface = new T.Mesh(
        new T.PlaneGeometry(180, gap.length + 1.4),
        new T.MeshBasicMaterial({ color: '#e7410d', toneMapped: false }),
      );
      surface.name = 'lava-surface';
      surface.rotation.x = -Math.PI / 2;
      surface.position.y = -1.6;
      crossing.add(surface);
      for (let i = 0; i < 22; i++) {
        const line = new T.Mesh(
          new T.BoxGeometry(4 + (i % 4), 0.025, 0.13 + (i % 3) * 0.1),
          new T.MeshBasicMaterial({ color: '#ffd35b' }),
        );
        line.position.set(-79 + i * 7.3, -1.57, (((i % 5) - 2) * gap.length) / 6);
        line.rotation.y = Math.sin(i * 2) * 0.25;
        crossing.add(line);
        flows.push({ mesh: line, baseX: line.position.x, lava: true });
      }
      for (const edge of [-1, 1]) {
        const bank = new T.Mesh(new T.BoxGeometry(180, 5, 1.5), material('#35313b'));
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
