import { VEHICLE_RIDE_HEIGHT } from '../shared/rules.ts';
import { movingHazardPose } from '../shared/biome-layout.ts';
import { addDesertTerrain, addDesertAssets } from './desert-scenery.ts';
import { CarWheels } from './car-wheels.ts';
import { createNitroExhaust } from './nitro-exhaust.ts';
import { syncPickupVisuals } from './pickup-visuals.ts';
import { WeaponModels, CarEquipment, projectileVisual } from './weapon-models.ts';
import {
  curbGeometries,
  roadbedWallGeometry,
  guardrailGeometry,
  visibleRampGeometry,
  hasCenterDash,
  SURFACE_HEIGHTS,
} from './track-visuals.ts';
import { disposeResources } from './resources.ts';
import { WreckAppearance } from './wreck-appearance.ts';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { type Snapshot, type CarState, type GameEvent } from '../shared/types.ts';
import { getTrack } from '../shared/track.ts';
import type { MapId } from '../shared/maps.ts';
import { addBiome, PALETTES } from './biomes.ts';
import { ImpactShake, RoadEffects } from './race-effects.ts';
import { SceneLighting } from './scene-lighting.ts';

const mat = (color: T.ColorRepresentation, roughness = 0.8) =>
  new T.MeshStandardMaterial({ color, roughness });
const box = (x: number, y: number, z: number, color: T.ColorRepresentation) =>
  new T.Mesh(new T.BoxGeometry(x, y, z), mat(color));
interface Visual {
  group: T.Group;
  model: T.Group;
  lean: T.Group;
  wheels: CarWheels;
  appearance: WreckAppearance;
  equipment: CarEquipment;
  exhaust: T.Group;
  ring: T.Mesh;
  label: T.Sprite;
  last: CarState;
}
interface Burst {
  group: T.Group;
  born: number;
  duration: number;
  kind: string;
}
export class GameScene {
  track = getTrack();
  trackRoot = new T.Group();
  biomeScenery: ReturnType<typeof addBiome> = null;
  inspectionPose: { position: T.Vector3; target: T.Vector3 } | null = null;
  renderer: T.WebGLRenderer;
  lighting: SceneLighting;
  shadowFocus = new T.Vector3();
  scene = new T.Scene();
  camera = new T.PerspectiveCamera(55, 16 / 9, 1, 900);
  cars = new Map<string, Visual>();
  projectiles = new Map<number, T.Group>();
  pickups = new Map<number, T.Group>();
  bursts: Burst[] = [];
  obstacles = new Map<number, { group: T.Group; position: T.Vector3; rotation: T.Quaternion }>();
  models: T.Group[] = [];
  weaponModels = new WeaponModels();
  ready: Promise<void>;
  snapshot: Snapshot | null = null;
  lastEvent = 0;
  raf = 0;
  lastTime = 0;
  ambient = 0;
  disposed = false;
  assetsReady = false;
  cameraProgress = 0;
  view = 'overview';
  resizeObserver: ResizeObserver;
  onAssetError: (message: string) => void;
  surfaces: T.Mesh[] = [];
  roadEffects: RoadEffects;
  shake = new ImpactShake();
  cameraBase = new T.Vector3();
  reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  constructor(
    public container: HTMLElement,
    onAssetError: (message: string) => void = () => {},
    mapId: MapId = 'desert',
  ) {
    this.onAssetError = onAssetError;
    this.track = getTrack(mapId);
    this.scene.add(this.trackRoot);
    this.renderer = new T.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    container.append(this.renderer.domElement);
    this.scene.background = new T.Color(PALETTES[this.track.id].sky);
    this.scene.fog = new T.Fog(PALETTES[this.track.id].sky, 145, 370);
    this.lighting = new SceneLighting(this.scene, this.renderer.capabilities.maxTextureSize);
    this.lighting.setMap(this.track);
    this.camera.position
      .copy(this.track.OVERVIEW_CENTER)
      .add(
        new T.Vector3(
          this.track.OVERVIEW_RADIUS,
          this.track.OVERVIEW_RADIUS * 1.5,
          this.track.OVERVIEW_RADIUS,
        ),
      );
    this.camera.lookAt(this.track.OVERVIEW_CENTER);
    this.cameraBase.copy(this.camera.position);
    this.buildTrack();
    this.roadEffects = new RoadEffects(this.scene, this.surfaces);
    this.ready = Promise.all([
      this.loadAssets(),
      this.loadDecor(this.trackRoot),
      this.weaponModels.load(),
    ]).then(() => {
      if (this.disposed) return;
      this.assetsReady = true;
      this.lighting.invalidate();
      if (this.snapshot) this.setState(this.snapshot);
    });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }
  resize() {
    const w = this.container.clientWidth,
      h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  roadMesh(width: number, y: number, color: T.ColorRepresentation) {
    const data = this.track.roadGeometry(width, y),
      geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(data.vertices, 3));
    geo.setIndex(new T.BufferAttribute(data.indices, 1));
    geo.computeVertexNormals();
    const mesh = new T.Mesh(geo, mat(color));
    mesh.receiveShadow = true;
    this.trackRoot.add(mesh);
    return mesh;
  }
  instancedBoxes(
    x: number,
    y: number,
    z: number,
    color: T.ColorRepresentation,
    poses: { position: T.Vector3; yaw: number }[],
    castShadow = false,
  ) {
    const mesh = new T.InstancedMesh(new T.BoxGeometry(x, y, z), mat(color), poses.length),
      matrix = new T.Matrix4(),
      rotation = new T.Quaternion();
    for (let i = 0; i < poses.length; i++) {
      rotation.setFromAxisAngle(new T.Vector3(0, 1, 0), poses[i].yaw);
      matrix.compose(poses[i].position, rotation, new T.Vector3(1, 1, 1));
      mesh.setMatrixAt(i, matrix);
    }
    mesh.receiveShadow = true;
    mesh.castShadow = castShadow;
    mesh.computeBoundingSphere();
    this.trackRoot.add(mesh);
  }
  buildTrack() {
    const palette = PALETTES[this.track.id];
    const sand = new T.Mesh(
      this.track.id === 'volcano' ? new T.CircleGeometry(310, 64) : new T.PlaneGeometry(1800, 1800),
      mat(palette.ground),
    );
    sand.rotation.x = -Math.PI / 2;
    sand.position.y = -7.5;
    sand.receiveShadow = true;
    this.trackRoot.add(sand);
    const terrain = addDesertTerrain(this.trackRoot, this.track, (text) =>
      this.textSprite(text, '#fff0d2', '#284553', 8.5, 1.1),
    );
    if (terrain) this.surfaces.push(terrain);
    this.roadMesh(this.track.ROAD_WIDTH + 1, SURFACE_HEIGHTS.shoulder, palette.shoulder);
    this.surfaces.push(this.roadMesh(this.track.ROAD_WIDTH, SURFACE_HEIGHTS.asphalt, palette.road));
    const walls = new T.Mesh(roadbedWallGeometry(this.track), mat(palette.wall));
    walls.name = 'track-cliff-walls';
    walls.receiveShadow = true;
    this.trackRoot.add(walls);
    for (const [index, geometry] of curbGeometries(this.track).entries()) {
      const curb = new T.Mesh(geometry, mat(index === 0 ? palette.curb : '#f5e8d0'));
      curb.name = 'track-curb-' + index;
      curb.receiveShadow = true;
      this.trackRoot.add(curb);
    }
    const dashes: { position: T.Vector3; yaw: number }[] = [];
    for (let s = 0; s < this.track.TRACK_LENGTH; s += 3.2)
      if (hasCenterDash(s, this.track)) {
        const at = this.track.trackAt(s);
        at.p.y = 0.06;
        dashes.push({ position: at.p, yaw: at.yaw });
      }
    this.instancedBoxes(0.14, 0.025, 2.1, '#dfcfad', dashes);
    const rails = new T.Mesh(guardrailGeometry(this.track), mat('#e4ddd0'));
    rails.name = 'track-guardrails';
    rails.castShadow = true;
    rails.receiveShadow = true;
    this.trackRoot.add(rails);
    const a = this.track.trackAt(0),
      gate = new T.Group();
    gate.position.copy(a.p);
    gate.rotation.y = a.yaw;
    for (const side of [-1, 1]) {
      const post = box(0.65, 7, 0.65, '#ffb63c');
      post.position.set(side * (this.track.ROAD_WIDTH + 1), 3.5, 0);
      post.castShadow = true;
      gate.add(post);
    }
    const top = box(this.track.ROAD_WIDTH * 2 + 3, 1.4, 1, '#152b38');
    top.position.y = 7;
    top.castShadow = top.receiveShadow = true;
    gate.add(top);
    const sign = this.textSprite('TURBO RUMBLE', '#fff0d2', '#152b38', 16, 2);
    sign.position.set(0, 7.05, -0.6);
    gate.add(sign);
    for (let i = 0; i < 16; i++)
      for (let j = 0; j < 2; j++) {
        const flag = box(
          (this.track.ROAD_WIDTH * 2) / 16,
          0.025,
          0.65,
          (i + j) % 2 ? '#f1ead9' : '#17272f',
        );
        flag.position.set(
          -this.track.ROAD_WIDTH + ((i + 0.5) * this.track.ROAD_WIDTH) / 8,
          0.055,
          j * 0.65 - 0.65,
        );
        gate.add(flag);
      }
    this.trackRoot.add(gate);
    for (const o of this.track.OBSTACLES) {
      const group = new T.Group();
      if (o.kind === 'log') {
        const trunk = new T.Mesh(
          new T.CylinderGeometry(o.size.y / 2, o.size.y / 2, o.size.x, 12),
          mat('#68462c'),
        );
        trunk.rotation.z = Math.PI / 2;
        group.add(trunk);
        for (const side of [-1, 1]) {
          const end = new T.Mesh(new T.CircleGeometry((o.size.y / 2) * 0.93, 12), mat('#d9ba85'));
          end.position.x = side * (o.size.x / 2 + 0.005);
          end.rotation.y = (side * Math.PI) / 2;
          group.add(end);
        }
      } else if (o.kind === 'barrel') {
        group.add(
          new T.Mesh(
            new T.CylinderGeometry(o.size.x / 2, o.size.x / 2, o.size.y, 16),
            mat('#dc7244'),
          ),
        );
        for (const y of [-0.5, 0.5]) {
          const band = new T.Mesh(
            new T.TorusGeometry(o.size.x / 2 + 0.015, 0.07, 6, 16),
            mat('#263944'),
          );
          band.rotation.x = Math.PI / 2;
          band.position.y = y;
          group.add(band);
        }
      } else if (o.kind === 'rock') {
        const rock = new T.Mesh(
          new T.DodecahedronGeometry(1, 0),
          mat(
            this.track.id === 'forest'
              ? '#6d7d68'
              : this.track.id === 'volcano'
                ? '#59505c'
                : '#9b7058',
          ),
        );
        rock.scale.set(o.size.x / 2, o.size.y / 2, o.size.z / 2);
        group.add(rock);
      } else {
        group.add(box(o.size.x, o.size.y, o.size.z, o.kind === 'barrier' ? '#d9d0b9' : '#c77b40'));
        if (o.kind === 'barrier')
          for (let i = -2; i <= 2; i++) {
            const stripe = box(
              0.35,
              o.size.y * 0.85,
              o.size.z + 0.03,
              i % 2 ? '#172a35' : '#edb83d',
            );
            stripe.position.x = i * 0.67;
            stripe.rotation.z = -0.4;
            group.add(stripe);
          }
        else
          for (const angle of [-0.75, 0.75]) {
            const brace = box(0.14, o.size.y * 0.9, o.size.z + 0.025, '#f1c58c');
            brace.rotation.z = angle;
            group.add(brace);
          }
      }
      group.position.copy(o.position);
      group.rotation.y = o.yaw;
      group.traverse((n) => {
        if (n instanceof T.Mesh) {
          n.castShadow = true;
          n.receiveShadow = true;
        }
      });
      this.trackRoot.add(group);
      this.obstacles.set(o.id, {
        group,
        position: group.position.clone(),
        rotation: group.quaternion.clone(),
      });
    }
    for (const ramp of this.track.RAMPS) {
      const mesh = new T.Mesh(visibleRampGeometry(ramp, this.track), mat('#e5af43'));
      mesh.name = 'track-ramp';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.trackRoot.add(mesh);
      this.surfaces.push(mesh);
    }
    this.biomeScenery = addBiome(this.trackRoot, this.track, (text) =>
      this.textSprite(text, '#fff0d2', '#31453c', 10, 1.3),
    );
    if (this.biomeScenery) {
      this.surfaces.push(this.biomeScenery.ground);
      for (const [id, group] of this.biomeScenery.moving)
        this.obstacles.set(id, {
          group,
          position: group.position.clone(),
          rotation: group.quaternion.clone(),
        });
    }
    if (this.track.id === 'volcano') {
      const sea = new T.Mesh(new T.PlaneGeometry(1800, 1800), mat('#245b71'));
      sea.rotation.x = -Math.PI / 2;
      sea.position.y = -1.8;
      this.trackRoot.add(sea);
    }
    if (this.track.id !== 'desert') return;
    // Deterministic desert scenery; visual decoration never changes collisions.
    for (let i = 0; i < 95; i++) {
      const angle = i * 2.39996,
        radius = this.track.OVERVIEW_RADIUS * 1.05 + (i % 6) * 17,
        p = this.track.OVERVIEW_CENTER.clone().add(
          new T.Vector3(Math.sin(angle) * radius, 0, Math.cos(angle) * radius),
        );
      if (this.track.projectOnTrack(p).distance < 14) continue;
      const rock = new T.Mesh(
        new T.DodecahedronGeometry(4 + (i % 6), 0),
        mat(i % 2 ? '#b5815a' : '#c08e68'),
      );
      rock.position.set(p.x, -4 + Math.sin(i) * 2, p.z);
      rock.scale.set(1, 0.8 + (i % 3), 1);
      rock.rotation.set(i, angle, 0.1);
      rock.castShadow = true;
      this.trackRoot.add(rock);
    }
    const billboard = this.track.trackAt(this.track.TRACK_LENGTH * 0.25);
    const board = box(13, 4, 0.4, '#f4c347');
    board.position.copy(billboard.p).addScaledVector(billboard.n, 17);
    board.position.y = 4;
    board.rotation.y = billboard.yaw + Math.PI / 2;
    this.trackRoot.add(board);
  }
  async loadAssets() {
    const loader = new GLTFLoader();
    const carNames = ['race', 'race-future', 'hatchback-sports', 'suv'];
    const loaded = await Promise.all(
      carNames.map(async (name) => {
        try {
          const gltf = await loader.loadAsync(`/assets/cars/${name}.glb`);
          return gltf.scene;
        } catch {
          this.onAssetError('Część modeli nie została załadowana. Używam pojazdów zastępczych.');
          return null;
        }
      }),
    );
    const models = loaded.filter((model): model is T.Group => model !== null);
    if (this.disposed) {
      disposeResources(models);
      return;
    }
    // Network timing must not decide which body belongs to a player slot.
    this.models = models;
  }

  async loadDecor(root: T.Group) {
    if (this.track.id === 'desert') {
      const track = this.track;
      await addDesertAssets(
        root,
        track,
        () => !this.disposed && root === this.trackRoot,
        () => this.onAssetError('Część dekoracji jest niedostępna.'),
      );
      return;
    }
    if (this.track.id === 'forest') return;
    const loader = new GLTFLoader();
    const decor =
      this.track.id === 'volcano'
        ? ['tree_palm', 'tree_palmBend', 'rock_largeA', 'rock_smallA']
        : [
            'tree_palm',
            'tree_palmBend',
            'cactus_tall',
            'cactus_short',
            'rock_largeA',
            'rock_largeB',
            'rock_smallA',
          ];
    await Promise.all(
      decor.map(async (name, index) => {
        try {
          const gltf = await loader.loadAsync(`/assets/nature/${name}.glb`);
          if (this.disposed) {
            disposeResources([gltf.scene]);
            return;
          }
          if (this.disposed || root !== this.trackRoot) {
            disposeResources([gltf.scene]);
            return;
          }
          for (let i = 0; i < (index < 2 ? 36 : 26); i++) {
            const s = (i * 31 + index * 67) % Math.floor(this.track.TRACK_LENGTH),
              a = this.track.trackAt(s),
              side = i % 2 ? 1 : -1,
              d = 12 + ((i * 7 + index * 3) % 24),
              model = clone(gltf.scene),
              p = a.p.clone().addScaledVector(a.n, side * d);
            if (
              this.track.projectOnTrack(p).distance <
                this.track.trackAt(this.track.projectOnTrack(p).s).width + 4 ||
              this.track.biome?.props.some(
                (prop) =>
                  prop.position.distanceTo(p) < Math.hypot(prop.size.x, prop.size.z) / 2 + 4,
              ) ||
              this.track.isGap(s, 20)
            )
              continue;
            model.position.copy(p);
            model.position.y = -0.18;
            model.scale.setScalar(
              index < 2 ? (this.track.id === 'volcano' ? 5 : 3.4) : index < 4 ? 2.5 : 3.5 + (i % 3),
            );
            model.rotation.y = i * 1.7;
            model.traverse((o) => {
              if (o instanceof T.Mesh) {
                o.castShadow = true;
                o.receiveShadow = true;
              }
            });
            root.add(model);
          }
        } catch {
          this.onAssetError('Część dekoracji jest niedostępna.');
        }
      }),
    );
  }
  textSprite(text: string, color: string, background: string | undefined, width = 3, height = 0.8) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, 512, 128);
    }
    ctx.fillStyle = color;
    ctx.font = 'bold 58px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 67, 490);
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    const sprite = new T.Sprite(
      new T.SpriteMaterial({ map: texture, depthTest: false, transparent: true }),
    );
    sprite.scale.set(width, height, 1);
    return sprite;
  }
  carVisual(car: CarState) {
    const group = new T.Group(),
      model = new T.Group(),
      lean = new T.Group();
    model.add(lean);
    if (this.models.length) {
      const vehicle = clone(this.models[car.slot % this.models.length]);
      const bounds = new T.Box3().setFromObject(vehicle),
        size = bounds.getSize(new T.Vector3());
      const scale = 3.65 / Math.max(size.x, size.z);
      vehicle.scale.setScalar(scale);
      const box = new T.Box3().setFromObject(vehicle),
        center = box.getCenter(new T.Vector3());
      vehicle.position.set(-center.x, -box.min.y - VEHICLE_RIDE_HEIGHT, -center.z);
      vehicle.traverse((o) => {
        if (o instanceof T.Mesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      lean.add(vehicle);
    } else {
      const body = box(1.7, 0.7, 3.4, car.color);
      lean.add(body);
      const cabin = box(1.3, 0.6, 1.5, '#253848');
      cabin.position.y = 0.55;
      lean.add(cabin);
    }
    const wheels = new CarWheels(lean);
    // Player colors remain legible even on textured third-party models.
    const stripe = box(1.2, 0.08, 0.65, car.color);
    stripe.position.set(0, 0.83, 0);
    lean.add(stripe);
    lean.traverse((object) => {
      if (object instanceof T.Mesh) object.castShadow = object.receiveShadow = true;
    });
    const ring = new T.Mesh(
      new T.RingGeometry(1.65, 1.9, 40),
      new T.MeshBasicMaterial({
        color: car.color,
        side: T.DoubleSide,
        transparent: true,
        opacity: 0.85,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.48;
    const label = this.textSprite(`${car.slot + 1}  ${car.name}`, car.color, undefined, 4.1, 1.03);
    label.position.y = 3.7;
    group.add(model, ring, label);
    group.position.copy(car.position);
    this.scene.add(group);
    const appearance = new WreckAppearance(lean, wheels.all);
    const equipment = new CarEquipment(this.weaponModels, new T.Box3().setFromObject(lean).max.y);
    lean.add(equipment.group);
    equipment.setState(car);
    const exhaust = createNitroExhaust();
    model.add(exhaust);
    const vis = {
      group,
      model,
      lean,
      wheels,
      appearance,
      equipment,
      exhaust,
      ring,
      label,
      last: car,
    };
    this.cars.set(car.id, vis);
    return vis;
  }
  setMap(id: MapId) {
    if (id === this.track.id) return;
    this.roadEffects.destroy();
    this.scene.remove(this.trackRoot);
    disposeResources([this.trackRoot], this.models);
    this.trackRoot = new T.Group();
    this.scene.add(this.trackRoot);
    this.track = getTrack(id);
    this.surfaces = [];
    this.obstacles.clear();
    this.buildTrack();
    this.roadEffects = new RoadEffects(this.scene, this.surfaces);
    this.scene.background = new T.Color(PALETTES[id].sky);
    this.scene.fog = new T.Fog(PALETTES[id].sky, 145, 370);
    this.lighting.setMap(this.track);
    this.cameraProgress = 0;
    this.shake.clear();
    void this.loadDecor(this.trackRoot).then(() => {
      if (!this.disposed) this.lighting.invalidate();
    });
  }
  setState(snapshot: Snapshot) {
    this.setMap(snapshot.settings?.mapId ?? 'desert');
    const previous = this.snapshot;
    if (previous && (snapshot.tick < previous.tick || snapshot.code !== previous.code)) {
      this.lastEvent = 0;
      this.roadEffects.clear();
      this.shake.clear();
    }
    if (
      (snapshot.phase === 'countdown' || snapshot.phase === 'lobby') &&
      previous?.phase !== snapshot.phase
    ) {
      this.roadEffects.clear();
      this.shake.clear();
    }
    this.snapshot = snapshot;
    if (!this.assetsReady) return;
    for (const c of snapshot.cars) {
      const v = this.cars.get(c.id) ?? this.carVisual(c);
      v.last = c;
      v.equipment.setState(c);
      v.exhaust.visible = c.alive && c.boosted && ['racing', 'paused'].includes(snapshot.phase);
      v.appearance.setWrecked(!c.alive && !!c.wrecked);
      v.group.visible = c.alive || !!c.wrecked || snapshot.phase === 'lobby';
      v.ring.visible = c.alive;
      v.label.visible = c.alive;
    }
    for (const obstacle of snapshot.obstacles ?? []) {
      const visual = this.obstacles.get(obstacle.id);
      if (visual) {
        visual.position.copy(obstacle.position);
        visual.rotation.copy(obstacle.rotation);
        visual.group.visible = obstacle.position.y > -8;
      }
    }
    for (const [id, c] of this.cars)
      if (!snapshot.cars.some((p) => p.id === id)) {
        this.scene.remove(c.group);
        c.appearance.dispose();
        disposeResources([c.group], [...this.models, ...this.weaponModels.roots]);
        this.cars.delete(id);
      }
    syncPickupVisuals(this.scene, this.pickups, snapshot.pickups);
    for (const shot of snapshot.projectiles) {
      let group = this.projectiles.get(shot.id);
      if (!group) {
        group = new T.Group();
        group.add(projectileVisual(this.weaponModels, shot.kind));
        group.userData.kind = shot.kind;
        this.projectiles.set(shot.id, group);
        this.scene.add(group);
      }
      group.position.copy(shot.position);
      group.rotation.y = shot.yaw;
      if (shot.kind === 'mine') {
        const lamp = group.getObjectByName('mine-warning');
        if (lamp) lamp.visible = shot.armed;
      }
    }
    for (const shot of snapshot.projectiles)
      if (shot.rotation) this.projectiles.get(shot.id)?.quaternion.copy(shot.rotation);
    for (const [id, group] of this.projectiles)
      if (!snapshot.projectiles.some((p) => p.id === id)) {
        this.scene.remove(group);
        disposeResources([group], this.weaponModels.roots);
        this.projectiles.delete(id);
      }
    for (const event of snapshot.events)
      if (event.id > this.lastEvent) {
        this.lastEvent = event.id;
        if (snapshot.tick - event.tick < 12) this.burst(event);
      }
  }
  burst(event: GameEvent) {
    if (event.type === 'shot' || event.type === 'round' || event.type === 'finish') return;
    const group = new T.Group();
    group.position.copy(event.position);
    const color =
      event.type === 'frost'
        ? '#9ae6ff'
        : event.type === 'pulse'
          ? '#be98ff'
          : (event.color ?? '#ffb856');
    for (let i = 0; i < (event.type === 'pulse' ? 1 : 12); i++) {
      const geom =
        event.type === 'pulse'
          ? new T.TorusGeometry(1, 0.12, 5, 48)
          : new T.IcosahedronGeometry(0.35, 0);
      const mesh = new T.Mesh(geom, new T.MeshBasicMaterial({ color, transparent: true }));
      if (event.type === 'pulse') mesh.rotation.x = Math.PI / 2;
      else mesh.position.set(Math.sin(i * 2.4) * 0.5, 0.4, Math.cos(i * 2.4) * 0.5);
      group.add(mesh);
    }
    if (event.type === 'explosion') {
      this.roadEffects.addScorch(event.position, event.id);
      const target = this.track.cameraPose(
        this.snapshot?.cameraProgress ?? this.cameraProgress,
      ).target;
      this.shake.trigger(
        event.strength ?? 1,
        Math.hypot(event.position.x - target.x, event.position.z - target.z),
      );
      const fire = new T.Mesh(
        new T.SphereGeometry(0.6, 12, 8),
        new T.MeshBasicMaterial({ color: '#ff9b36', transparent: true, opacity: 0.9 }),
      );
      fire.userData.role = 'fireball';
      group.add(fire);
      const shock = new T.Mesh(
        new T.TorusGeometry(1, 0.13, 6, 40),
        new T.MeshBasicMaterial({ color: '#ffe9ad', transparent: true }),
      );
      shock.rotation.x = Math.PI / 2;
      shock.userData.role = 'shockwave';
      group.add(shock);
    }
    this.scene.add(group);
    this.bursts.push({
      group,
      born: performance.now(),
      duration: event.type === 'pulse' ? 650 : event.type === 'explosion' ? 900 : 750,
      kind: event.type,
    });
  }
  frame(time: number) {
    if (this.disposed) return;
    const dt = Math.min(0.05, (time - this.lastTime) / 1000 || 0.016);
    this.lastTime = time;
    this.ambient += dt;
    this.biomeScenery?.update(
      this.snapshot ? this.snapshot.tick / 50 : this.ambient,
      this.reducedMotion.matches,
    );
    if (!this.snapshot)
      for (const hazard of this.track.biome?.hazards ?? []) {
        const visual = this.obstacles.get(hazard.id),
          pose = movingHazardPose(hazard, this.ambient * 50);
        if (visual) {
          visual.position.copy(pose.position);
          visual.rotation.copy(pose.rotation);
        }
      }
    for (const v of this.cars.values()) {
      const c = v.last,
        target = new T.Vector3(c.position.x, c.position.y, c.position.z),
        factor = 1 - Math.exp(-dt * 23);
      if (v.group.position.distanceTo(target) > 12) v.group.position.copy(target);
      else v.group.position.lerp(target, factor);
      if (c.rotation)
        v.model.quaternion.slerp(
          new T.Quaternion(c.rotation.x, c.rotation.y, c.rotation.z, c.rotation.w),
          factor,
        );
      else {
        const delta = Math.atan2(
          Math.sin(c.yaw - v.model.rotation.y),
          Math.cos(c.yaw - v.model.rotation.y),
        );
        v.model.rotation.y += delta * factor;
      }
      if (v.ring.material instanceof T.MeshBasicMaterial)
        v.ring.material.opacity = c.invulnerable ? 0.35 + Math.sin(time / 65) * 0.25 : 0.8;
      v.model.scale.setScalar(c.alive && c.frozen ? 1 + Math.sin(time / 60) * 0.025 : 1);
      const active = this.snapshot?.phase === 'racing' && c.alive && !c.finishPlace;
      const paused = this.snapshot?.phase === 'paused';
      const steer = c.alive && (active || paused) ? (c.steering ?? 0) : 0;
      v.wheels.update(
        {
          position: v.group.position,
          rotation: v.model.quaternion,
          steering: steer,
          moving: active,
          grounded: c.grounded ?? true,
          suspension: c.suspension,
        },
        dt,
      );
      v.equipment.update(time, this.reducedMotion.matches);
      const flameWidth =
        this.reducedMotion.matches || !active ? 1 : 0.94 + Math.sin(time / 38 + c.slot) * 0.06;
      v.exhaust.scale.set(flameWidth, flameWidth, 1);
      this.roadEffects.car(c, v.group.position, time, active);
    }
    for (const obstacle of this.obstacles.values()) {
      obstacle.group.position.lerp(obstacle.position, 1 - Math.exp(-dt * 23));
      obstacle.group.quaternion.slerp(obstacle.rotation, 1 - Math.exp(-dt * 23));
    }
    for (const p of this.pickups.values()) {
      p.rotation.y += dt;
      p.children[0].rotation.z += dt * 0.5;
      p.children[0].position.y = Math.sin(this.ambient * 2 + p.position.x) * 0.15;
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i],
        a = (time - b.born) / b.duration;
      if (a >= 1) {
        this.scene.remove(b.group);
        b.group.traverse((o) => {
          if (o instanceof T.Mesh) {
            o.geometry.dispose();
            (o.material as T.Material).dispose();
          }
        });
        this.bursts.splice(i, 1);
        continue;
      }
      b.group.children.forEach((o, j) => {
        const m = o as T.Mesh;
        if (m.userData.role === 'fireball') {
          m.scale.setScalar(1 + a * 9);
          (m.material as T.MeshBasicMaterial).opacity = (1 - a) ** 3;
          return;
        }
        if (m.userData.role === 'shockwave') {
          m.scale.setScalar(1 + a * 8);
          (m.material as T.MeshBasicMaterial).opacity = (1 - a) ** 2;
          return;
        }
        if (b.kind === 'pulse') m.scale.setScalar(1 + a * 8);
        else {
          m.position.x += Math.sin(j * 2.4) * dt * 7;
          m.position.z += Math.cos(j * 2.4) * dt * 7;
          m.position.y += dt * (4 - 8 * a);
          m.scale.setScalar(1 - a * 0.7);
        }
        (m.material as T.MeshBasicMaterial).opacity = 1 - a;
      });
    }
    const racing =
      this.snapshot &&
      ['racing', 'segment', 'countdown', 'paused', 'finished'].includes(this.snapshot.phase);
    let shadowRadius = this.track.OVERVIEW_RADIUS + 70;
    this.shadowFocus.copy(this.track.OVERVIEW_CENTER);
    if (this.inspectionPose) {
      if (this.inspectionPose.position.distanceTo(this.inspectionPose.target) < 120) {
        this.shadowFocus.copy(this.inspectionPose.target);
        shadowRadius = 120 * Math.max(1, this.camera.aspect / 2);
      }
      this.cameraBase.copy(this.inspectionPose.position);
      this.camera.position.copy(this.cameraBase);
      this.camera.lookAt(this.inspectionPose.target);
    } else if (racing) {
      if (this.scene.fog instanceof T.Fog) {
        this.scene.fog.near = 145;
        this.scene.fog.far = 370;
      }
      this.cameraProgress +=
        (this.snapshot!.cameraProgress - this.cameraProgress) * (1 - Math.exp(-dt * 8));
      const pose = this.track.cameraPose(this.cameraProgress);
      this.shadowFocus.copy(pose.target);
      shadowRadius = 120 * Math.max(1, this.camera.aspect / 2);
      this.cameraBase.lerp(pose.position, 1 - Math.exp(-dt * 6));
      this.camera.position.copy(this.cameraBase);
      this.camera.lookAt(pose.target);
    } else {
      if (this.scene.fog instanceof T.Fog) {
        this.scene.fog.near = this.track.OVERVIEW_RADIUS * 2.2;
        this.scene.fog.far = this.track.OVERVIEW_RADIUS * 4;
      }
      const angle = this.ambient * 0.035 + 0.5;
      const pos = this.track.OVERVIEW_CENTER.clone().add(
        new T.Vector3(
          Math.sin(angle) * this.track.OVERVIEW_RADIUS * 1.65,
          this.track.OVERVIEW_RADIUS * 1.5,
          Math.cos(angle) * this.track.OVERVIEW_RADIUS * 1.65,
        ),
      );
      this.cameraBase.lerp(pos, 1 - Math.exp(-dt * 1.5));
      this.camera.position.copy(this.cameraBase);
      this.camera.lookAt(this.track.OVERVIEW_CENTER);
    }
    const paused = this.snapshot?.phase === 'paused',
      offset = this.shake.sample(dt, this.reducedMotion.matches || !racing || paused);
    this.camera.translateX(offset.x);
    this.camera.translateY(offset.y);
    this.camera.rotateZ(offset.roll);
    this.roadEffects.update(paused ? 0 : dt);
    this.lighting.update(
      this.shadowFocus,
      shadowRadius,
      this.cars.size > 0 || this.track.id !== 'desert',
    );
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }
  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.roadEffects.destroy();
    this.shake.clear();
    for (const car of this.cars.values()) car.appearance.dispose();
    disposeResources([this.scene, ...this.models], this.weaponModels.roots);
    this.weaponModels.destroy();
    this.lighting.destroy();
    this.scene.clear();
    this.models = [];
    this.cars.clear();
    this.projectiles.clear();
    this.pickups.clear();
    this.obstacles.clear();
    this.bursts = [];
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.container.replaceChildren();
  }
}
