import {
  Mesh,
  MeshStandardMaterial,
  MeshPhysicalMaterial,
  type Material,
  type Object3D,
} from 'three';

/** Per-car overrides: GLTF clones share their original materials with other drivers. */
export class WreckAppearance {
  private readonly surfaces: { mesh: Mesh; material: Material | Material[] }[] = [];
  private readonly wheels: { node: Object3D; visible: boolean }[];
  private charred: MeshStandardMaterial | null = null;
  private ice: MeshPhysicalMaterial | null = null;
  private frozen = false;

  constructor(root: Object3D, wheels: readonly Object3D[]) {
    root.traverse((object) => {
      if (object instanceof Mesh) this.surfaces.push({ mesh: object, material: object.material });
    });
    this.wheels = wheels.map((node) => ({ node, visible: node.visible }));
  }

  setFrozen(frozen: boolean) {
    if (this.frozen === frozen) return;
    this.frozen = frozen;
    if (frozen)
      this.ice ??= new MeshPhysicalMaterial({
        color: '#a8edff',
        emissive: '#0d3040',
        emissiveIntensity: 0.18,
        roughness: 0.16,
        metalness: 0.08,
        clearcoat: 1,
        clearcoatRoughness: 0.08,
        flatShading: true,
      });
    if (!this.charred)
      for (const { mesh, material } of this.surfaces) mesh.material = frozen ? this.ice! : material;
  }

  setWrecked(wrecked: boolean) {
    if (wrecked === (this.charred !== null)) return;
    if (wrecked) {
      this.charred = new MeshStandardMaterial({ color: '#11100f', roughness: 1, metalness: 0 });
      for (const { mesh } of this.surfaces) mesh.material = this.charred;
      for (const { node } of this.wheels) node.visible = false;
    } else {
      for (const { mesh, material } of this.surfaces)
        mesh.material = this.frozen ? this.ice! : material;
      for (const { node, visible } of this.wheels) node.visible = visible;
      this.charred?.dispose();
      this.charred = null;
    }
  }

  dispose() {
    // Restore source references before disposeResources distinguishes shared and owned assets.
    this.setFrozen(false);
    this.setWrecked(false);
    this.ice?.dispose();
    this.ice = null;
  }
}
