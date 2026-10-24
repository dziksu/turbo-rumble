import * as T from 'three';
import { ForestScenery } from './forest-scenery.ts';
import { bakeForestStatics, forestGround } from './forest-models.ts';
import {
  BIOME_GROUND_Y,
  VOLCANO_ISLAND_RADIUS,
  movingHazardPose,
  type BiomeProp,
} from '../shared/biome-layout.ts';
import type { Track } from '../shared/track.ts';

type Flow = { mesh: T.Mesh; baseX: number; lava: boolean };
/** Landmarks and decorative animation live with one map root; collision descriptors stay shared. */
export class BiomeScenery {
  ground: T.Mesh;
  forest: ForestScenery | null = null;
  moving = new Map<number, T.Group>();
  private animations: ((seconds: number) => void)[] = [];
  private materials = new Map<string, T.MeshStandardMaterial>();
  private mat(color: string) {
    let result = this.materials.get(color);
    if (!result) {
      result = new T.MeshStandardMaterial({ color, roughness: 0.86 });
      this.materials.set(color, result);
    }
    return result;
  }
  private box(
    parent: T.Object3D,
    x: number,
    y: number,
    z: number,
    px: number,
    py: number,
    pz: number,
    color: string,
  ) {
    const mesh = new T.Mesh(new T.BoxGeometry(x, y, z), this.mat(color));
    mesh.position.set(px, py, pz);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  private cylinder(
    parent: T.Object3D,
    radius: number,
    height: number,
    x: number,
    y: number,
    z: number,
    color: string,
    sides = 10,
  ) {
    const mesh = new T.Mesh(new T.CylinderGeometry(radius, radius, height, sides), this.mat(color));
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  private log(parent: T.Object3D, length: number, radius: number, x: number, y: number, z: number) {
    const bark = this.cylinder(parent, radius, length, x, y, z, '#78513a');
    bark.rotation.z = Math.PI / 2;
    for (const side of [-1, 1]) {
      const end = new T.Mesh(new T.CircleGeometry(radius * 0.96, 12), this.mat('#dbb77e'));
      end.position.set(x + side * (length / 2 + 0.01), y, z);
      end.rotation.y = (side * Math.PI) / 2;
      parent.add(end);
      const ring = new T.Mesh(
        new T.RingGeometry(radius * 0.54, radius * 0.61, 12),
        this.mat('#aa8057'),
      );
      ring.position.copy(end.position);
      ring.position.x += side * 0.012;
      ring.rotation.copy(end.rotation);
      parent.add(ring);
    }
  }
  private roof(parent: T.Object3D, width: number, depth: number, y: number, color: string) {
    const geometry = new T.BufferGeometry();
    const vertices = [
      -width / 2,
      0,
      -depth / 2,
      width / 2,
      0,
      -depth / 2,
      0,
      2.6,
      -depth / 2,
      -width / 2,
      0,
      depth / 2,
      width / 2,
      0,
      depth / 2,
      0,
      2.6,
      depth / 2,
    ];
    geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
    geometry.setIndex([0, 2, 1, 3, 4, 5, 0, 3, 5, 0, 5, 2, 2, 5, 4, 2, 4, 1]);
    geometry.computeVertexNormals();
    const mesh = new T.Mesh(geometry, this.mat(color));
    mesh.position.y = y;
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
  }
  private building(root: T.Group, prop: BiomeProp, index: number) {
    const group = new T.Group();
    group.position.copy(prop.position);
    group.rotation.y = prop.yaw;
    root.add(group);
    const { x: w, y: h, z: d } = prop.size;
    this.box(group, w + 0.8, 0.25, d + 0.8, 0, 0.02, 0, '#777f68');
    if (prop.kind === 'tent') {
      this.roof(group, w, d, 0, index % 2 ? '#d2a14d' : '#678d85');
      const flap = this.box(group, 1.5, 2.2, 0.09, 0, 1.1, d / 2 + 0.02, '#253f3d');
      flap.rotation.z = 0.1;
      for (const side of [-1, 1])
        this.box(group, 0.1, 2.8, 0.1, (side * w) / 2, 1.4, d / 2 + 0.3, '#d2b47d');
      return;
    }
    if (prop.kind === 'tower') {
      for (const x of [-1, 1])
        for (const z of [-1, 1]) {
          this.box(
            group,
            0.55,
            h - 2,
            0.55,
            x * (w / 2 - 0.6),
            (h - 2) / 2,
            z * (d / 2 - 0.6),
            '#7c6043',
          );
          const brace = this.box(
            group,
            0.25,
            h - 3,
            0.3,
            x * (w / 2 - 0.6),
            (h - 3) / 2,
            z * (d / 2 - 0.6),
            '#ae915c',
          );
          brace.rotation.z = x * 0.23;
        }
      this.box(group, w, 1.6, d, 0, h - 2, 0, '#9b7850');
      this.roof(group, w + 1, d + 1, h - 1.3, '#415a4b');
      this.box(group, 0.9, h - 3, 0.4, 0, (h - 3) / 2, d / 2 + 0.3, '#bfa275');
      for (let y = 1; y < h - 3; y += 0.6)
        this.box(group, 1.2, 0.12, 0.12, 0, y, d / 2 + 0.6, '#d6be89');
      return;
    }
    if (prop.kind === 'logpile') {
      for (let layer = 0; layer < 3; layer++)
        for (let i = 0; i < 3 - layer; i++)
          this.log(group, w, 0.48, 0, layer * 0.9 + 0.6, (i - (2 - layer) / 2) * 1.2);
      return;
    }
    if (prop.kind === 'basalt') {
      for (let i = 0; i < 5; i++) {
        const height = h * (0.5 + (i % 3) * 0.24);
        this.cylinder(
          group,
          w * 0.23,
          height,
          Math.sin(i * 2.4) * w * 0.25,
          height / 2,
          Math.cos(i * 2.4) * d * 0.25,
          i % 2 ? '#49424b' : '#62545b',
          6,
        );
      }
      return;
    }
    if (prop.kind === 'station') {
      this.box(group, w, h - 1.4, d, 0, (h - 1.4) / 2, 0, '#d1c3a4');
      this.box(group, w + 0.6, 0.45, d + 0.6, 0, h - 1.2, 0, '#a65443');
      this.box(group, w + 0.3, 0.65, d + 0.3, 0, 1, 0, '#b96b43');
      for (const side of [-1, 1])
        this.box(group, w * 0.24, 1.4, 0.15, side * w * 0.27, 3.6, d / 2 + 0.1, '#71bfc0');
      this.box(group, 1.8, 3.2, 0.15, 0, 1.6, d / 2 + 0.12, '#394b54');
      const dish = new T.Group();
      dish.position.set(0, h + 0.8, 0);
      group.add(dish);
      this.cylinder(dish, 0.17, 2.4, 0, 0, 0, '#b9b1a3');
      const face = new T.Mesh(
        new T.ConeGeometry(1.4, 0.7, 12, 1, true),
        new T.MeshStandardMaterial({ color: '#d7d3bc', side: T.DoubleSide }),
      );
      face.rotation.z = 0.8;
      face.position.y = 0.6;
      dish.add(face);
      this.animations.push((t) => (dish.rotation.y = t * 0.25 + index));
      for (const side of [-1, 1])
        this.cylinder(group, 0.7, 2, side * w * 0.32, h + 0.1, -d * 0.28, '#58646b');
      return;
    }
    const cabin = prop.kind === 'cabin' || prop.kind === 'mill';
    this.box(group, w, h - 3, d, 0, (h - 3) / 2, 0, cabin ? '#8b6545' : '#b68c57');
    for (let y = 0.6; y < h - 3; y += 0.7)
      this.box(group, w + 0.15, 0.12, d + 0.15, 0, y, 0, cabin ? '#bd9560' : '#d3b17b');
    this.roof(group, w + 1.3, d + 1.3, h - 3, cabin ? '#456257' : '#c7aa68');
    for (const side of [-1, 1]) {
      this.box(group, 2, 1.7, 0.16, side * w * 0.28, 2.8, d / 2 + 0.12, '#add8c0');
      this.box(group, 0.12, 1.8, 0.2, side * w * 0.28, 2.8, d / 2 + 0.2, '#5c4936');
    }
    this.box(group, 1.7, 3, 0.2, 0, 1.5, d / 2 + 0.12, '#493a31');
    this.box(group, w + 0.8, 0.2, 2.8, 0, 0.25, d / 2 + 1.5, '#c2a778');
    for (const side of [-1, 1])
      this.box(group, 0.25, 3.2, 0.25, side * w * 0.45, 1.7, d / 2 + 2.7, '#a9814f');
    if (prop.kind === 'mill') this.box(group, 1.3, 4, 1.3, w * 0.25, h - 1.5, -d * 0.25, '#6e6c61');
  }
  constructor(root: T.Group, track: Track, label: (text: string) => T.Sprite, flows: Flow[] = []) {
    const layout = track.biome!;
    const data = layout.terrain,
      geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(data.vertices, 3));
    geometry.setIndex(new T.BufferAttribute(data.indices, 1));
    geometry.computeVertexNormals();
    this.ground =
      track.id === 'forest'
        ? new T.Mesh(
            forestGround(geometry),
            new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.94 }),
          )
        : new T.Mesh(geometry, this.mat('#303948'));
    this.ground.name = 'biome-drivable-ground';
    this.ground.receiveShadow = true;
    root.add(this.ground);
    layout.props.forEach((prop, index) => this.building(root, prop, index));
    for (const [index, landmark] of layout.landmarks.entries()) {
      const at = track.trackAt(landmark.s - 25),
        gate = new T.Group();
      gate.position.copy(at.p);
      gate.rotation.y = at.yaw;
      root.add(gate);
      const forest = track.id === 'forest';
      for (const side of [-1, 1])
        this.box(gate, 1.1, 6, 1.1, side * (at.width + 2), 3, 0, forest ? '#8c6541' : '#80756b');
      this.box(gate, at.width * 2 + 5, 0.8, 1.1, 0, 6, 0, forest ? '#92734b' : '#c88749');
      const sign = label(landmark.name);
      sign.position.copy(at.p).setY(7);
      root.add(sign);
      if (forest)
        for (const side of [-1, 1]) {
          const logs = new T.Group();
          logs.position.copy(at.p).addScaledVector(at.n, side * (at.width + 4));
          logs.rotation.y = at.yaw;
          root.add(logs);
          for (let j = 0; j < 3; j++) this.log(logs, 5, 0.5, 0, 0.5 + j * 0.8, side * j * 0.6);
        }
      else {
        const pipe = new T.Group();
        pipe.position.copy(at.p).addScaledVector(at.n, (index ? 1 : -1) * (at.width + 4));
        root.add(pipe);
        this.cylinder(pipe, 1.3, 5, 0, 2.4, 0, '#857b67');
        this.cylinder(pipe, 1.8, 0.6, 0, 5, 0, '#db9048');
        const steam = new T.Mesh(
          new T.IcosahedronGeometry(1.5, 0),
          new T.MeshStandardMaterial({
            color: '#d1bbad',
            transparent: true,
            opacity: 0.32,
            depthWrite: false,
          }),
        );
        pipe.add(steam);
        this.animations.push((t) => {
          const f = (t * 0.3 + index * 0.4) % 1;
          steam.position.set(Math.sin(t) * 0.4, 5 + f * 6, 0);
          steam.scale.setScalar(0.6 + f * 1.3);
        });
      }
    }
    for (const hazard of layout.hazards) {
      const group = new T.Group(),
        pose = movingHazardPose(hazard, 0);
      group.position.copy(pose.position);
      group.quaternion.copy(pose.rotation);
      root.add(group);
      if (hazard.kind === 'timber') {
        this.log(group, hazard.size.x, hazard.size.y / 2, 0, 0, 0);
        for (const x of [-2.8, 2.8]) {
          const band = this.cylinder(group, 0.59, 0.25, x, 0, 0, '#a8aaa0');
          band.rotation.z = Math.PI / 2;
        }
        this.cylinder(group, 0.8, 1.7, 0, -0.05, 0, '#bd9a63');
      } else {
        this.box(group, hazard.size.x, hazard.size.y, hazard.size.z, 0, 0, 0, '#8c6249');
        this.box(group, hazard.size.x, 0.12, 1.15, 0, 0.58, 0, '#f8ae43');
        for (let x = -3.1; x < 3.3; x += 1.1)
          this.box(group, 0.4, 0.15, 1.2, x, 0.66, 0, '#363b43');
        this.cylinder(group, 0.85, 1.4, 0, 0, 0, '#b6a38a');
      }
      if (track.id === 'forest') bakeForestStatics(group);
      group.userData.forestDynamic = true;
      this.moving.set(hazard.id, group);
      const base = new T.Group();
      base.position.copy(hazard.position).setY(BIOME_GROUND_Y);
      root.add(base);
      this.cylinder(base, 1.3, 0.35, 0, 0.12, 0, hazard.kind === 'timber' ? '#6b7757' : '#6c6360');
      const at = track.trackAt(hazard.s - 8);
      for (const side of [-1, 1]) {
        const light = this.cylinder(
          root,
          0.35,
          1.5,
          at.p.x + at.n.x * side * (at.width - 1),
          0.75,
          at.p.z + at.n.z * side * (at.width - 1),
          '#d2b05d',
        );
        light.name = 'hazard-warning-post';
      }
    }
    for (const gap of track.GAPS) {
      const at = track.trackAt(gap.s);
      if (track.id === 'forest') {
        const wheel = new T.Group();
        wheel.position
          .copy(at.p)
          .addScaledVector(at.n, at.width + 11)
          .setY(1.8);
        wheel.rotation.y = at.yaw;
        root.add(wheel);
        const rotor = new T.Group();
        wheel.add(rotor);
        for (const x of [-1.3, 1.3]) {
          const rim = new T.Mesh(new T.TorusGeometry(3.7, 0.24, 6, 16), this.mat('#a67a4b'));
          rim.rotation.y = Math.PI / 2;
          rim.position.x = x;
          rotor.add(rim);
        }
        for (let i = 0; i < 12; i++) {
          const angle = (i / 12) * Math.PI * 2,
            paddle = this.box(
              rotor,
              3,
              0.45,
              1.3,
              0,
              Math.cos(angle) * 3.5,
              Math.sin(angle) * 3.5,
              '#bb985d',
            );
          paddle.rotation.x = angle;
          const spoke = this.box(rotor, 0.23, 7.2, 0.23, 0, 0, 0, '#715738');
          spoke.rotation.x = angle;
        }
        bakeForestStatics(rotor);
        rotor.userData.forestDynamic = true;
        const shaft = this.cylinder(wheel, 0.4, 6, 0, 0, 0, '#4d5b51');
        shaft.rotation.z = Math.PI / 2;
        this.animations.push((t) => (rotor.rotation.x = t * 0.65));
        for (const x of [-3, 3]) {
          for (const z of [-gap.length / 2 - 1.5, gap.length / 2 + 1.5])
            this.box(wheel, 0.45, 4, 0.45, x, 0, z, '#7f6848');
          this.box(wheel, 0.45, 0.45, gap.length + 4, x, 0.3, 0, '#a78b57');
        }
      } else {
        for (const side of [-1, 1]) {
          const jet = new T.Group();
          jet.position
            .copy(at.p)
            .addScaledVector(at.n, side * (at.width + 9))
            .setY(-1.5);
          root.add(jet);
          const plume = new T.Mesh(
            new T.ConeGeometry(1.5, 5.5, 7),
            new T.MeshBasicMaterial({ color: '#ffae35', toneMapped: false }),
          );
          plume.position.y = 2;
          jet.add(plume);
          for (let i = 0; i < 7; i++) {
            const ember = new T.Mesh(
              new T.IcosahedronGeometry(0.25 + (i % 2) * 0.15, 0),
              new T.MeshBasicMaterial({ color: i % 2 ? '#ffcf66' : '#ef7041', toneMapped: false }),
            );
            jet.add(ember);
            this.animations.push((t) => {
              const f = (t * 0.45 + i * 0.14) % 1;
              ember.position.set(
                Math.sin(i * 2.4) * f * 3,
                1 + Math.sin(f * Math.PI) * 6,
                Math.cos(i * 2.4) * f * 3,
              );
            });
          }
          this.animations.push((t) =>
            plume.scale.set(1, 0.6 + 0.4 * Math.sin(t * 1.8 + side) ** 2, 1),
          );
        }
      }
    }
    if (track.id === 'volcano') {
      const shore = new T.Mesh(
        new T.RingGeometry(VOLCANO_ISLAND_RADIUS - 8, VOLCANO_ISLAND_RADIUS, 64),
        this.mat('#b3976c'),
      );
      shore.rotation.x = -Math.PI / 2;
      shore.position.y = BIOME_GROUND_Y + 0.04;
      shore.receiveShadow = true;
      root.add(shore);
      for (let i = 0; i < 3; i++) {
        const surf = new T.Mesh(
          new T.RingGeometry(
            VOLCANO_ISLAND_RADIUS + 2 + i * 3,
            VOLCANO_ISLAND_RADIUS + 2.3 + i * 3,
            64,
          ),
          new T.MeshBasicMaterial({
            color: '#a2d6ca',
            transparent: true,
            opacity: 0.35,
            depthWrite: false,
          }),
        );
        surf.rotation.x = -Math.PI / 2;
        surf.position.y = -1.74;
        root.add(surf);
        this.animations.push((t) => surf.scale.setScalar(1 + Math.sin(t * 0.6 + i) * 0.003));
      }
      // Basalt arches frame the road without obstructing the racing clearance.
      for (const u of [0.095, 0.55]) {
        const at = track.trackAt(u * track.TRACK_LENGTH),
          arch = new T.Group();
        arch.position.copy(at.p);
        arch.rotation.y = at.yaw;
        root.add(arch);
        for (const side of [-1, 1])
          for (let i = 0; i < 3; i++)
            this.cylinder(
              arch,
              1.3,
              5 + i,
              side * (at.width + 2 + i * 0.8),
              (5 + i) / 2,
              i - 1,
              '#59505b',
              6,
            );
        const top = this.box(arch, at.width * 2 + 7, 2.5, 3.5, 0, 7.3, 0, '#5f535d');
        top.rotation.z = 0.03;
      }
      for (let i = 0; i < 12; i++) {
        const puff = new T.Mesh(
          new T.IcosahedronGeometry(3 + (i % 3), 0),
          new T.MeshStandardMaterial({
            color: '#76646c',
            transparent: true,
            opacity: 0.24,
            depthWrite: false,
          }),
        );
        root.add(puff);
        this.animations.push((t) => {
          const f = (t * 0.055 + i / 12) % 1;
          puff.position
            .copy(track.OVERVIEW_CENTER)
            .add(
              new T.Vector3(Math.sin(i * 2.4) * f * 12, 48 + f * 30, Math.cos(i * 2.4) * f * 10),
            );
          puff.scale.setScalar(0.5 + f * 1.8);
        });
      }
    }
    for (const flow of flows)
      this.animations.push(
        (t) =>
          (flow.mesh.position.x =
            flow.baseX + Math.sin(t * (flow.lava ? 0.45 : 0.8) + flow.baseX) * 1.7),
      );
    if (track.id === 'forest') {
      bakeForestStatics(root);
      this.forest = new ForestScenery(root, track);
    }
    this.update(0, false);
  }
  update(seconds: number, reducedMotion: boolean) {
    const t = reducedMotion ? 0 : seconds;
    for (const animation of this.animations) animation(t);
    this.forest?.update(seconds, reducedMotion);
  }
}
