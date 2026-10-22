import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as T from 'three';
import { WeaponModels, CarEquipment, projectileVisual } from '../client/weapon-models.ts';
import { disposeResources } from '../client/resources.ts';
import { initPhysics, Race } from '../shared/simulation.ts';
import type { Weapon } from '../shared/types.ts';
const kinds: Weapon[] = ['rocket', 'mine', 'frost', 'pulse', 'boost'];
before(initPhysics);
for (const kind of kinds)
  test(`${kind}: public snapshots equip the roof, actual use empties it, death hides it`, () => {
    const models = new WeaponModels(),
      equipment = new CarEquipment(models, 1.2),
      race = new Race(97);
    try {
      for (let i = 0; i < 2; i++)
        race.addDriver({
          id: `p${i}`,
          name: `P${i}`,
          slot: i,
          bot: false,
          ready: true,
          connected: true,
          wins: 0,
        });
      race.start();
      race.phase = 'racing';
      const car = race.cars.get('p0')!;
      car.weapon = kind;
      const state = () => race.snapshot('TEST').cars[0];
      equipment.setState(state());
      assert.equal(equipment.group.visible, true);
      assert.ok(equipment.group.getObjectByName(`equipment-${kind}`));
      const shape = new T.Box3().setFromObject(equipment.group);
      assert.ok(!shape.isEmpty() && shape.min.y > 1.2, 'item stays on top of the roof');
      const clone = equipment.group.children[0];
      equipment.setState(state());
      assert.equal(equipment.group.children[0], clone, 'snapshots reuse the current item');
      race.useWeapon(car);
      assert.equal(state().weapon, null);
      equipment.setState(state());
      assert.equal(equipment.group.visible, false);
      car.weapon = kind;
      equipment.setState(state());
      car.alive = false;
      equipment.setState(state());
      assert.equal(equipment.group.visible, false);
      car.alive = true;
      equipment.setState(state());
      assert.equal(equipment.group.visible, true);
    } finally {
      race.dispose();
      models.destroy();
    }
  });
test('removing one equipped car or shot keeps shared resources alive for other cars', () => {
  const models = new WeaponModels(),
    first = new CarEquipment(models, 1),
    second = new CarEquipment(models, 1);
  first.setState({ alive: true, weapon: 'rocket' });
  second.setState({ alive: true, weapon: 'rocket' });
  let disposals = 0;
  const source = models.templates.get('rocket')!;
  const mesh = source.children[0] as T.Mesh;
  mesh.geometry.addEventListener('dispose', () => disposals++);
  disposeResources([first.group, projectileVisual(models, 'rocket')], models.roots);
  assert.equal(disposals, 0);
  assert.ok(second.group.getObjectByName('equipment-rocket'));
  models.destroy();
  models.destroy();
  assert.equal(disposals, 1);
});
