import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as T from 'three';
import { WreckAppearance } from '../client/wreck-appearance.ts';
import { disposeResources } from '../client/resources.ts';
import { initPhysics, Race } from '../shared/simulation.ts';
import { trackAt } from '../shared/track.ts';

function model() {
  const root = new T.Group(),
    body: T.Mesh = new T.Mesh(new T.BoxGeometry(), [
      new T.MeshStandardMaterial({ color: 'red', map: new T.Texture() }),
      new T.MeshStandardMaterial({ color: 'white' }),
    ]),
    wheel = new T.Group(),
    spare = new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial());
  wheel.add(new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial()));
  wheel.name = 'wheel-front-left';
  spare.name = 'wheel-back';
  root.add(body, wheel, spare);
  return { root, body, wheel, spare };
}

test('burning one clone hides its wheels and stripe without recoloring another car', () => {
  const source = model(),
    damaged = source.root.clone(true),
    healthy = source.root.clone(true),
    stripe = new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial({ color: 'yellow' }));
  damaged.add(stripe);
  const original = source.body.material,
    wheel = damaged.getObjectByName('wheel-front-left')!,
    spare = damaged.getObjectByName('wheel-back')!,
    appearance = new WreckAppearance(damaged, [wheel, spare]);
  appearance.setWrecked(true);
  const charred = (damaged.children[0] as T.Mesh).material as T.MeshStandardMaterial;
  assert.equal(stripe.material, charred);
  assert.ok(charred.color.r < 0.01 && charred.color.g < 0.01 && charred.color.b < 0.01);
  assert.equal(charred.map, null);
  assert.equal(charred.roughness, 1);
  assert.equal(wheel.visible, false);
  assert.equal(spare.visible, false);
  assert.deepEqual((healthy.children[0] as T.Mesh).material, original);
  assert.equal(healthy.getObjectByName('wheel-front-left')!.visible, true);
  assert.equal(source.body.material, original);
  appearance.dispose();
  disposeResources([source.root, damaged, healthy]);
});

test('respawn restores the exact materials and wheel visibility; repeated snapshots do not allocate', () => {
  const { root, body, wheel, spare } = model();
  spare.visible = false;
  const appearance = new WreckAppearance(root, [wheel, spare]),
    original = body.material;
  appearance.setWrecked(true);
  const charred = body.material as T.MeshStandardMaterial;
  let disposals = 0;
  charred.addEventListener('dispose', () => disposals++);
  appearance.setWrecked(true);
  assert.equal(body.material, charred);
  appearance.setWrecked(false);
  appearance.setWrecked(false);
  assert.equal(body.material, original);
  assert.equal(wheel.visible, true);
  assert.equal(spare.visible, false);
  assert.equal(disposals, 1);
  appearance.setWrecked(true);
  assert.notEqual(body.material, charred);
  appearance.dispose();
  disposeResources([root]);
});

for (const wrecked of [false, true])
  test(`removing a ${wrecked ? 'burnt' : 'healthy'} car releases only owned materials`, () => {
    const source = model(),
      root = source.root.clone(true),
      appearance = new WreckAppearance(root, [root.getObjectByName('wheel-front-left')!]);
    let sharedDisposals = 0,
      charredDisposals = 0;
    assert.ok(Array.isArray(source.body.material));
    for (const material of source.body.material)
      material.addEventListener('dispose', () => sharedDisposals++);
    appearance.setWrecked(wrecked);
    if (wrecked) {
      const material = (root.children[0] as T.Mesh).material;
      assert.ok(!Array.isArray(material));
      material.addEventListener('dispose', () => charredDisposals++);
    }
    appearance.dispose();
    appearance.dispose();
    disposeResources([root], [source.root]);
    assert.equal(sharedDisposals, 0);
    assert.equal(charredDisposals, Number(wrecked));
    disposeResources([source.root]);
    assert.equal(sharedDisposals, 2);
  });

before(initPhysics);
for (const weapon of ['mine', 'rocket'] as const)
  test(`${weapon}: authoritative wreck snapshot burns the victim and restores it next round`, () => {
    const race = new Race(97),
      vehicle = model(),
      appearance = new WreckAppearance(vehicle.root, [vehicle.wheel, vehicle.spare]),
      original = vehicle.body.material;
    try {
      for (let i = 0; i < 3; i++)
        race.addDriver({
          id: `p${i}`,
          name: `P${i}`,
          slot: i,
          bot: false,
          connected: true,
          ready: true,
          wins: 0,
        });
      race.start();
      race.phase = 'racing';
      race.roundStart = race.tick;
      race.cameraProgress = 80;
      for (const [i, car] of [...race.cars.values()].entries()) {
        const at = trackAt(80),
          p = at.p.clone().addScaledVector(at.n, i * 4);
        car.body.setTranslation({ x: p.x, y: 0.65, z: p.z }, true);
        car.progress = 80;
        car.weapon = null;
        car.invulnerableUntil = 0;
      }
      race.world.step();
      const origin = { ...race.cars.get('p0')!.body.translation() };
      race.blast(origin, weapon);
      race.step();
      // A newly connected renderer receives the wreck directly, without replaying the blast event.
      const snapshot = race.snapshot('WRECK');
      const victim = snapshot.cars.find((car) => car.id === 'p0')!;
      assert.equal(victim.alive, false);
      assert.equal(victim.wrecked, true);
      assert.equal(snapshot.cars.find((car) => car.id === 'p1')!.wrecked, false);
      appearance.setWrecked(!victim.alive && !!victim.wrecked);
      assert.notEqual(vehicle.body.material, original);
      assert.equal(vehicle.wheel.visible, false);
      assert.ok(race.cars.get('p0')!.body.linvel().y > 5);
      race.start();
      const respawned = race.snapshot('WRECK').cars.find((car) => car.id === 'p0')!;
      appearance.setWrecked(!respawned.alive && !!respawned.wrecked);
      assert.equal(vehicle.body.material, original);
      assert.equal(vehicle.wheel.visible, true);
      assert.equal(respawned.wrecked, false);
    } finally {
      appearance.dispose();
      disposeResources([vehicle.root]);
      race.dispose();
    }
  });
