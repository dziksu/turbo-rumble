import * as T from 'three';
import { cutTerrain } from '../shared/terrain.ts';
import type { Track } from '../shared/track.ts';
import { BIOME_GROUND_Y } from '../shared/biome-layout.ts';
import { createVolcanoLayout, type IslandPose } from './volcano-layout.ts';
import {
  tropicalTree,
  tropicalPlant,
  basaltRock,
  beachFurniture,
  craterGeometry,
  craterPoint,
} from './volcano-models.ts';

const UP = new T.Vector3(0, 1, 0),
  CELL = 128;
function lavaMaterial() {
  return new T.ShaderMaterial({
    fog: true,
    toneMapped: false,
    side: T.DoubleSide,
    uniforms: T.UniformsUtils.merge([T.UniformsLib.fog, { uTime: { value: 0 } }]),
    vertexShader: `varying vec2 vLava;
      #include <fog_pars_vertex>
      void main(){vLava=(modelMatrix*vec4(position,1.)).xz;vec4 mvPosition=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `uniform float uTime; varying vec2 vLava;
      #include <fog_pars_fragment>
      void main(){
        vec2 p=vLava*.48;float t=uTime*.09;
        float a=sin(p.x+.55*sin(p.y*1.3+t));
        float b=sin(p.y*.9-.4*sin(p.x*1.1-t*.7));
        float vein=abs(a*b);
        float heat=1.-smoothstep(.025,.20,vein);
        float core=1.-smoothstep(.005,.044,vein);
        vec3 crust=mix(vec3(.075,.042,.031),vec3(.29,.062,.022),.5+.5*sin(p.x*1.7+p.y*.6));
        vec3 color=mix(crust,vec3(1.,.22,.012),heat);
        color=mix(color,vec3(1.,.70,.12),core*(.88+.12*sin(t+p.y)));
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}
function smokeTexture() {
  const data = new Uint8Array(32 * 32 * 4);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const i = (y * 32 + x) * 4,
        d = Math.hypot((x - 15.5) / 15.5, (y - 15.5) / 15.5),
        n = 0.86 + 0.14 * Math.sin(x * 1.7 + y * 2.3);
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(Math.max(0, 1 - d) ** 1.7 * n * 255);
    }
  const tex = new T.DataTexture(data, 32, 32);
  tex.needsUpdate = true;
  return tex;
}
function colouredMesh(pos: number[], colors: number[], indices: number[], material: T.Material) {
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return new T.Mesh(g, material);
}

/** Instanced tropical island, one lava shader and two reused particle buffers. */
export class VolcanoScenery {
  readonly root = new T.Group();
  readonly layout: ReturnType<typeof createVolcanoLayout>;
  readonly lava = lavaMaterial();
  readonly smoke: T.Points;
  readonly embers: T.Points;
  readonly surf: T.Mesh[] = [];
  private readonly solid = new T.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.96,
    flatShading: true,
  });
  private readonly leaves = new T.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    flatShading: true,
    side: T.DoubleSide,
    shadowSide: T.FrontSide,
  });
  private readonly matrix = new T.Matrix4();
  private readonly rotation = new T.Quaternion();
  private readonly scale = new T.Vector3();
  private readonly smokePositions = new Float32Array(54 * 3);
  private readonly emberPositions = new Float32Array(160 * 3);
  private readonly center: T.Vector3;

  private instances(
    geometry: T.BufferGeometry,
    poses: IslandPose[],
    name: string,
    cast = true,
    leaves = false,
  ) {
    if (!poses.length) {
      geometry.dispose();
      return;
    }
    const cells = new Map<string, IslandPose[]>();
    for (const p of poses) {
      const key = `${Math.floor(p.position.x / CELL)}/${Math.floor(p.position.z / CELL)}`;
      const cell = cells.get(key) ?? [];
      cell.push(p);
      cells.set(key, cell);
    }
    for (const cell of cells.values()) {
      const mesh = new T.InstancedMesh(geometry, leaves ? this.leaves : this.solid, cell.length);
      for (const [i, p] of cell.entries()) {
        this.scale.setScalar(p.scale);
        this.rotation.setFromAxisAngle(UP, p.yaw);
        mesh.setMatrixAt(i, this.matrix.compose(p.position, this.rotation, this.scale));
        mesh.setColorAt(i, new T.Color().setScalar(0.88 + (p.variant % 4) * 0.07));
      }
      mesh.name = name;
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.computeBoundingSphere();
      this.root.add(mesh);
    }
  }
  constructor(parent: T.Group, track: Track) {
    this.layout = createVolcanoLayout(track);
    this.center = track.OVERVIEW_CENTER.clone();
    this.root.name = 'aloha-tropical-island';
    parent.add(this.root);
    for (let kind = 0; kind < 3; kind++)
      this.instances(
        tropicalTree(kind),
        this.layout.trees.filter((p) => p.variant === kind),
        'aloha-tree-' + kind,
        true,
        true,
      );
    const crags: IslandPose[] = [];
    for (const ring of [1, 2, 4])
      for (let i = 0; i < 48; i += ring === 4 ? 2 : 3) {
        const scale = ring === 4 ? 1.3 + (i % 5) * 0.17 : 2.4 + (i % 4) * 0.45;
        const position = craterPoint(track, ring, i);
        position.y -= scale * 0.55;
        crags.push({ position, yaw: i * 1.7, scale, variant: i % 3 });
      }
    this.instances(
      basaltRock(),
      [...this.layout.rocks.filter((p) => p.variant === 0), ...crags],
      'aloha-basalt-0',
    );
    this.instances(
      basaltRock(true),
      this.layout.rocks.filter((p) => p.variant === 1),
      'aloha-basalt-1',
    );
    this.instances(basaltRock(), this.layout.reef, 'aloha-offshore-rocks', false);
    this.instances(
      tropicalPlant(),
      this.layout.plants.filter((p) => p.variant !== 0),
      'aloha-banana-plants',
      false,
      true,
    );
    this.instances(
      tropicalPlant(true),
      this.layout.plants.filter((p) => p.variant === 0),
      'aloha-hibiscus',
      false,
      true,
    );
    this.instances(beachFurniture(), this.layout.furniture, 'aloha-beach-furniture');
    const crater = new T.Mesh(craterGeometry(track), this.solid);
    crater.name = 'aloha-faceted-crater';
    crater.castShadow = crater.receiveShadow = true;
    this.root.add(crater);
    const pool = new T.Mesh(new T.CircleGeometry(19, 48), this.lava);
    pool.rotation.x = -Math.PI / 2;
    pool.position.copy(this.center).setY(43.3);
    pool.name = 'aloha-crater-lava';
    this.root.add(pool);
    // All visible lava crossings keep their existing physical dimensions and launch/landing lines.
    const flowPositions: number[] = [],
      flowIndices: number[] = [];
    for (const gap of track.GAPS) {
      const at = track.trackAt(gap.s),
        v = flowPositions.length / 3;
      for (const [side, along] of [
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1],
      ]) {
        const p = at.p
          .clone()
          .addScaledVector(at.n, side * 90)
          .addScaledVector(at.t, along * (gap.length / 2 + 0.08));
        flowPositions.push(p.x, -1.6, p.z);
      }
      flowIndices.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
    }
    for (const sector of [2, 10, 19, 28, 37, 44]) {
      const v = flowPositions.length / 3;
      for (let ring = 4; ring >= 0; ring--)
        for (const edge of [-0.22, 0.22]) {
          const f = sector + edge,
            lo = Math.floor(f),
            u = f - lo;
          const p = craterPoint(track, ring, lo).lerp(craterPoint(track, ring, lo + 1), u);
          p.y += 0.2;
          flowPositions.push(p.x, p.y, p.z);
        }
      for (let i = 0; i < 4; i++) {
        const a = v + i * 2,
          b = a + 2;
        flowIndices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(flowPositions, 3));
    g.setIndex(flowIndices);
    g.computeVertexNormals();
    const flow = new T.Mesh(g, this.lava);
    flow.name = 'aloha-lava-flows';
    this.root.add(flow);
    this.coast(track);
    const particles = (positions: Float32Array, material: T.PointsMaterial, name: string) => {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(positions, 3).setUsage(T.DynamicDrawUsage));
      g.boundingSphere = new T.Sphere(this.center.clone().setY(30), 320);
      const points = new T.Points(g, material);
      points.name = name;
      this.root.add(points);
      return points;
    };
    this.smoke = particles(
      this.smokePositions,
      new T.PointsMaterial({
        map: smokeTexture(),
        color: '#d8d6c6',
        size: 22,
        transparent: true,
        opacity: 0.48,
        depthWrite: false,
      }),
      'aloha-volcanic-steam',
    );
    this.embers = particles(
      this.emberPositions,
      new T.PointsMaterial({
        color: '#ffd17d',
        size: 0.38,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        toneMapped: false,
      }),
      'aloha-lava-embers',
    );
    this.update(0, false);
  }
  private coast(track: Track) {
    const pos: number[] = [],
      col: number[] = [],
      idx: number[] = [],
      c = new T.Color();
    const rings = [240, 247, 267, 300, 1200],
      colors = ['#36b9b5', '#269ea9', '#167c94', '#125c79', '#125c79'];
    for (let ring = 0; ring < rings.length; ring++)
      for (let i = 0; i <= 96; i++) {
        const a = (i / 96) * Math.PI * 2,
          r = rings[ring];
        pos.push(Math.sin(a) * r, -1.8, Math.cos(a) * r);
        c.set(colors[ring]);
        col.push(c.r, c.g, c.b);
        if (ring && i) {
          const a = (ring - 1) * 97 + i - 1,
            b = ring * 97 + i - 1;
          idx.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
    const ocean = colouredMesh(pos, col, idx, new T.MeshBasicMaterial({ vertexColors: true }));
    ocean.name = 'aloha-turquoise-ocean';
    this.root.add(ocean);
    const beachPos: number[] = [],
      beachCol: number[] = [],
      beachIdx: number[] = [];
    const cuts = track.GAPS.map((g) => ({
      ...track.trackAt(g.s),
      halfWidth: 90,
      halfLength: g.length / 2 + 0.08,
    }));
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2,
        b = ((i + 1) / 64) * Math.PI * 2,
        mid = (a + b) / 2,
        apothem = Math.cos(Math.PI / 64);
      const point = (angle: number, r: number) => ({
        x: Math.sin(angle) * r,
        z: Math.cos(angle) * r,
      });
      const data = cutTerrain(cuts, BIOME_GROUND_Y, 320, [
        point(a, 240),
        point(a, 246),
        point(b, 246),
        point(b, 240),
      ]);
      const offset = beachPos.length / 3;
      for (let j = 0; j < data.vertices.length; j += 3) {
        const x = data.vertices[j],
          z = data.vertices[j + 2],
          u = T.MathUtils.clamp(
            ((x * Math.sin(mid) + z * Math.cos(mid)) / apothem - 240) / 6,
            0,
            1,
          );
        beachPos.push(x, T.MathUtils.lerp(BIOME_GROUND_Y, -1.74, u), z);
        c.set('#dbc48b').lerp(new T.Color('#75b3a0'), u);
        beachCol.push(c.r, c.g, c.b);
      }
      for (const index of data.indices) beachIdx.push(offset + index);
    }
    const beach = colouredMesh(
      beachPos,
      beachCol,
      beachIdx,
      new T.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
    );
    beach.name = 'aloha-sandy-shore';
    beach.receiveShadow = true;
    this.root.add(beach);
    for (let i = 0; i < 3; i++) {
      const surf = new T.Mesh(
        new T.RingGeometry(246 + i * 3, 246.4 + i * 3, 96),
        new T.MeshBasicMaterial({
          color: '#c0e3d0',
          transparent: true,
          opacity: 0.3 - i * 0.05,
          depthWrite: false,
        }),
      );
      surf.rotation.x = -Math.PI / 2;
      surf.position.y = -1.68 + i * 0.015;
      surf.name = 'aloha-shore-break';
      this.root.add(surf);
      this.surf.push(surf);
    }
  }
  update(seconds: number, reducedMotion: boolean) {
    const t = reducedMotion ? 0 : seconds;
    this.lava.uniforms.uTime.value = t;
    for (let i = 0; i < 54; i++) {
      const f = (t * (i < 34 ? 0.05 : 0.17) + i * 0.271) % 1,
        angle = i * 2.399;
      const base = i < 34 ? this.center : this.layout.vents[i % this.layout.vents.length];
      const height = i < 34 ? 48 : 2,
        spread = i < 34 ? 3 + f * 12 : 1 + f * 3;
      this.smokePositions[i * 3] = base.x + Math.sin(angle) * spread + f * 5;
      this.smokePositions[i * 3 + 1] = height + f * (i < 34 ? 29 : 10);
      this.smokePositions[i * 3 + 2] = base.z + Math.cos(angle) * spread;
    }
    for (let i = 0; i < 160; i++) {
      const f = (t * 0.2 + i * 0.137) % 1,
        a = i * 2.399,
        vent = i % 4 === 0;
      const base = vent ? this.layout.vents[i % this.layout.vents.length] : this.center;
      const radius = vent ? 2 + f * 3 : 6 + Math.sin(i * 1.7) * 6 + f * 8;
      this.emberPositions[i * 3] = base.x + Math.sin(a) * radius;
      this.emberPositions[i * 3 + 1] = (vent ? 0 : 44) + Math.sin(f * Math.PI) * (vent ? 5 : 18);
      this.emberPositions[i * 3 + 2] = base.z + Math.cos(a) * radius;
    }
    this.smoke.geometry.getAttribute('position').needsUpdate = true;
    this.embers.geometry.getAttribute('position').needsUpdate = true;
    for (const [i, s] of this.surf.entries())
      s.scale.setScalar(1 + Math.sin(t * 0.35 + i * 1.9) * 0.002);
  }
}
