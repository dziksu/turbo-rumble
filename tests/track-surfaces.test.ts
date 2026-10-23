import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {
  curbGeometries,
  roadbedWallGeometry,
  guardrailGeometry,
  visibleRampGeometry,
  hasCenterDash,
  CURB_TILE_COUNT,
  SURFACE_HEIGHTS,
} from '../client/track-visuals.ts';
import { RAMPS, TRACK_LENGTH, rampGeometry, trackAt, getTrack } from '../shared/track.ts';
import { scorchGeometry } from '../client/race-effects.ts';

const down = new T.Vector3(0, -1, 0);
function surfaceHits(meshes: T.Mesh[], s: number, lateral: number) {
  const at = trackAt(s),
    p = at.p.addScaledVector(at.n, lateral).add(new T.Vector3(0, 15, 0));
  return new T.Raycaster(p, down).intersectObjects(meshes, false);
}

test('colored curbs have single coverage across every tile boundary and the closed-loop seam', () => {
  const geometries = curbGeometries(),
    meshes = geometries.map((geometry) => new T.Mesh(geometry, new T.MeshBasicMaterial()));
  try {
    for (let tile = 0; tile < CURB_TILE_COUNT; tile++)
      for (const offset of [-0.02, 0.02])
        for (const side of [-1, 1]) {
          const s = (tile / CURB_TILE_COUNT) * TRACK_LENGTH + offset,
            hits = surfaceHits(meshes, s, (trackAt(s).width - 0.28) * side);
          if (getTrack().isGap(s, 1)) continue;
          assert.equal(hits.length, 1, `Coverage at tile ${tile}, side ${side}, offset ${offset}`);
          assert.ok(
            Math.abs(
              hits[0].point.y - getTrack().surfaceHeight(hits[0].point) - SURFACE_HEIGHTS.curbTop,
            ) < 0.01,
          );
        }
  } finally {
    for (const mesh of meshes) {
      mesh.geometry.dispose();
      (mesh.material as T.Material).dispose();
    }
  }
});

test('guardrail tops do not overlap at the start/finish seam or curved joins', () => {
  const mesh = new T.Mesh(guardrailGeometry(), new T.MeshBasicMaterial());
  try {
    for (let s = 0; s < TRACK_LENGTH; s += 0.73)
      for (const side of [-1, 1]) {
        const hits = surfaceHits([mesh], s, (trackAt(s).width + 0.45) * side);
        assert.ok(hits.length <= 1, `Overlapping rails at ${s.toFixed(2)}, side ${side}`);
        if (
          !getTrack().hasGuardrail(s) &&
          !getTrack().hasGuardrail(s - 3) &&
          !getTrack().hasGuardrail(s + 3)
        )
          assert.equal(hits.length, 0, 'Knock-out openings remain open');
      }
  } finally {
    mesh.geometry.dispose();
    (mesh.material as T.Material).dispose();
  }
});

test('cliff walls contain vertical faces only and leave no overlapping horizontal box tops', () => {
  const geometry = roadbedWallGeometry();
  try {
    const positions = geometry.getAttribute('position'),
      normals = geometry.getAttribute('normal');
    for (let i = 0; i < positions.count; i++) {
      assert.ok(Math.abs(normals.getY(i)) < 1e-5);
      assert.ok(
        Math.abs(
          positions.getY(i) -
            getTrack().surfaceHeight({ z: positions.getZ(i) }) -
            SURFACE_HEIGHTS.shoulder,
        ) < 1e-6 || Math.abs(positions.getY(i) - -0.8) < 1e-6,
      );
    }
  } finally {
    geometry.dispose();
  }
});

test('visible ramp tops clear the asphalt while shared collision meshes retain their original shape', () => {
  for (const ramp of RAMPS) {
    const before = rampGeometry(ramp),
      geometry = visibleRampGeometry(ramp),
      positions = geometry.getAttribute('position');
    try {
      for (let vertex = 0; vertex < 4; vertex++) {
        assert.ok(positions.getY(vertex) > SURFACE_HEIGHTS.asphalt + 0.01);
        assert.equal(positions.getX(vertex), before.vertices[vertex * 3]);
        assert.equal(positions.getZ(vertex), before.vertices[vertex * 3 + 2]);
      }
      assert.deepEqual(rampGeometry(ramp), before);
      assert.ok(
        Math.abs(before.vertices[1] - getTrack().surfaceHeight({ z: before.vertices[2] }) + 0.03) <
          1e-6,
      );
    } finally {
      geometry.dispose();
    }
  }
});

test('center dashes leave the checkered start line unobstructed on both sides of the loop', () => {
  for (let s = 0; s < TRACK_LENGTH; s += 3.2)
    if (hasCenterDash(s)) assert.ok(Math.min(s, TRACK_LENGTH - s) > 2);
  assert.equal(hasCenterDash(0), false);
  assert.equal(hasCenterDash(9.6), false);
  assert.equal(hasCenterDash(9.6, getTrack('forest')), true);
});

test('scorches stay on the ramp top without projecting duplicate marks onto sides and underside', () => {
  for (const ramp of RAMPS) {
    const mesh = new T.Mesh(visibleRampGeometry(ramp)),
      at = trackAt(ramp.s),
      origin = at.p.addScaledVector(at.n, ramp.side),
      decal = scorchGeometry(mesh, origin);
    try {
      const normals = decal.getAttribute('normal');
      assert.ok(normals.count > 0);
      for (let i = 0; i < normals.count; i++) assert.ok(normals.getY(i) > 0.4);
      assert.equal(decal.getAttribute('uv').count, decal.getAttribute('position').count);
    } finally {
      decal.dispose();
      mesh.geometry.dispose();
      (mesh.material as T.Material).dispose();
    }
  }
});
