import * as T from 'three';
import { ForestRiverScenery } from './forest-river.ts';
import type { Track } from '../shared/track.ts';
import { BIOME_GROUND_Y } from '../shared/biome-layout.ts';
import { createForestLayout, type ForestPose } from './forest-layout.ts';
import {
  ForestModel,
  forestTree,
  forestRock,
  forestFern,
  forestLog,
  deerBody,
  deerHead,
  forestFox,
  DEER_HEAD_PIVOT,
} from './forest-models.ts';

const UP = new T.Vector3(0, 1, 0),
  RIGHT = new T.Vector3(1, 0, 0),
  CELL = 128;
const colourMaterial = () =>
  new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, flatShading: true });
function campModel() {
  const m = new ForestModel();
  m.box(4.4, 0.2, 1.6, 0, 1.35, 0, '#b29259');
  for (const x of [-1.5, 1.5])
    for (const side of [-1, 1])
      m.beam(new T.Vector3(x, 0, side * 1.1), new T.Vector3(x, 1.3, -side * 0.5), 0.12, '#665039');
  for (const z of [-1.3, 1.3]) m.box(4.7, 0.18, 0.52, 0, 0.66, z, '#9c7b4c');
  for (let i = 0; i < 3; i++) {
    m.add(
      new T.CylinderGeometry(0.4, 0.4, 0.9, 7),
      '#797d57',
      new T.Vector3(3 + i * 0.8, 0.45, -0.6),
    );
    m.add(
      new T.CylinderGeometry(0.42, 0.42, 0.07, 7),
      '#b1aa7b',
      new T.Vector3(3 + i * 0.8, 0.8, -0.6),
    );
  }
  m.box(1.1, 0.7, 0.9, -3, 0.35, 0.4, '#a4814e');
  m.box(1.2, 0.08, 1, -3, 0.75, 0.4, '#c0a16c');
  m.beam(new T.Vector3(-3, 0.8, 0.4), new T.Vector3(-2.7, 1.6, 0.4), 0.045, '#584534');
  m.box(0.48, 0.3, 0.12, -2.7, 1.55, 0.4, '#8d9890');
  return m.finish();
}
function signModel() {
  const m = new ForestModel();
  m.box(0.22, 3.3, 0.22, 0, 1.65, 0, '#785c3d');
  m.box(2.2, 0.48, 0.2, 0.45, 2.8, 0, '#b59c69');
  m.box(1.7, 0.42, 0.2, -0.2, 2.2, 0, '#456a4d');
  m.box(0.42, 0.25, 0.22, 1.4, 2.8, 0, '#d8c799', 0.65);
  return m.finish();
}
function mistTexture() {
  const data = new Uint8Array(32 * 32 * 4);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const i = (y * 32 + x) * 4,
        d = Math.hypot((x - 15.5) / 15.5, (y - 15.5) / 15.5);
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(Math.max(0, 1 - d) ** 2 * 255);
    }
  const texture = new T.DataTexture(data, 32, 32);
  texture.needsUpdate = true;
  return texture;
}

/** Rich woodland in spatial instance batches; only small wildlife/effects move each frame. */
export class ForestScenery {
  readonly root = new T.Group();
  readonly layout: ReturnType<typeof createForestLayout>;
  readonly heads: { mesh: T.InstancedMesh; poses: ForestPose[] }[] = [];
  readonly birds: T.InstancedMesh;
  readonly motes: T.Points;
  readonly river: ForestRiverScenery;
  private readonly mist: { sprite: T.Sprite; center: T.Vector3; phase: number }[] = [];
  private readonly material = colourMaterial();
  private readonly matrix = new T.Matrix4();
  private readonly rotation = new T.Quaternion();
  private readonly nod = new T.Quaternion();
  private readonly position = new T.Vector3();
  private readonly scale = new T.Vector3();
  private readonly motePositions: Float32Array;
  private readonly moteBase: Float32Array;

  private instances(geometry: T.BufferGeometry, poses: ForestPose[], name: string, shadows = true) {
    if (!poses.length) {
      geometry.dispose();
      return;
    }
    const cells = new Map<string, ForestPose[]>();
    for (const p of poses) {
      const key = `${Math.floor(p.position.x / CELL)}/${Math.floor(p.position.z / CELL)}`;
      const cell = cells.get(key) ?? [];
      cell.push(p);
      cells.set(key, cell);
    }
    for (const cell of cells.values()) {
      const mesh = new T.InstancedMesh(geometry, this.material, cell.length);
      for (const [i, p] of cell.entries()) {
        this.scale.setScalar(p.scale);
        this.position.copy(p.position);
        mesh.setMatrixAt(
          i,
          this.matrix.compose(this.position, this.rotation.setFromAxisAngle(UP, p.yaw), this.scale),
        );
        mesh.setColorAt(i, new T.Color().setScalar(0.88 + (p.variant % 4) * 0.065));
      }
      mesh.name = name;
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.computeBoundingSphere();
      this.root.add(mesh);
    }
  }
  private animalHeads(poses: ForestPose[], stag: boolean) {
    if (!poses.length) return;
    const mesh = new T.InstancedMesh(deerHead(stag), this.material, poses.length);
    mesh.name = stag ? 'timber-stag-heads' : 'timber-doe-heads';
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    mesh.castShadow = mesh.receiveShadow = true;
    // The head motion stays inside each whole animal's small conservative sphere.
    const bounds = new T.Box3();
    for (const p of poses) bounds.expandByPoint(p.position);
    mesh.boundingSphere = bounds.getBoundingSphere(new T.Sphere());
    mesh.boundingSphere.radius += 8;
    this.root.add(mesh);
    this.heads.push({ mesh, poses });
  }
  constructor(parent: T.Group, track: Track) {
    this.layout = createForestLayout(track);
    this.root.name = 'timber-run-woodland';
    parent.add(this.root);
    this.river = new ForestRiverScenery(this.root, track.biome!.river!);
    for (let kind = 0; kind < 3; kind++)
      this.instances(
        forestTree(kind),
        this.layout.trees.filter((t) => t.variant === kind),
        'timber-tree-' + kind,
      );
    this.instances(forestRock(), this.layout.rocks, 'timber-mossy-granite');
    this.instances(
      forestFern(),
      this.layout.plants.filter((_, i) => i % 5 !== 0),
      'timber-ferns',
      false,
    );
    this.instances(
      forestFern(true),
      this.layout.plants.filter((_, i) => i % 5 === 0),
      'timber-mushrooms',
      false,
    );
    this.instances(
      forestLog(),
      this.layout.logs.filter((_, i) => i % 3 !== 0),
      'timber-fallen-logs',
    );
    this.instances(
      forestLog(true),
      this.layout.logs.filter((_, i) => i % 3 === 0),
      'timber-stumps',
    );
    const camp: ForestPose[] = track
      .biome!.props.filter((p) => ['cabin', 'tent', 'mill'].includes(p.kind))
      .map((p, i) => ({
        position: p.position
          .clone()
          .add(new T.Vector3(p.size.x * 0.65, 0, -p.size.z * 0.15).applyAxisAngle(UP, p.yaw)),
        yaw: p.yaw,
        scale: 0.85,
        variant: i % 3,
      }));
    this.instances(campModel(), camp, 'timber-camp-furniture');
    this.instances(
      signModel(),
      this.layout.access
        .filter((_, i) => i % 4 === 0)
        .map((a, i) => ({
          position: a.origin
            .clone()
            .addScaledVector(a.across, a.halfWidth + 2)
            .setY(BIOME_GROUND_Y),
          yaw: Math.atan2(a.direction.x, a.direction.z),
          scale: 1,
          variant: i,
        })),
      'timber-trail-signs',
    );
    this.instances(deerBody(), this.layout.deer, 'timber-deer-bodies');
    this.animalHeads(
      this.layout.deer.filter((p) => !p.variant),
      false,
    );
    this.animalHeads(
      this.layout.deer.filter((p) => p.variant === 1),
      true,
    );
    this.instances(forestFox(), this.layout.foxes, 'timber-foxes');
    const birdGeometry = new T.BufferGeometry();
    birdGeometry.setAttribute(
      'position',
      new T.Float32BufferAttribute(
        [0, 0, 0, -0.7, 0.2, 0, -1.3, 0.05, 0.3, 0, 0, 0, 1.3, 0.05, 0.3, 0.7, 0.2, 0],
        3,
      ),
    );
    birdGeometry.computeBoundingSphere();
    this.birds = new T.InstancedMesh(
      birdGeometry,
      new T.MeshBasicMaterial({ color: '#263d32', side: T.DoubleSide }),
      9,
    );
    this.birds.name = 'timber-gliding-birds';
    this.birds.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.birds.boundingSphere = new T.Sphere(
      track.OVERVIEW_CENTER.clone(),
      track.OVERVIEW_RADIUS + 80,
    );
    this.root.add(this.birds);
    this.moteBase = new Float32Array(120 * 3);
    for (let i = 0; i < 120; i++) {
      const a = this.layout.access[i % this.layout.access.length];
      const p = a.origin
        .clone()
        .addScaledVector(a.direction, 12 + ((i * 7.3) % 32))
        .addScaledVector(a.across, Math.sin(i * 2.4) * 8);
      this.moteBase[i * 3] = p.x;
      this.moteBase[i * 3 + 1] = 1.5 + (i % 7) * 0.65;
      this.moteBase[i * 3 + 2] = p.z;
    }
    this.motePositions = this.moteBase.slice();
    const motes = new T.BufferGeometry();
    motes.setAttribute(
      'position',
      new T.BufferAttribute(this.motePositions, 3).setUsage(T.DynamicDrawUsage),
    );
    motes.computeBoundingSphere();
    motes.boundingSphere!.radius += 4;
    this.motes = new T.Points(
      motes,
      new T.PointsMaterial({
        color: '#e4dfad',
        size: 0.2,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
      }),
    );
    this.motes.name = 'timber-floating-pollen';
    this.root.add(this.motes);
    const texture = mistTexture(),
      mistMaterial = new T.SpriteMaterial({
        map: texture,
        color: '#d0dcc6',
        transparent: true,
        opacity: 0.13,
        depthWrite: false,
      });
    for (const [i, center] of this.layout.clearings.entries()) {
      const sprite = new T.Sprite(mistMaterial);
      sprite.scale.set(24, 3.4, 1);
      sprite.name = 'timber-low-mist';
      const p = center.clone().add(new T.Vector3(-4, 1.8, 3));
      sprite.position.copy(p);
      this.root.add(sprite);
      this.mist.push({ sprite, center: p, phase: i * 2.4 });
    }
    if (!this.mist.length) {
      texture.dispose();
      mistMaterial.dispose();
    }
    this.update(0, false);
  }
  update(seconds: number, reducedMotion: boolean) {
    const t = reducedMotion ? 0 : seconds;
    this.river.update(seconds, reducedMotion);
    for (const { mesh, poses } of this.heads)
      for (const [i, p] of poses.entries()) {
        this.rotation.setFromAxisAngle(UP, p.yaw);
        this.position
          .copy(DEER_HEAD_PIVOT)
          .multiplyScalar(p.scale)
          .applyQuaternion(this.rotation)
          .add(p.position);
        this.nod.setFromAxisAngle(RIGHT, 0.18 + Math.sin(t * 0.55 + i * 1.8) * 0.2);
        this.rotation.multiply(this.nod);
        this.scale.setScalar(p.scale);
        mesh.setMatrixAt(i, this.matrix.compose(this.position, this.rotation, this.scale));
        mesh.instanceMatrix.needsUpdate = true;
      }
    for (let i = 0; i < this.birds.count; i++) {
      const center =
        this.layout.clearings[i % this.layout.clearings.length] ?? this.layout.access[0].origin;
      const a = t * 0.06 + i * 2.4;
      this.position.set(
        center.x + Math.sin(a) * 26,
        18 + (i % 3) * 3 + Math.sin(t * 0.4 + i),
        center.z + Math.cos(a) * 22,
      );
      this.rotation.setFromAxisAngle(UP, a + Math.PI / 2);
      this.scale.set(1.1, 1 + Math.sin(t * 3 + i) * 0.2, 1.1);
      this.birds.setMatrixAt(i, this.matrix.compose(this.position, this.rotation, this.scale));
    }
    this.birds.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < 120; i++) {
      this.motePositions[i * 3] = this.moteBase[i * 3] + Math.sin(t * 0.25 + i) * 1.2;
      this.motePositions[i * 3 + 1] = this.moteBase[i * 3 + 1] + Math.sin(t * 0.4 + i * 0.7) * 0.45;
      this.motePositions[i * 3 + 2] = this.moteBase[i * 3 + 2] + Math.cos(t * 0.2 + i) * 0.8;
    }
    this.motes.geometry.getAttribute('position').needsUpdate = true;
    for (const m of this.mist)
      m.sprite.position.set(
        m.center.x + Math.sin(t * 0.1 + m.phase) * 2,
        m.center.y + Math.sin(t * 0.2 + m.phase) * 0.2,
        m.center.z,
      );
  }
}
