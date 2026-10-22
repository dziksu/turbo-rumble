import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import { Group, Quaternion, Sprite, SpriteMaterial, Vector3 } from 'three';
import { Race, initPhysics } from '../shared/simulation.ts';
import { getTrack } from '../shared/track.ts';
import { movingHazardPose } from '../shared/biome-layout.ts';
import { addBiome } from '../client/biomes.ts';
import { disposeResources } from '../client/resources.ts';
before(initPhysics);
function raceOn(mapId: 'forest' | 'volcano') {
  const race = new Race(123, { mapId, lapLimit: 9, winningScore: 50 });
  for (let i = 0; i < 3; i++)
    race.addDriver({
      id: 'b' + i,
      name: 'Driver ' + i,
      slot: i,
      bot: false,
      connected: true,
      ready: true,
      wins: 0,
    });
  race.start();
  race.phase = 'racing';
  race.roundStart = race.tick;
  for (const car of race.cars.values()) {
    car.invulnerableUntil = 100000;
    car.weapon = null;
  }
  return race;
}
for (const mapId of ['forest', 'volcano'] as const) {
  test(`${mapId}: enlarged districts, solid shoulders and exact water/lava cuts share upward terrain geometry`, () => {
    const race = raceOn(mapId),
      track = race.track,
      layout = track.biome!;
    try {
      race.world.step();
      assert.ok(layout.props.length >= 16);
      assert.equal(layout.hazards.length, 2);
      for (const landmark of layout.landmarks) {
        const at = track.trackAt(landmark.s);
        assert.ok(at.width >= 12.5);
        for (const side of [-1, 1]) {
          const p = at.p.clone().addScaledVector(at.n, side * (at.width + 4));
          assert.ok(
            race.world.castRay(new RAPIER.Ray({ ...p, y: 1 }, { x: 0, y: -1, z: 0 }), 2, true),
          );
        }
      }
      for (const gap of track.GAPS)
        for (const side of [-1, 0, 1]) {
          const at = track.trackAt(gap.s),
            p = at.p.clone().addScaledVector(at.n, side * 15);
          assert.equal(
            race.world.castRay(new RAPIER.Ray({ ...p, y: 0.5 }, { x: 0, y: -1, z: 0 }), 2.5, true),
            null,
          );
        }
      const { vertices, indices } = layout.terrain;
      for (let i = 0; i < indices.length; i += 3) {
        const a = indices[i] * 3,
          b = indices[i + 1] * 3,
          c = indices[i + 2] * 3;
        const ny =
          (vertices[b + 2] - vertices[a + 2]) * (vertices[c] - vertices[a]) -
          (vertices[b] - vertices[a]) * (vertices[c + 2] - vertices[a + 2]);
        assert.ok(ny > 0, 'terrain normals face the sky');
      }
    } finally {
      race.dispose();
    }
  });
  test(`${mapId}: server-driven arms move, stay synchronized in snapshots, freeze on pause and reset in lobby`, () => {
    const race = raceOn(mapId),
      other = raceOn(mapId),
      hazard = race.track.biome!.hazards[0],
      body = race.movingHazards.get(hazard.id)!;
    try {
      assert.ok(body.isKinematic());
      const initial = { ...body.rotation() };
      for (let i = 0; i < 50; i++) race.step();
      assert.notDeepEqual(body.rotation(), initial);
      const expected = movingHazardPose(hazard, race.hazardTick);
      const actual = new Quaternion().copy(body.rotation()).normalize();
      assert.ok(actual.angleTo(expected.rotation.normalize()) < 1e-4);
      const state = race.snapshot('BIOME').obstacles!.find((o) => o.id === hazard.id)!;
      assert.deepEqual(state.rotation, { ...body.rotation() });
      assert.deepEqual(
        { ...other.movingHazards.get(hazard.id)!.rotation() },
        initial,
        'another room is independent',
      );
      const frozen = { ...body.rotation() },
        tick = race.hazardTick;
      race.pause();
      for (let i = 0; i < 20; i++) race.step();
      assert.equal(race.hazardTick, tick);
      assert.deepEqual({ ...body.rotation() }, frozen);
      race.resume();
      race.step();
      assert.notDeepEqual(body.rotation(), frozen);
      race.lobby();
      assert.equal(race.hazardTick, 0);
      assert.deepEqual({ ...body.rotation() }, initial);
    } finally {
      race.dispose();
      other.dispose();
    }
  });
  test(`${mapId}: a moving arm physically pushes a braking car`, () => {
    const race = raceOn(mapId),
      hazard = race.track.biome!.hazards[0],
      car = race.cars.get('b0')!;
    try {
      const offset = new Vector3(2.8, 0, -1.8).applyAxisAngle(new Vector3(0, 1, 0), hazard.yaw);
      const start = hazard.position.clone().add(offset).setY(0.6);
      car.body.setTranslation(start, true);
      car.body.setRotation(
        new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), hazard.yaw),
        true,
      );
      car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      car.progress = hazard.s;
      let displaced = 0;
      for (let i = 0; i < 120; i++) {
        race.cameraProgress = hazard.s;
        race.input(car.id, { seq: i + 1, left: true, right: true, actionSeq: 0 });
        race.step();
        displaced = Math.max(
          displaced,
          new Vector3(car.body.translation().x, 0, car.body.translation().z).distanceTo(
            new Vector3(start.x, 0, start.z),
          ),
        );
      }
      assert.ok(displaced > 0.7, `physical push ${displaced.toFixed(2)}m`);
      assert.ok(car.alive, 'the arm pushes rather than applying a scripted death');
    } finally {
      race.dispose();
    }
  });
  test(`${mapId}: respawn grids avoid the complete sweep zone, and scenery updates allocate no extra objects`, () => {
    const race = raceOn(mapId),
      track = getTrack(mapId),
      layout = track.biome!;
    const root = new Group(),
      scenery = addBiome(root, track, () => new Sprite(new SpriteMaterial()))!;
    try {
      for (const hazard of layout.hazards) {
        const origin = race.gridProgress(hazard.s);
        for (const car of race.cars.values()) {
          const s = origin - Math.floor(car.slot / 4) * 5 - 5;
          assert.ok(Math.abs(s - hazard.s) >= 10);
        }
        const group = scenery.moving.get(hazard.id)!;
        const pose = movingHazardPose(hazard, 0);
        assert.ok(group.position.distanceTo(pose.position) < 1e-8);
        assert.ok(group.quaternion.equals(pose.rotation));
      }
      let count = 0;
      root.traverse(() => count++);
      for (let i = 0; i < 200; i++) scenery.update(i / 25, false);
      let after = 0;
      root.traverse(() => after++);
      assert.equal(after, count);
      scenery.update(0, true);
      const positions: Vector3[] = [];
      root.traverse((node) => positions.push(node.position.clone()));
      scenery.update(99, true);
      let index = 0;
      root.traverse((node) => assert.ok(node.position.equals(positions[index++])));
    } finally {
      disposeResources([root]);
      race.dispose();
    }
  });
}
