import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { Quaternion, Vector3 } from 'three';
import { Race, initPhysics } from '../shared/simulation.ts';
import {
  FROST_DURATION_TICKS,
  PHYSICS_HZ,
  ROUND_SUMMARY_TICKS,
  SUMMARY_DELAY_TICKS,
} from '../shared/rules.ts';
import { waitingForSummary } from '../client/race-presentation.ts';

before(initPhysics);
function setup() {
  const race = new Race(103);
  for (let slot = 0; slot < 2; slot++)
    race.addDriver({
      id: `p${slot}`,
      name: `P${slot}`,
      slot,
      bot: false,
      connected: true,
      ready: true,
      wins: 0,
    });
  race.start();
  race.phase = 'racing';
  race.cameraProgress = 80;
  race.pickupUntil.fill(Infinity);
  const at = race.track.trackAt(80);
  for (const car of race.cars.values()) {
    const position = at.p.clone().addScaledVector(at.t, car.slot * 8);
    car.body.setTranslation({ x: position.x, y: 0.65, z: position.z }, true);
    car.body.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), at.yaw), true);
    car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    car.progress = 80 + car.slot * 8;
    car.invulnerableUntil = 0;
  }
  race.world.step();
  return race;
}

test('a real frost projectile slows its target for 1.6 seconds, including the former expiry boundary', () => {
  const race = setup();
  try {
    const source = race.cars.get('p0')!,
      target = race.cars.get('p1')!;
    source.weapon = 'frost';
    race.useWeapon(source);
    for (let i = 0; i < 30 && race.shots.length; i++) {
      race.tick++;
      race.updateShots();
    }
    assert.equal(race.shots.length, 0);
    assert.equal(FROST_DURATION_TICKS / PHYSICS_HZ, 1.6);
    assert.equal(target.frostUntil, race.tick + FROST_DURATION_TICKS);
    const hitTick = race.tick;
    for (const elapsed of [0, 60, FROST_DURATION_TICKS - 1]) {
      race.tick = hitTick + elapsed;
      assert.equal(race.snapshot('FROST').cars.find((car) => car.id === target.id)!.frozen, true);
    }
    race.tick = hitTick + FROST_DURATION_TICKS;
    assert.equal(race.snapshot('FROST').cars.find((car) => car.id === target.id)!.frozen, false);
  } finally {
    race.dispose();
  }
});

for (const final of [false, true])
  test(`${final ? 'final results' : 'round summary'} wait one second while the last physical wreck keeps moving`, () => {
    const race = setup();
    try {
      const winner = race.cars.get('p0')!,
        victim = race.cars.get('p1')!;
      if (final) winner.score = 9;
      race.blast(victim.body.translation(), 'rocket', winner.id);
      race.step();
      const endedAt = race.tick,
        height = victim.body.translation().y;
      assert.equal(race.phase, final ? 'finished' : 'segment');
      assert.equal(race.summaryAt, endedAt + PHYSICS_HZ);
      assert.equal(waitingForSummary(race.snapshot('END')), true);
      const points = [...race.cars.values()].map((car) => car.score);
      let peakHeight = height;
      for (let i = 0; i < SUMMARY_DELAY_TICKS - 1; i++) {
        race.step();
        peakHeight = Math.max(peakHeight, victim.body.translation().y);
      }
      const before = race.snapshot('END');
      assert.equal(waitingForSummary(before), true);
      assert.equal(before.cars.find((car) => car.id === victim.id)!.wrecked, true);
      assert.ok(peakHeight > height + 0.1);
      race.step();
      assert.equal(race.tick, race.summaryAt);
      assert.equal(waitingForSummary(race.snapshot('END')), false);
      assert.deepEqual(
        [...race.cars.values()].map((car) => car.score),
        points,
      );
      assert.equal(race.events.filter((event) => event.type === 'round').length, 1);
      if (!final) {
        assert.equal(race.phaseUntil - race.tick, ROUND_SUMMARY_TICKS);
        for (let i = 0; i < ROUND_SUMMARY_TICKS - 1; i++) race.step();
        assert.equal(race.phase, 'segment');
        race.step();
        assert.equal(race.phase, 'racing');
        assert.equal(race.round, 2);
      }
    } finally {
      race.dispose();
    }
  });

test('pause preserves the remaining reveal delay and lobby/rematch clear the deadline', () => {
  const race = setup();
  try {
    race.eliminate('p1', 'test');
    race.step();
    const tick = race.tick,
      deadline = race.summaryAt;
    race.pause();
    for (let i = 0; i < 100; i++) race.step();
    assert.equal(race.tick, tick);
    assert.equal(race.summaryAt, deadline);
    race.resume();
    assert.equal(waitingForSummary(race.snapshot('PAUSE')), true);
    race.lobby();
    assert.equal(race.summaryAt, 0);
    race.start();
    assert.equal(race.snapshot('REMATCH').summaryAt, 0);
    assert.equal(waitingForSummary(race.snapshot('REMATCH')), false);
  } finally {
    race.dispose();
  }
});

test('repeated renders and a late reconnect use the same server deadline without restarting a timer', () => {
  for (const phase of ['segment', 'finished'] as const) {
    const state = { phase, tick: 1049, summaryAt: 1050 };
    for (let i = 0; i < 10; i++) assert.equal(waitingForSummary(state), true);
    state.tick = 1050;
    assert.equal(waitingForSummary(state), false);
    state.tick = 1200;
    assert.equal(waitingForSummary(state), false);
  }
});
