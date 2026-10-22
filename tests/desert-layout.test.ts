import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { before, test } from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import { Box3, Quaternion, Vector3 } from 'three';
import { Race, initPhysics } from '../shared/simulation.ts';
import { getTrack } from '../shared/track.ts';
import { DESERT_GROUND_Y } from '../shared/desert-layout.ts';
import { desertAssetMatrix } from '../client/desert-scenery.ts';

before(initPhysics);
const track = getTrack();
const down = { x: 0, y: -1, z: 0 };
function fixture(s: number, lane = 0, bots = false) {
  const race = new Race(751);
  for (let slot = 0; slot < 3; slot++)
    race.addDriver({
      id: `p${slot}`,
      name: `Desert ${slot}`,
      slot,
      bot: bots,
      connected: true,
      ready: true,
      wins: 0,
    });
  race.start();
  race.phase = 'racing';
  race.roundStart = race.tick;
  for (const [index, car] of [...race.cars.values()].entries()) {
    const at = track.trackAt(s + index * 6);
    const position = at.p
      .clone()
      .addScaledVector(at.n, index === 0 ? lane : index === 1 ? -2.5 : 2.5);
    car.progress = s + index * 6;
    car.body.setTranslation({ ...position, y: 0.6 }, true);
    car.body.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), at.yaw), true);
    car.body.setLinvel(at.t.clone().multiplyScalar(17), true);
    car.invulnerableUntil = 100000;
    car.weapon = null;
  }
  race.cameraProgress = s - 4;
  race.world.step();
  return race;
}
function drive(race: Race, ticks: number) {
  for (let i = 0; i < ticks; i++) {
    for (const car of race.cars.values()) {
      car.weapon = null;
      race.input(car.id, { seq: car.input.seq + 1, left: false, right: false, actionSeq: 0 });
    }
    race.cameraProgress = race.cars.get('p0')!.progress - 4;
    race.step();
  }
}

test('Sundown Junction has wider plazas, a continuous seam, two bridges and a compact exact terrain mesh', () => {
  assert.equal(track.TRACK_NAME, 'Sundown Junction');
  assert.ok(track.TRACK_LENGTH > 1050);
  const widths = Array.from(
    { length: 1000 },
    (_, i) => track.trackAt((i / 1000) * track.TRACK_LENGTH).width,
  );
  assert.ok(Math.min(...widths) >= 8);
  assert.equal(Math.max(...widths), 17);
  assert.equal(track.trackAt(0).width, track.trackAt(track.TRACK_LENGTH).width);
  assert.ok(
    track.desert!.objects.filter((object) => object.asset.includes('building')).length >= 20,
  );
  assert.equal(track.desert!.bridges.length, 2);
  assert.ok(
    track.terrainGeometry()!.indices.length / 3 < 40,
    'exact canyon cuts should not require a dense collision grid',
  );
});

test('wide racing lanes and dirt shoulders physically support cars without a roadside fall', () => {
  for (const [u, lane] of [
    [0.045, 12],
    [0.18, 13],
  ] as const) {
    const race = fixture(u * track.TRACK_LENGTH, lane);
    try {
      const start = race.cars.get('p0')!.progress;
      drive(race, 55);
      const car = race.cars.get('p0')!,
        p = car.body.translation();
      assert.equal(car.alive, true);
      assert.ok(car.progress > start + 12, 'wide/offroad travel still advances race progress');
      assert.ok(p.y > DESERT_GROUND_Y + 0.35 && p.y < 0.9, `supported car y=${p.y}`);
    } finally {
      race.dispose();
    }
  }
});

test('bridge decks and guardrails are physical while canyon ground is genuinely absent', () => {
  const race = fixture(20);
  try {
    for (const bridge of track.desert!.bridges) {
      const at = track.trackAt(bridge.s);
      assert.ok(race.world.castRay(new RAPIER.Ray({ ...at.p, y: 2 }, down), 3, true));
      for (const side of [-1, 1]) {
        const canyon = at.p.clone().addScaledVector(at.n, side * (at.width + 6));
        assert.equal(
          race.world.castRay(new RAPIER.Ray({ ...canyon, y: 1 }, down), 4, true),
          null,
          'no invisible ground beside the bridge',
        );
        const rail = race.world.castRay(
          new RAPIER.Ray({ ...at.p, y: 0.65 }, at.n.clone().multiplyScalar(side)),
          at.width + 3,
          true,
          RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC,
        );
        assert.ok(
          rail && rail.timeOfImpact > at.width - 1 && rail.timeOfImpact < at.width + 1,
          'solid guardrail follows actual bridge width',
        );
      }
      for (const end of [-1, 1]) {
        const bank = track.trackAt(bridge.s + end * (bridge.length / 2 + 14));
        const p = bank.p.addScaledVector(bank.n, bank.width + 3);
        assert.ok(
          race.world.castRay(new RAPIER.Ray({ ...p, y: 1 }, down), 2, true),
          'both banks connect to solid ground',
        );
      }
    }
  } finally {
    race.dispose();
  }
});

for (const index of [0, 1])
  test(`cars cross bridge ${index + 1} on ordinary driving physics`, () => {
    const bridge = track.desert!.bridges[index];
    const start = bridge.s - bridge.length / 2 - 12;
    const race = fixture(start, 0, true);
    try {
      for (const body of race.obstacleBodies.values()) body.setEnabled(false);
      for (let i = 0; i < 360; i++) {
        drive(race, 1);
        if (race.cars.get('p0')!.progress > bridge.s + bridge.length / 2 + 8) break;
      }
      const car = race.cars.get('p0')!;
      assert.equal(car.alive, true);
      assert.ok(car.progress > bridge.s + bridge.length / 2 + 8, `bridge progress ${car.progress}`);
      assert.ok(car.body.translation().y > 0.3);
    } finally {
      race.dispose();
    }
  });

test('downloaded houses and rocks have solid colliders with matching visual bounds and complete local dependencies', () => {
  const race = fixture(20);
  try {
    for (const object of track.desert!.objects) {
      const file = new URL(`../public/assets/desert/${object.asset}.glb`, import.meta.url);
      assert.ok(existsSync(file), object.asset);
      const binary = readFileSync(file);
      const gltf = JSON.parse(binary.subarray(20, 20 + binary.readUInt32LE(12)).toString());
      for (const image of gltf.images ?? [])
        if (image.uri && !image.uri.startsWith('data:'))
          assert.ok(existsSync(new URL(image.uri, file)), `${object.asset}: ${image.uri}`);
      const hit = race.world.castRay(
        new RAPIER.Ray(object.position.clone().add(new Vector3(0, object.size.y + 1, 0)), down),
        object.size.y + 2,
        true,
        RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC,
      );
      assert.ok(hit, `${object.id} is solid`);
      const bounds = new Box3(new Vector3(-1, -0.2, -2), new Vector3(2, 3, 2));
      const fitted = bounds.clone().applyMatrix4(desertAssetMatrix(bounds, { ...object, yaw: 0 }));
      assert.ok(fitted.getSize(new Vector3()).distanceTo(object.size) < 1e-6);
      assert.ok(
        Math.abs(fitted.min.y - object.position.y) < 1e-6,
        'model rests at the collider base',
      );
    }
    for (const pack of ['suburban', 'commercial', 'nature'])
      assert.match(
        readFileSync(
          new URL(`../public/assets/desert/${pack}/LICENSE.txt`, import.meta.url),
          'utf8',
        ),
        /CC0/i,
      );
  } finally {
    race.dispose();
  }
});

test('respawn grids avoid the fountain and bots take its two bypass lanes', () => {
  const race = fixture(track.TRACK_LENGTH * 0.087 - 60, 0, true);
  try {
    const next = race.gridProgress(track.TRACK_LENGTH * 0.087 + 5);
    for (const car of race.cars.values()) {
      const at = track.trackAt(next - Math.floor(car.slot / 4) * 5 - 5);
      const position = at.p
        .clone()
        .addScaledVector(at.n, ((car.slot % 4) - 1.5) * 2.7)
        .setY(0.75);
      assert.equal(
        race.world.intersectionWithShape(
          position,
          new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), at.yaw),
          car.body.collider(0).shape,
          RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC,
        ),
        null,
      );
    }
    for (const body of race.obstacleBodies.values()) body.setEnabled(false);
    const finish = track.TRACK_LENGTH * 0.087 + 12;
    for (let i = 0; i < 300 && race.cars.get('p0')!.progress < finish; i++) drive(race, 1);
    assert.ok(
      race.cars.get('p0')!.progress > finish,
      'bot does not get stuck driving into the fountain',
    );
    assert.ok(Math.abs(track.botLane(track.TRACK_LENGTH * 0.087, 0)) > 6);
    assert.ok(
      track.botLane(track.TRACK_LENGTH * 0.087, 0) * track.botLane(track.TRACK_LENGTH * 0.087, 1) <
        0,
    );
  } finally {
    race.dispose();
  }
});
