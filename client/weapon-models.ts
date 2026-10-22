import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Weapon, CarState, ProjectileState } from '../shared/types.ts';
import { disposeResources } from './resources.ts';

const material = (color: T.ColorRepresentation) =>
  new T.MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0.22,
    flatShading: true,
  });
const glow = (color: T.ColorRepresentation) => new T.MeshBasicMaterial({ color });
function mesh(geometry: T.BufferGeometry, color: T.ColorRepresentation, luminous = false) {
  const object = new T.Mesh(geometry, luminous ? glow(color) : material(color));
  object.castShadow = !luminous;
  return object;
}
function part(
  root: T.Group,
  geometry: T.BufferGeometry,
  color: T.ColorRepresentation,
  position: [number, number, number] = [0, 0, 0],
  luminous = false,
) {
  const object = mesh(geometry, color, luminous);
  object.position.set(...position);
  root.add(object);
  return object;
}
function normalize(source: T.Group, length: number) {
  const model = source.clone(true),
    bounds = new T.Box3().setFromObject(model),
    size = bounds.getSize(new T.Vector3());
  model.scale.setScalar(length / Math.max(size.x, size.y, size.z));
  bounds.setFromObject(model);
  model.position.sub(bounds.getCenter(new T.Vector3()));
  model.traverse((node) => {
    if (node instanceof T.Mesh) node.castShadow = true;
  });
  const centered = new T.Group();
  centered.add(model);
  return centered;
}

/** One source per item; all cars and shots borrow its GPU resources. */
export class WeaponModels {
  readonly templates = new Map<Weapon, T.Group>();
  private sources: T.Group[] = [];
  private readonly mount = new T.Group();
  private disposed = false;
  constructor() {
    part(this.mount, new T.BoxGeometry(0.9, 0.12, 0.8), '#293746');
    for (const x of [-0.38, 0.38])
      part(this.mount, new T.BoxGeometry(0.09, 0.15, 0.9), '#d6d7cd', [x, -0.05, 0]);
    this.build();
  }
  get roots(): T.Group[] {
    return [...this.templates.values(), ...this.sources, this.mount];
  }
  async load() {
    const loader = new GLTFLoader();
    const files = ['bullet-foam-tip-thick', 'grenade-b', 'blaster-e'] as const;
    const loaded = await Promise.all(
      files.map(async (name) => {
        try {
          return (await loader.loadAsync(`/assets/weapons/${name}.glb`)).scene;
        } catch {
          return undefined;
        } // Procedural equivalents preserve item readability offline.
      }),
    );
    if (this.disposed) {
      disposeResources(loaded.filter((m): m is T.Group => !!m));
      return;
    }
    disposeResources([...this.templates.values()]);
    this.sources = loaded.filter((m): m is T.Group => !!m);
    this.build(loaded);
  }
  create(kind: Weapon) {
    const root = this.templates.get(kind)!.clone(true);
    root.name = `equipment-${kind}`;
    root.userData.weapon = kind;
    return root;
  }
  createEquipment(kind: Weapon) {
    const item = this.create(kind),
      root = new T.Group();
    item.position.y = kind === 'rocket' ? 0.6 : kind === 'mine' ? 0.18 : 0.2;
    root.add(this.mount.clone(true), item);
    return root;
  }
  private build(loaded: (T.Group | undefined)[] = []) {
    const rocket = new T.Group();
    if (loaded[0]) {
      const body = normalize(loaded[0], 1.65);
      body.scale.x *= 0.55;
      body.scale.z *= 0.55;
      body.rotation.x = Math.PI / 2; // Kenney bullet's +Y nose becomes the car's +Z nose.
      rocket.add(body);
    } else {
      const body = part(rocket, new T.CylinderGeometry(0.26, 0.26, 1.25, 10), '#f2e4c9');
      body.rotation.x = Math.PI / 2;
      const nose = part(rocket, new T.ConeGeometry(0.27, 0.5, 10), '#ff8050', [0, 0, 0.8]);
      nose.rotation.x = Math.PI / 2;
    }
    const warhead = part(rocket, new T.ConeGeometry(0.27, 0.44, 10), '#f07c51', [0, 0, 1.02]);
    warhead.rotation.x = Math.PI / 2;
    for (const z of [-0.22, 0.36])
      part(rocket, new T.BoxGeometry(0.6, 0.3, 0.16), '#343b45', [0, -0.43, z]);
    for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const fin = part(rocket, new T.BoxGeometry(0.08, 0.65, 0.55), '#ff8050', [
        Math.sin(angle) * 0.26,
        Math.cos(angle) * 0.26,
        -0.48,
      ]);
      fin.rotation.z = -angle;
    }
    const exhaust = part(
      rocket,
      new T.CylinderGeometry(0.22, 0.3, 0.24, 10),
      '#293746',
      [0, 0, -0.83],
    );
    exhaust.rotation.x = Math.PI / 2;
    this.templates.set('rocket', rocket);

    const mine = new T.Group();
    part(mine, new T.CylinderGeometry(0.52, 0.62, 0.22, 12), '#343747');
    if (loaded[1]) {
      const core = normalize(loaded[1], 0.78);
      core.scale.y *= 0.55;
      core.position.y += 0.15;
      mine.add(core);
    } else part(mine, new T.SphereGeometry(0.4, 10, 6), '#5b4962', [0, 0.1, 0]);
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      part(mine, new T.BoxGeometry(0.18, 0.15, 0.18), '#ec77a6', [
        Math.sin(a) * 0.48,
        0.16,
        Math.cos(a) * 0.48,
      ]);
    }
    part(mine, new T.SphereGeometry(0.13, 8, 6), '#ff859b', [0, 0.36, 0], true).name =
      'mine-warning';
    this.templates.set('mine', mine);

    const frost = new T.Group();
    if (loaded[2]) {
      const cannon = normalize(loaded[2], 1.55);
      cannon.position.y = 0.12;
      frost.add(cannon);
    } else {
      const barrel = part(
        frost,
        new T.CylinderGeometry(0.25, 0.3, 1.3, 8),
        '#e1f8ff',
        [0, 0.12, 0],
      );
      barrel.rotation.x = Math.PI / 2;
    }
    // A large frosted charge is readable from the shared racing camera.
    part(frost, new T.IcosahedronGeometry(0.43, 1), '#b6f4ff', [0, 0.33, 0.62]).name =
      'frost-charge';
    const iceRing = part(
      frost,
      new T.TorusGeometry(0.45, 0.055, 6, 18),
      '#69dfff',
      [0, 0.33, 0.62],
      true,
    );
    iceRing.rotation.y = Math.PI / 4;
    this.templates.set('frost', frost);

    const pulse = new T.Group();
    part(pulse, new T.CylinderGeometry(0.39, 0.46, 0.2, 10), '#3a3559', [0, 0.05, 0]);
    part(pulse, new T.CylinderGeometry(0.13, 0.13, 0.9, 8), '#c6b6e6', [0, 0.58, 0]);
    for (let i = 0; i < 5; i++) {
      const coil = part(pulse, new T.TorusGeometry(0.33 - i * 0.018, 0.065, 6, 16), '#a28be4', [
        0,
        0.3 + i * 0.15,
        0,
      ]);
      coil.rotation.x = Math.PI / 2;
    }
    part(pulse, new T.IcosahedronGeometry(0.24, 1), '#dfbaff', [0, 1.1, 0], true).name =
      'pulse-charge';
    this.templates.set('pulse', pulse);

    const boost = new T.Group();
    for (const x of [-0.32, 0.32]) {
      const tank = part(boost, new T.CapsuleGeometry(0.24, 0.64, 3, 8), '#ffc44a', [x, 0.15, 0]);
      tank.rotation.x = Math.PI / 2;
      const nozzle = part(boost, new T.CylinderGeometry(0.12, 0.17, 0.2, 8), '#283648', [
        x,
        0.15,
        -0.7,
      ]);
      nozzle.rotation.x = Math.PI / 2;
      part(boost, new T.BoxGeometry(0.1, 0.08, 0.85), '#f9f3da', [x, 0.38, 0]);
    }
    this.templates.set('boost', boost);
  }
  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    disposeResources(this.roots);
    this.templates.clear();
    this.sources = [];
  }
}

export class CarEquipment {
  readonly group = new T.Group();
  private kind: Weapon | null = null;
  private charge: T.Object3D | undefined;
  constructor(
    private readonly models: WeaponModels,
    roofHeight: number,
  ) {
    this.group.name = 'car-equipment';
    this.group.position.y = roofHeight + 0.14;
    this.group.visible = false;
  }
  setState(car: Pick<CarState, 'alive' | 'weapon'>) {
    const next = car.alive ? car.weapon : null;
    if (next !== this.kind) {
      this.group.clear(); // Borrowed clones own no geometry, materials or textures.
      if (next) this.group.add(this.models.createEquipment(next));
      this.charge = next ? this.group.getObjectByName(`${next}-charge`) : undefined;
      this.kind = next;
    }
    this.group.visible = next !== null;
  }
  update(time: number, reducedMotion: boolean) {
    if (!this.charge || !this.group.visible || reducedMotion) return;
    this.charge.rotation.y = time * 0.001;
    if (this.kind === 'pulse') this.charge.scale.setScalar(1 + Math.sin(time * 0.006) * 0.12);
  }
}

export function projectileVisual(models: WeaponModels, kind: ProjectileState['kind']) {
  if (kind === 'rocket') {
    const rocket = new T.Group();
    rocket.add(models.create(kind));
    const flame = part(rocket, new T.ConeGeometry(0.2, 0.75, 7), '#ffbb55', [0, 0, -1.25], true);
    flame.rotation.x = -Math.PI / 2;
    return rocket;
  }
  if (kind === 'mine') return models.create(kind);
  const snow = new T.Group();
  part(snow, new T.IcosahedronGeometry(0.38, 1), '#c9f9ff');
  const ring = part(snow, new T.TorusGeometry(0.43, 0.055, 6, 16), '#77dfff', [0, 0, 0], true);
  ring.rotation.x = Math.PI / 2;
  return snow;
}
