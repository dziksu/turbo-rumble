import * as T from 'three';
import type { MapId } from '../shared/maps.ts';
import type { Track } from '../shared/track.ts';

// Ambient fill keeps car undersides readable; hemisphere fill preserves sky/ground contrast.
const PROFILES = {
  desert: {
    ambient: '#ffe6c4',
    sky: '#fff2da',
    ground: '#936747',
    fill: 1.3,
    sun: '#fff0c7',
    power: 2.5,
  },
  forest: {
    ambient: '#bacfce',
    sky: '#c9dfd7',
    ground: '#274533',
    fill: 1.35,
    sun: '#ffe8bb',
    power: 2.65,
  },
  volcano: {
    ambient: '#d2e8dc',
    sky: '#d0e9e2',
    ground: '#405645',
    fill: 1.5,
    sun: '#ffe6b6',
    power: 2.8,
  },
} satisfies Record<MapId, object>;

/** One native PCF shadow pass, shared by the overview and moving race camera. */
export class SceneLighting {
  readonly ambient = new T.AmbientLight('#ffffff', 0.3);
  readonly hemisphere = new T.HemisphereLight();
  readonly sun = new T.DirectionalLight();
  private readonly bounds = new T.Box3();
  private readonly corner = new T.Vector3();
  private readonly lightBounds = new T.Box3();
  private readonly center = new T.Vector3();
  private readonly size = new T.Vector3();
  private dirty = true;

  constructor(scene: T.Scene, maxTextureSize = 2048) {
    const resolution = Math.min(2048, 2 ** Math.floor(Math.log2(maxTextureSize)));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(resolution, resolution);
    this.sun.shadow.bias = -0.00015;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.autoUpdate = false;
    scene.add(this.ambient, this.hemisphere, this.sun, this.sun.target);
  }

  setMap(track: Track) {
    const profile = PROFILES[track.id];
    this.ambient.color.set(profile.ambient);
    this.hemisphere.color.set(profile.sky);
    this.hemisphere.groundColor.set(profile.ground);
    this.hemisphere.intensity = profile.fill;
    this.sun.color.set(profile.sun);
    this.sun.intensity = profile.power;
    // Keep the light basis fixed while moving only its orthographic window. Snapping that
    // window to shadow texels prevents camera movement from making static shadows shimmer.
    this.sun.target.position.copy(track.OVERVIEW_CENTER);
    this.sun.position
      .copy(track.OVERVIEW_CENTER)
      .add(track.id === 'forest' ? new T.Vector3(-450, 650, 180) : new T.Vector3(-400, 700, -400));
    this.sun.updateMatrixWorld(true);
    this.sun.target.updateMatrixWorld(true);
    this.sun.shadow.updateMatrices(this.sun);
    // Keep the depth encoding fixed for the whole map, including camera travel. Otherwise
    // near/far changes modulate depth precision and bias on the same moving car surface.
    const radius = track.OVERVIEW_RADIUS + 100,
      center = track.OVERVIEW_CENTER,
      camera = this.sun.shadow.camera;
    this.bounds.min.set(center.x - radius, -12, center.z - radius);
    this.bounds.max.set(center.x + radius, 85, center.z + radius);
    this.bounds.applyMatrix4(camera.matrixWorldInverse);
    camera.near = Math.max(0.5, -this.bounds.max.z - 20);
    camera.far = -this.bounds.min.z + 20;
    camera.updateProjectionMatrix();
    this.invalidate();
  }

  invalidate() {
    this.dirty = true;
  }

  update(focus: T.Vector3, radius: number, moving: boolean) {
    // Include tall buildings/trees and the volcano, even when their bases are off camera.
    this.bounds.min.set(focus.x - radius, -12, focus.z - radius);
    this.bounds.max.set(focus.x + radius, 85, focus.z + radius);
    this.lightBounds.makeEmpty();
    const camera = this.sun.shadow.camera;
    for (let i = 0; i < 8; i++) {
      this.corner
        .set(
          i & 1 ? this.bounds.max.x : this.bounds.min.x,
          i & 2 ? this.bounds.max.y : this.bounds.min.y,
          i & 4 ? this.bounds.max.z : this.bounds.min.z,
        )
        .applyMatrix4(camera.matrixWorldInverse);
      this.lightBounds.expandByPoint(this.corner);
    }
    this.lightBounds.getCenter(this.center);
    this.lightBounds.getSize(this.size);
    const width = this.size.x + 4,
      height = this.size.y + 4,
      texelX = width / this.sun.shadow.mapSize.x,
      texelY = height / this.sun.shadow.mapSize.y,
      x = Math.round(this.center.x / texelX) * texelX,
      y = Math.round(this.center.y / texelY) * texelY,
      left = x - width / 2,
      top = y + height / 2;
    const changed =
      Math.abs(camera.left - left) > 0.00001 ||
      Math.abs(camera.top - top) > 0.00001 ||
      Math.abs(camera.right - left - width) > 0.00001;
    // Cars interpolate on every display frame, regardless of the snapshot frequency.
    // Their shadow must use that exact pose too; reusing an older map causes flickering.
    if (!this.dirty && !changed && !moving) return;
    camera.left = left;
    camera.right = left + width;
    camera.top = top;
    camera.bottom = top - height;
    camera.updateProjectionMatrix();
    this.sun.shadow.needsUpdate = true;
    this.dirty = false;
  }

  destroy() {
    this.sun.shadow.dispose();
    this.ambient.removeFromParent();
    this.hemisphere.removeFromParent();
    this.sun.removeFromParent();
    this.sun.target.removeFromParent();
  }
}
