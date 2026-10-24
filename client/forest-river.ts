import * as T from 'three';
import type { ForestRiver } from '../shared/forest-river.ts';
import { BIOME_GROUND_Y } from '../shared/biome-layout.ts';

const WATER_Y = -1.6,
  UP = new T.Vector3(0, 1, 0);
/** Three continuous ribbons plus one animated instance batch, without overlapping water tiles. */
export class ForestRiverScenery {
  readonly foam: T.InstancedMesh;
  private matrix = new T.Matrix4();
  private position = new T.Vector3();
  private rotation = new T.Quaternion();
  private scale = new T.Vector3();
  constructor(
    root: T.Group,
    private river: ForestRiver,
  ) {
    const waterPositions: number[] = [],
      waterColors: number[] = [],
      waterIndices: number[] = [];
    const bankPositions: number[] = [],
      bankColors: number[] = [],
      bankIndices: number[] = [];
    const shallow = new T.Color('#419c9a'),
      deep = new T.Color('#155f79'),
      c = new T.Color();
    for (const [i, s] of river.sections.entries()) {
      for (const side of [-1, -0.7, 0, 0.7, 1]) {
        const p = s.p.clone().addScaledVector(s.n, s.halfWidth * side);
        waterPositions.push(p.x, WATER_Y, p.z);
        c.copy(deep).lerp(shallow, Math.abs(side) ** 2);
        waterColors.push(c.r, c.g, c.b);
      }
      if (i)
        for (let lane = 0; lane < 4; lane++) {
          const a = (i - 1) * 5 + lane,
            b = i * 5 + lane;
          waterIndices.push(a, b, a + 1, a + 1, b, b + 1);
        }
      for (const side of [-1, 1]) {
        const edge = s.p.clone().addScaledVector(s.n, side * s.halfWidth);
        for (const [height, offset, color] of [
          [-3.5, 0, '#394f4c'],
          [BIOME_GROUND_Y, 0, '#687b67'],
          [BIOME_GROUND_Y + 0.015, 0.65, '#4b6547'],
        ] as const) {
          const p = edge.clone().addScaledVector(s.n, side * offset);
          bankPositions.push(p.x, height, p.z);
          c.set(color);
          bankColors.push(c.r, c.g, c.b);
        }
      }
      if (i)
        for (let side = 0; side < 2; side++)
          for (let lane = 0; lane < 2; lane++) {
            const a = (i - 1) * 6 + side * 3 + lane,
              b = i * 6 + side * 3 + lane;
            if (side === 0) bankIndices.push(a, a + 1, b, a + 1, b + 1, b);
            else bankIndices.push(a, b, a + 1, a + 1, b, b + 1);
          }
    }
    const geometry = (p: number[], c: number[], idx: number[]) => {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(p, 3));
      g.setAttribute('color', new T.Float32BufferAttribute(c, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    const water = new T.Mesh(
      geometry(waterPositions, waterColors, waterIndices),
      new T.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.72,
        metalness: 0,
        emissive: '#153d46',
        emissiveIntensity: 0.16,
      }),
    );
    water.name = 'timber-continuous-river';
    water.receiveShadow = true;
    root.add(water);
    const banks = new T.Mesh(
      geometry(bankPositions, bankColors, bankIndices),
      new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, side: T.DoubleSide }),
    );
    banks.name = 'timber-meandering-banks';
    banks.receiveShadow = true;
    root.add(banks);
    this.foam = new T.InstancedMesh(
      new T.PlaneGeometry(1, 0.14),
      new T.MeshBasicMaterial({
        color: '#a6d9cd',
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      }),
      136,
    );
    this.foam.name = 'timber-river-current';
    this.foam.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.foam.boundingSphere = new T.Sphere(new T.Vector3(0, 0, 0), 520);
    root.add(this.foam);
    this.update(0, false);
  }
  update(seconds: number, reducedMotion: boolean) {
    const time = reducedMotion ? 0 : seconds;
    for (let i = 0; i < this.foam.count; i++) {
      const u = ((i / this.foam.count) * this.river.length + time * 1.8) % this.river.length;
      let index = 1;
      while (index < this.river.sections.length - 1 && this.river.sections[index].distance < u)
        index++;
      const a = this.river.sections[index - 1],
        b = this.river.sections[index],
        f = (u - a.distance) / (b.distance - a.distance);
      this.position
        .copy(a.p)
        .lerp(b.p, f)
        .addScaledVector(a.n, Math.sin(i * 2.4) * (a.halfWidth * 0.7))
        .setY(WATER_Y + 0.035);
      // Plane's long local X axis follows the current, with its normal facing up.
      this.rotation.setFromAxisAngle(UP, Math.atan2(-a.t.z, a.t.x));
      this.rotation.multiply(FLOOR_ROTATION);
      this.scale.set(1.4 + (i % 4) * 0.7, 1, 1);
      this.foam.setMatrixAt(i, this.matrix.compose(this.position, this.rotation, this.scale));
    }
    this.foam.instanceMatrix.needsUpdate = true;
  }
}
const FLOOR_ROTATION = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), -Math.PI / 2);
