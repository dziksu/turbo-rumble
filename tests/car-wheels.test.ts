import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Box3, Quaternion, Vector3, type Group } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { CarWheels } from '../client/car-wheels.ts';
import { introPose } from '../client/intro-motion.ts';
import { disposeResources } from '../client/resources.ts';
import { WreckAppearance } from '../client/wreck-appearance.ts';

/** Read the actual shipped geometry/transforms; omit textures so tests need no browser/image API. */
async function model(name: string): Promise<Group> {
  const source = await readFile(new URL(`../public/assets/cars/${name}.glb`, import.meta.url));
  const jsonLength = source.readUInt32LE(12);
  const gltf = JSON.parse(source.subarray(20, 20 + jsonLength).toString());
  delete gltf.materials;
  delete gltf.images;
  delete gltf.textures;
  for (const mesh of gltf.meshes)
    for (const primitive of mesh.primitives) delete primitive.material;
  const json = Buffer.from(JSON.stringify(gltf));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20);
  json.copy(padded);
  const binary = source.subarray(20 + jsonLength);
  const buffer = Buffer.alloc(20 + padded.length + binary.length);
  source.copy(buffer, 0, 0, 12);
  buffer.writeUInt32LE(buffer.length, 8);
  buffer.writeUInt32LE(padded.length, 12);
  buffer.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(buffer, 20);
  binary.copy(buffer, 20 + padded.length);
  const loaded = await new GLTFLoader().parseAsync(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    '',
  );
  const size = new Box3().setFromObject(loaded.scene).getSize(new Vector3());
  loaded.scene.scale.setScalar(3.65 / Math.max(size.x, size.z));
  return loaded.scene;
}

const identity = new Quaternion();
const at = (z: number, steering = 0, x = 0, moving = true, grounded = true) => ({
  position: { x, y: 0, z },
  rotation: identity,
  steering,
  moving,
  grounded,
});
const near = (actual: number, expected: number, message = '') =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} != ${expected}`);

for (const name of ['race', 'race-future', 'hatchback-sports', 'suv']) {
  test(`${name}: real model has four rolling wheels, correct axes/radii and fixed spare`, async () => {
    const root = await model(name);
    try {
      const wheels = new CarWheels(root);
      assert.equal(wheels.road.length, 4);
      assert.equal(wheels.road.filter((wheel) => wheel.front).length, 2);
      assert.equal(wheels.all.length, name === 'suv' ? 5 : 4);
      const spare = root.getObjectByName('wheel-back');
      const spareRotation = spare?.quaternion.clone();
      wheels.update(at(0), 0.02);
      wheels.update(at(0.1, 1), 0.02);
      for (const wheel of wheels.road) {
        assert.ok(wheel.radius > 0.35 && wheel.radius < 0.55);
        near(wheel.spin, 0.1 / wheel.radius);
        const axle = new Vector3(1, 0, 0).applyQuaternion(wheel.node.quaternion);
        near(axle.y, 0, 'rolling must not tilt the steering axle');
        near(axle.z, wheel.front ? -Math.sin(0.52) : 0, 'left steering direction');
        const tread = new Vector3(0, -wheel.radius, 0).applyQuaternion(wheel.node.quaternion);
        assert.ok(
          tread.z < 0,
          'the bottom tread rolls backwards relative to the forward-moving hub',
        );
      }
      wheels.update(at(0.1, -1), 0.02);
      for (const wheel of wheels.road) {
        const axle = new Vector3(1, 0, 0).applyQuaternion(wheel.node.quaternion);
        near(axle.z, wheel.front ? Math.sin(0.52) : 0, 'right steering direction');
      }
      wheels.update(at(0.1), 0.02);
      const spins = wheels.road.map((wheel) => wheel.spin);
      wheels.update(at(0.1, 0, 0.5), 0.02);
      assert.deepEqual(
        wheels.road.map((wheel) => wheel.spin),
        spins,
        'pure sideways sliding',
      );
      wheels.update(at(0, 0, 0.5), 0.02);
      for (const wheel of wheels.road) near(wheel.spin, 0, 'reverse travel cancels forward roll');
      if (spare && spareRotation) assert.ok(spare.quaternion.equals(spareRotation));
    } finally {
      disposeResources([root]);
    }
  });

  test(`${name}: pause, jumps, teleports, wreck and respawn preserve animation isolation`, async () => {
    const source = await model(name);
    const root = clone(source);
    const wheels = new CarWheels(root);
    const appearance = new WreckAppearance(root, wheels.all);
    try {
      wheels.update(at(0), 0.02);
      wheels.update(at(0.2, 1), 0.02);
      const spin = wheels.road[0].spin;
      const pose = wheels.road.map((wheel) => wheel.node.quaternion.clone());
      wheels.update(at(0.2, 1, 0, false), 0.02);
      assert.ok(
        wheels.road.every((wheel, i) => wheel.node.quaternion.equals(pose[i])),
        'paused pose',
      );
      wheels.update(at(0.4, 1), 0.02);
      wheels.update({ ...at(0.4, 1, 8, true, false), position: { x: 8, y: 7, z: 0.4 } }, 0.02);
      near(wheels.road[0].spin, spin * 3, 'airborne tyres coast at takeoff speed');
      const beforeTeleport = wheels.road[0].spin;
      wheels.update(at(100), 0.02);
      near(wheels.road[0].spin, beforeTeleport, 'teleports do not spin tyres');
      appearance.setWrecked(true);
      assert.ok(wheels.all.every((wheel) => !wheel.visible));
      wheels.update(at(101, 0, 0, false), 0.02);
      near(wheels.road[0].spin, beforeTeleport, 'wreck tyres do not spin');
      appearance.setWrecked(false);
      assert.ok(wheels.all.every((wheel) => wheel.visible));
      const healthy = new CarWheels(source);
      assert.ok(healthy.all.every((wheel) => wheel.visible && wheel.quaternion.equals(identity)));
      wheels.update(at(101.1), 0.02);
      near(wheels.road[0].spin, beforeTeleport + 0.1 / wheels.road[0].radius, 'respawn resumes');
    } finally {
      appearance.dispose();
      disposeResources([root, source]);
    }
  });
}

for (const name of ['race', 'race-future', 'hatchback-sports', 'suv'])
  test(`${name}: physical suspension moves each road wheel in world metres and preserves the spare on pause`, async () => {
    const source = await model(name),
      root = clone(source),
      wheels = new CarWheels(root);
    try {
      const spare = root.getObjectByName('wheel-back'),
        sparePosition = spare?.position.clone();
      const sourcePositions = new Map<string, Vector3>();
      source.traverse((node) => sourcePositions.set(node.name, node.position.clone()));
      const suspension = [0.12, -0.06, 0.04, -0.15];
      wheels.update({ ...at(0), suspension }, 0.02);
      for (const wheel of wheels.road) {
        near(
          (wheel.node.position.y - wheel.baseY) * wheel.scaleY,
          suspension[wheel.index],
          'world-space spring travel',
        );
        assert.ok(
          wheel.node.position.equals(source.getObjectByName(wheel.node.name)!.position) === false,
        );
      }
      const heights = wheels.road.map((wheel) => wheel.node.position.y);
      wheels.update({ ...at(0, 0, 0, false), suspension: [0, 0, 0, 0] }, 0.02);
      assert.deepEqual(
        wheels.road.map((wheel) => wheel.node.position.y),
        heights,
        'pause retains spring travel',
      );
      wheels.update({ ...at(100), suspension: [0, 0, 0, 0] }, 0.02);
      for (const wheel of wheels.road)
        near(wheel.node.position.y, wheel.baseY, 'respawn clears old compression');
      if (spare && sparePosition) assert.ok(spare.position.equals(sparePosition));
      source.traverse((node) => assert.ok(node.position.equals(sourcePositions.get(node.name)!)));
    } finally {
      disposeResources([root, source]);
    }
  });

test('menu stunt wheels roll forward around the continuous loop, including the loop seam', async () => {
  const root = await model('race');
  try {
    const wheels = new CarWheels(root);
    let previous = 0;
    for (let i = 0; i <= 1620; i++) {
      const pose = introPose(i / 100, 0);
      const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), pose.yaw);
      wheels.update({ position: pose, rotation, steering: 0, moving: true, grounded: true }, 0.01);
      const spin = wheels.road[0].spin;
      const delta = Math.atan2(Math.sin(spin - previous), Math.cos(spin - previous));
      assert.ok(delta >= -1e-8 && delta < 0.1, `forward roll at ${i / 100}s: ${delta}`);
      previous = spin;
    }
  } finally {
    disposeResources([root]);
  }
});

test('wheel travel uses the car heading, is frame-rate independent and preserves airborne spin over pause', async () => {
  const source = await model('suv');
  const slow = clone(source),
    fast = clone(source);
  try {
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    const move = (x: number, moving = true, grounded = true) => ({
      position: { x, y: 0, z: 0 },
      rotation,
      steering: -1,
      moving,
      grounded,
    });
    const wheels = new CarWheels(slow),
      moreFrames = new CarWheels(fast);
    wheels.update(move(0), 0.02);
    moreFrames.update(move(0), 0.01);
    wheels.update(move(0.2), 0.02);
    moreFrames.update(move(0.1), 0.01);
    moreFrames.update(move(0.2), 0.01);
    near(wheels.road[0].spin, moreFrames.road[0].spin, 'same distance at different frame rates');
    const spin = wheels.road[0].spin;
    wheels.update(move(0.2, true, false), 0.02);
    near(wheels.road[0].spin, spin * 2);
    wheels.update(move(0.2, false, false), 0.02);
    near(wheels.road[0].spin, spin * 2, 'paused airborne tyre');
    wheels.update(move(0.2, true, false), 0.02);
    near(wheels.road[0].spin, spin * 3, 'resumed airborne tyre');
  } finally {
    disposeResources([source, slow, fast]);
  }
});
