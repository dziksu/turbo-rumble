import * as T from 'three';

function collect(roots: readonly T.Object3D[]) {
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>(),
    textures = new Set<T.Texture>();
  for (const root of roots)
    root.traverse((object) => {
      if (object instanceof T.Mesh || object instanceof T.Sprite) {
        if (object instanceof T.Mesh) geometries.add(object.geometry);
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          materials.add(material);
          for (const value of Object.values(material))
            if (value instanceof T.Texture) textures.add(value);
        }
      }
    });
  return { geometries, materials, textures };
}

// GLTF clones share geometry, materials and textures with their source models.
// Retain those assets while disposing labels, rings and other per-player resources.
export function disposeResources(
  roots: readonly T.Object3D[],
  retainedRoots: readonly T.Object3D[] = [],
) {
  const owned = collect(roots),
    retained = collect(retainedRoots);
  for (const geometry of owned.geometries)
    if (!retained.geometries.has(geometry)) geometry.dispose();
  for (const material of owned.materials) if (!retained.materials.has(material)) material.dispose();
  for (const texture of owned.textures) if (!retained.textures.has(texture)) texture.dispose();
}
