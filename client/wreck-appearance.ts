import { Mesh, MeshStandardMaterial, type Material, type Object3D } from 'three';

/** Per-car overrides: GLTF clones share their original materials with other drivers. */
export class WreckAppearance {
  private readonly surfaces: { mesh: Mesh; material: Material | Material[] }[] = [];
  private readonly wheels: { node: Object3D; visible: boolean }[];
  private charred: MeshStandardMaterial | null = null;

  constructor(root: Object3D, wheels: readonly Object3D[]) {
    root.traverse((object) => {
      if (object instanceof Mesh) this.surfaces.push({ mesh: object, material: object.material });
    });
    this.wheels = wheels.map((node) => ({ node, visible: node.visible }));
  }

  setWrecked(wrecked: boolean) {
    if (wrecked === (this.charred !== null)) return;
    if (wrecked) {
      this.charred = new MeshStandardMaterial({ color: '#11100f', roughness: 1, metalness: 0 });
      for (const { mesh } of this.surfaces) mesh.material = this.charred;
      for (const { node } of this.wheels) node.visible = false;
    } else {
      for (const { mesh, material } of this.surfaces) mesh.material = material;
      for (const { node, visible } of this.wheels) node.visible = visible;
      this.charred?.dispose();
      this.charred = null;
    }
  }

  dispose() {
    // Restore source references before disposeResources distinguishes shared and owned assets.
    this.setWrecked(false);
  }
}
