import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as T from 'three';
import { SceneLighting } from '../client/scene-lighting.ts';
import { getTrack } from '../shared/track.ts';
import type { MapId } from '../shared/maps.ts';

function assertInShadowCamera(lighting: SceneLighting, point: T.Vector3, context: string) {
  const camera = lighting.sun.shadow.camera;
  const clip = point
    .clone()
    .applyMatrix4(camera.matrixWorldInverse)
    .applyMatrix4(camera.projectionMatrix);
  assert.ok(
    Math.abs(clip.x) <= 1 && Math.abs(clip.y) <= 1 && Math.abs(clip.z) <= 1,
    `${context}: ${clip.toArray()}`,
  );
}

test('overview shadows cover every road segment and tall scenery on all maps, including switches', () => {
  const scene = new T.Scene(),
    lighting = new SceneLighting(scene);
  try {
    for (const id of ['desert', 'forest', 'volcano', 'desert'] satisfies MapId[]) {
      const track = getTrack(id);
      lighting.setMap(track);
      lighting.update(track.OVERVIEW_CENTER, track.OVERVIEW_RADIUS + 70, false);
      assert.equal(scene.children.length, 4);
      assert.equal(
        scene.children.filter((light) => light instanceof T.DirectionalLight && light.castShadow)
          .length,
        1,
      );
      for (let s = 0; s < track.TRACK_LENGTH; s += 10) {
        const at = track.trackAt(s);
        for (const side of [-1, 1]) {
          const point = at.p.clone().addScaledVector(at.n, side * (at.width + 25));
          for (const y of [-8, 65]) {
            point.y = y;
            assertInShadowCamera(lighting, point, `${id} overview at ${s}`);
          }
        }
      }
    }
  } finally {
    lighting.destroy();
  }
  assert.equal(scene.children.length, 0);
});

test('race shadows follow the complete track instead of a fixed window at the origin', () => {
  const lighting = new SceneLighting(new T.Scene());
  try {
    for (const id of ['desert', 'forest', 'volcano'] satisfies MapId[]) {
      const track = getTrack(id);
      lighting.setMap(track);
      for (let s = 0; s < track.TRACK_LENGTH; s += 20) {
        const pose = track.cameraPose(s);
        lighting.update(pose.target, 120, true);
        for (const ahead of [-20, 0, 40]) {
          const at = track.trackAt(s + ahead);
          for (const side of [-1, 1]) {
            const point = at.p.clone().addScaledVector(at.n, side * (at.width + 10));
            for (const y of [-5, 50]) {
              point.y = y;
              assertInShadowCamera(lighting, point, `${id} race at ${s}`);
            }
          }
        }
      }
    }
  } finally {
    lighting.destroy();
  }
});

test('shadow texture budget reuses only static maps and refreshes moving cars on every rendered frame', () => {
  const lighting = new SceneLighting(new T.Scene(), 1500),
    track = getTrack();
  const focus = track.OVERVIEW_CENTER.clone();
  try {
    assert.deepEqual(lighting.sun.shadow.mapSize.toArray(), [1024, 1024]);
    lighting.setMap(track);
    lighting.update(focus, 75, false);
    assert.equal(lighting.sun.shadow.needsUpdate, true);
    lighting.sun.shadow.needsUpdate = false; // Simulate a completed shadow render.
    lighting.update(focus, 75, false);
    assert.equal(lighting.sun.shadow.needsUpdate, false);
    lighting.update(focus, 75, true);
    assert.equal(lighting.sun.shadow.needsUpdate, true);
    lighting.sun.shadow.needsUpdate = false;
    for (let frame = 0; frame < 120; frame++) {
      lighting.sun.shadow.needsUpdate = false;
      lighting.update(focus, 75, true);
      assert.equal(lighting.sun.shadow.needsUpdate, true, `moving frame ${frame}`);
    }
    lighting.sun.shadow.needsUpdate = false;
    lighting.invalidate();
    lighting.update(focus, 75, false);
    assert.equal(lighting.sun.shadow.needsUpdate, true);
    lighting.sun.shadow.needsUpdate = false;
    focus.x += 0.000001;
    lighting.update(focus, 75, false);
    assert.equal(lighting.sun.shadow.needsUpdate, false, 'sub-texel movement should not shimmer');
    focus.x += 200;
    lighting.update(focus, 75, false);
    assert.equal(lighting.sun.shadow.needsUpdate, true);
  } finally {
    lighting.destroy();
  }
});

test('race shadows include visible ground corners on portrait, widescreen and ultrawide cameras', () => {
  const lighting = new SceneLighting(new T.Scene());
  try {
    for (const id of ['desert', 'forest', 'volcano'] satisfies MapId[]) {
      const track = getTrack(id);
      lighting.setMap(track);
      for (let s = 0; s < track.TRACK_LENGTH; s += 100) {
        const pose = track.cameraPose(s);
        for (const aspect of [390 / 844, 16 / 9, 21 / 9]) {
          const camera = new T.PerspectiveCamera(55, aspect, 1, 900);
          camera.position.copy(pose.position);
          camera.lookAt(pose.target);
          camera.updateMatrixWorld();
          lighting.update(pose.target, 120 * Math.max(1, aspect / 2), true);
          for (const x of [-1, 1])
            for (const y of [-1, 1]) {
              const ray = new T.Vector3(x, y, 0.5)
                .unproject(camera)
                .sub(camera.position)
                .normalize();
              const ground = camera.position
                .clone()
                .addScaledVector(ray, (-0.18 - camera.position.y) / ray.y);
              assertInShadowCamera(
                lighting,
                ground,
                `${id} visible corner ${x},${y} at ${s}, aspect ${aspect}`,
              );
            }
        }
      }
    }
  } finally {
    lighting.destroy();
  }
});

test('shadow depth range stays fixed while the camera follows a car around each map', () => {
  const lighting = new SceneLighting(new T.Scene());
  try {
    for (const id of ['desert', 'forest', 'volcano'] satisfies MapId[]) {
      const track = getTrack(id);
      lighting.setMap(track);
      const { near, far } = lighting.sun.shadow.camera;
      for (let s = 0; s < track.TRACK_LENGTH; s += 5) {
        lighting.update(track.cameraPose(s).target, 120, true);
        assert.equal(lighting.sun.shadow.camera.near, near);
        assert.equal(lighting.sun.shadow.camera.far, far);
      }
    }
  } finally {
    lighting.destroy();
  }
});
