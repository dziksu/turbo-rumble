import * as T from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import type { CarState, Vec } from '../shared/types.ts';

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
export class ImpactShake {
  pulses: { age: number; strength: number; seed: number }[] = [];
  trigger(strength = 1, distance = 0) {
    if (distance > 65) return;
    this.pulses.push({
      age: 0,
      strength: clamp(strength, 0, 1) * clamp(1 - distance / 75, 0.1, 1),
      seed: this.pulses.length * 1.7,
    });
    if (this.pulses.length > 6) this.pulses.shift();
  }
  sample(dt: number, reducedMotion = false) {
    let x = 0,
      y = 0,
      roll = 0;
    for (const p of this.pulses) {
      p.age += dt;
      const envelope = Math.max(0, 1 - p.age / 0.48) ** 2 * p.strength;
      x += Math.sin(p.age * 89 + p.seed) * envelope * 0.2;
      y += Math.sin(p.age * 117 + p.seed + 0.7) * envelope * 0.13;
      roll += Math.sin(p.age * 76 + p.seed) * envelope * 0.004;
    }
    this.pulses = this.pulses.filter((p) => p.age < 0.48);
    return reducedMotion
      ? { x: 0, y: 0, roll: 0 }
      : { x: clamp(x, -0.25, 0.25), y: clamp(y, -0.18, 0.18), roll: clamp(roll, -0.006, 0.006) };
  }
  clear() {
    this.pulses = [];
  }
}

// Project onto actual road triangles: marks are clipped at cliffs and fit the ramps.
export function scorchGeometry(surface: T.Mesh, position: Vec, seed = 0) {
  const projected = new DecalGeometry(
    surface,
    new T.Vector3(position.x, 1.2, position.z),
    new T.Euler(-Math.PI / 2, 0, seed * 2.39996),
    new T.Vector3(6.2, 5.5, 6),
  );
  const positions = projected.getAttribute('position'),
    keep: number[] = [];
  const a = new T.Vector3(),
    b = new T.Vector3(),
    c = new T.Vector3();
  for (let vertex = 0; vertex < positions.count; vertex += 3) {
    a.fromBufferAttribute(positions, vertex);
    b.fromBufferAttribute(positions, vertex + 1);
    c.fromBufferAttribute(positions, vertex + 2);
    if (b.sub(a).cross(c.sub(a)).normalize().y > 0.4) keep.push(vertex, vertex + 1, vertex + 2);
  }
  if (keep.length === positions.count) return projected;
  // A road mark belongs on the drivable top, not the ramp's side walls or hidden underside.
  const clipped = new T.BufferGeometry();
  for (const [name, attribute] of Object.entries(projected.attributes)) {
    const values: number[] = [];
    for (const vertex of keep)
      for (let component = 0; component < attribute.itemSize; component++)
        values.push(attribute.array[vertex * attribute.itemSize + component]);
    clipped.setAttribute(name, new T.Float32BufferAttribute(values, attribute.itemSize));
  }
  clipped.computeVertexNormals();
  projected.dispose();
  return clipped;
}
function softTexture(soot: boolean) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!,
    pixels = ctx.createImageData(128, 128);
  let seed = 713;
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 128; x++) {
      const dx = (x - 64) / 64,
        dy = (y - 64) / 64,
        r = Math.hypot(dx, dy),
        angle = Math.atan2(dy, dx),
        i = (y * 128 + x) * 4;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const edge = soot ? 0.85 + 0.06 * Math.sin(angle * 9) + 0.04 * Math.sin(angle * 17) : 0.92;
      const alpha =
        clamp((edge - r) / (soot ? 0.55 : 0.75), 0, 1) ** 1.5 *
        (soot ? 0.65 : 1) *
        (soot ? 0.72 + (seed / 4294967296) * 0.28 : 1);
      pixels.data[i] = soot ? 14 : 207;
      pixels.data[i + 1] = soot ? 12 : 201;
      pixels.data[i + 2] = soot ? 10 : 186;
      pixels.data[i + 3] = alpha * 255;
    }
  ctx.putImageData(pixels, 0, 0);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  return texture;
}
interface Scorch {
  meshes: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial>[];
  age: number;
}
interface Trail {
  points: (T.Vector3 | null)[];
  last: number;
}
interface Skid {
  matrix: T.Matrix4;
  born: number;
}
export class RoadEffects {
  scorches: Scorch[] = [];
  trails = new Map<string, Trail>();
  soot = softTexture(true);
  smokeTexture = softTexture(false);
  skids: T.InstancedMesh<T.PlaneGeometry, T.MeshBasicMaterial>;
  segments: (Skid | undefined)[] = Array(900);
  nextSkid = 0;
  time = 0;
  smoke: { sprite: T.Sprite; age: number; velocity: T.Vector3 }[] = [];
  ray = new T.Raycaster();
  constructor(
    public scene: T.Scene,
    public surfaces: T.Mesh[],
  ) {
    this.skids = new T.InstancedMesh(
      new T.PlaneGeometry(0.22, 1).rotateX(-Math.PI / 2),
      new T.MeshBasicMaterial({
        color: '#141211',
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -1,
      }),
      900,
    );
    this.skids.name = 'drift-skids';
    this.skids.frustumCulled = false;
    this.skids.instanceMatrix.setUsage(T.DynamicDrawUsage);
    const zero = new T.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < 900; i++) this.skids.setMatrixAt(i, zero);
    this.scene.add(this.skids);
  }
  get scorchCount() {
    return this.scorches.length;
  }
  addScorch(position: Vec, seed: number) {
    const meshes: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial>[] = [];
    for (const surface of this.surfaces) {
      const geometry = scorchGeometry(surface, position, seed);
      if (!geometry.getAttribute('position').count) {
        geometry.dispose();
        continue;
      }
      const mesh = new T.Mesh(
        geometry,
        new T.MeshBasicMaterial({
          map: this.soot,
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -2,
          toneMapped: false,
        }),
      );
      mesh.name = 'explosion-scorch';
      mesh.renderOrder = 1;
      this.scene.add(mesh);
      meshes.push(mesh);
    }
    if (meshes.length) this.scorches.push({ meshes, age: 0 });
    while (this.scorches.length > 48) this.removeScorch(this.scorches.shift()!);
  }
  private removeScorch(mark: Scorch) {
    for (const mesh of mark.meshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
  private ground(p: T.Vector3) {
    this.ray.set(new T.Vector3(p.x, 5, p.z), new T.Vector3(0, -1, 0));
    return this.ray.intersectObjects(this.surfaces, false)[0]?.point ?? null;
  }
  private addSegment(from: T.Vector3, to: T.Vector3) {
    const length = from.distanceTo(to);
    if (length < 0.025 || length > 2.5) return;
    const mid = from.clone().add(to).multiplyScalar(0.5);
    mid.y += 0.018;
    const orientation = new T.Quaternion().setFromUnitVectors(
      new T.Vector3(0, 0, 1),
      to.clone().sub(from).normalize(),
    );
    const matrix = new T.Matrix4().compose(mid, orientation, new T.Vector3(1, 1, length + 0.05));
    this.segments[this.nextSkid] = { matrix, born: this.time };
    this.skids.setMatrixAt(this.nextSkid, matrix);
    this.nextSkid = (this.nextSkid + 1) % 900;
    this.skids.instanceMatrix.needsUpdate = true;
  }
  car(car: CarState, position: T.Vector3, now: number, active: boolean) {
    const slipping =
      active &&
      car.alive &&
      car.grounded &&
      (car.drift ?? 0) > 0.12 &&
      Math.abs(car.slip ?? 0) > 0.17 &&
      car.speed > 7;
    if (!slipping) {
      this.trails.delete(car.id);
      return;
    }
    const previous = this.trails.get(car.id);
    if (previous && now - previous.last < 75) return;
    const forward = new T.Vector3(Math.sin(car.yaw), 0, Math.cos(car.yaw)),
      side = new T.Vector3(forward.z, 0, -forward.x);
    const points = [-1, 1].map((sign) =>
      this.ground(
        position
          .clone()
          .addScaledVector(forward, -1)
          .addScaledVector(side, sign * 0.65),
      ),
    );
    for (let i = 0; i < 2; i++) {
      const p = points[i],
        sign = i === 0 ? -1 : 1;
      if (!p || position.y - p.y > 1.15) continue;
      if (previous?.points[i]) this.addSegment(previous.points[i]!, p);
      if (this.smoke.length >= 80) {
        const old = this.smoke.shift()!;
        this.scene.remove(old.sprite);
        old.sprite.material.dispose();
      }
      const sprite = new T.Sprite(
        new T.SpriteMaterial({
          map: this.smokeTexture,
          transparent: true,
          opacity: 0.25,
          depthWrite: false,
          color: '#d5c5aa',
        }),
      );
      sprite.position.copy(p);
      sprite.position.y += 0.25;
      sprite.scale.setScalar(0.8);
      this.scene.add(sprite);
      this.smoke.push({
        sprite,
        age: 0,
        velocity: forward
          .clone()
          .multiplyScalar(-1.2)
          .add(new T.Vector3(side.x * sign * 0.8, 1.2, side.z * sign * 0.8)),
      });
    }
    this.trails.set(car.id, { points, last: now });
  }
  update(dt: number) {
    this.time += dt;
    for (let i = this.scorches.length - 1; i >= 0; i--) {
      const s = this.scorches[i];
      s.age += dt;
      if (s.age >= 45) {
        this.removeScorch(s);
        this.scorches.splice(i, 1);
      } else for (const m of s.meshes) m.material.opacity = clamp((45 - s.age) / 10, 0, 1);
    }
    for (let i = 0; i < this.segments.length; i++) {
      const s = this.segments[i];
      if (!s) continue;
      const age = this.time - s.born;
      if (age > 14) {
        this.skids.setMatrixAt(i, new T.Matrix4().makeScale(0, 0, 0));
        this.segments[i] = undefined;
        this.skids.instanceMatrix.needsUpdate = true;
      }
    }
    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const p = this.smoke[i];
      p.age += dt;
      if (p.age > 0.7) {
        this.scene.remove(p.sprite);
        p.sprite.material.dispose();
        this.smoke.splice(i, 1);
        continue;
      }
      p.sprite.position.addScaledVector(p.velocity, dt);
      p.sprite.scale.setScalar(0.8 + p.age * 2);
      p.sprite.material.opacity = 0.25 * (1 - p.age / 0.7) ** 2;
    }
  }
  clear() {
    for (const mark of this.scorches) this.removeScorch(mark);
    this.scorches = [];
    this.trails.clear();
    this.segments.fill(undefined);
    for (let i = 0; i < 900; i++) this.skids.setMatrixAt(i, new T.Matrix4().makeScale(0, 0, 0));
    this.skids.instanceMatrix.needsUpdate = true;
    for (const p of this.smoke) {
      this.scene.remove(p.sprite);
      p.sprite.material.dispose();
    }
    this.smoke = [];
  }
  destroy() {
    this.clear();
    this.scene.remove(this.skids);
    this.skids.geometry.dispose();
    this.skids.material.dispose();
    this.soot.dispose();
    this.smokeTexture.dispose();
  }
}
