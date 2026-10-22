import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lobbyReadiness, playerReadiness } from '../client/lobby-readiness.ts';

const ready = { bot: false, connected: true, ready: true };
const waiting = { ...ready, ready: false };
const disconnected = { ...ready, connected: false };
const bot = { ...ready, bot: true };

test('readiness counts human confirmations, excluding bots and disconnected confirmations', () => {
  assert.deepEqual(lobbyReadiness([ready, ready, waiting, disconnected, waiting, bot, bot]), {
    ready: 2,
    total: 5,
  });
  assert.equal(playerReadiness(disconnected), 'disconnected');
  assert.equal(playerReadiness(waiting), 'waiting');
  assert.equal(playerReadiness(ready), 'ready');
  assert.equal(playerReadiness(bot), 'bot');
});

test('a disconnected player can recover readiness; changes to settings reset confirmations', () => {
  assert.deepEqual(lobbyReadiness([disconnected, waiting, bot]), { ready: 0, total: 2 });
  assert.deepEqual(lobbyReadiness([ready, ready, bot]), { ready: 2, total: 2 });
  assert.deepEqual(lobbyReadiness([waiting, waiting, bot]), { ready: 0, total: 2 });
  assert.deepEqual(lobbyReadiness([]), { ready: 0, total: 0 });
  assert.deepEqual(lobbyReadiness([bot]), { ready: 0, total: 0 });
});
