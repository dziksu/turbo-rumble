import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sound, effectForEvent, type SoundEffect } from '../client/audio.ts';
import type { GameEvent, Snapshot } from '../shared/types.ts';
function snapshot(): Snapshot {
  return {
    code: 'AUDIO1',
    phase: 'racing',
    tick: 100,
    seconds: 0,
    summaryAt: 0,
    lap: 1,
    lapLimit: 3,
    cameraProgress: 0,
    cars: [],
    projectiles: [],
    pickups: [],
    events: [],
    results: [],
    round: 1,
    message: '',
    canStart: false,
  };
}
function event(id: number, type: GameEvent['type'], weapon?: GameEvent['weapon']): GameEvent {
  return { id, tick: 100, type, weapon, position: { x: 0, y: 0, z: 0 } };
}
test('all five weapons route to distinct sound cues', () => {
  const events = [
    event(1, 'shot', 'boost'),
    event(2, 'shot', 'rocket'),
    event(3, 'shot', 'mine'),
    event(4, 'shot', 'frost'),
    event(5, 'pulse'),
  ];
  assert.equal(new Set(events.map(effectForEvent)).size, 5);
});
test('repeated network snapshots never replay an effect and stale events are skipped', () => {
  const sound = new Sound(),
    played: SoundEffect[] = [];
  sound.play = (effect) => {
    played.push(effect);
  };
  const state = snapshot();
  state.events = [event(1, 'shot', 'rocket')];
  sound.update(state);
  sound.update(state);
  assert.deepEqual(played, ['rocket']);
  state.tick = 130;
  state.events.push(event(2, 'explosion'));
  sound.update(state);
  assert.deepEqual(played, ['rocket']);
});
test('countdown beeps once per number and start/round/lap cues occur once', () => {
  const sound = new Sound(),
    played: SoundEffect[] = [];
  sound.play = (effect) => {
    played.push(effect);
  };
  const state = snapshot();
  state.phase = 'countdown';
  state.seconds = 5;
  sound.update(state);
  sound.update(state);
  state.seconds = 4.2;
  sound.update(state);
  state.seconds = 4;
  sound.update(state);
  state.phase = 'racing';
  sound.update(state);
  sound.update(state);
  state.lap = 2;
  sound.update(state);
  sound.update(state);
  state.phase = 'segment';
  sound.update(state);
  state.phase = 'racing';
  sound.update(state);
  assert.deepEqual(played, ['countdown', 'countdown', 'start', 'lap', 'ready']);
});
