import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { io, type Socket } from 'socket.io-client';
import { loadConfig } from '../server/config.ts';
import { FixedWindowRateLimit } from '../server/rate-limit.ts';
import { ResultsStore } from '../server/results-store.ts';
import { backupResults } from '../server/backup.ts';
import { createGameServer } from '../server/app.ts';
import { RoomRegistry } from '../server/rooms.ts';
import {
  isInput,
  parseHostCommand,
  parseSession,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '../shared/protocol.ts';
import { initPhysics } from '../shared/simulation.ts';
import type { Session, Result } from '../shared/types.ts';

await initPhysics();
type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
const result: Result = {
  id: 'winner',
  name: 'Winner',
  color: '#fff',
  score: 10,
  place: 1,
  cupPoints: 1,
};

test('configuration validates port, public origin and bounded proxy trust', () => {
  const config = loadConfig(
    {
      NODE_ENV: 'production',
      DATA_DIR: '/tmp/results',
      PUBLIC_URL: 'https://game.example/',
      TRUST_PROXY_HOPS: '1',
    },
    [],
  );
  assert.equal(config.production, true);
  assert.equal(config.publicUrl, 'https://game.example');
  assert.equal(config.dataDir, '/tmp/results');
  assert.equal(config.trustProxyHops, 1);
  assert.equal(loadConfig({}, []).trustProxyHops, 0);
  for (const env of [
    { PORT: 'no' },
    { PORT: '0' },
    { TRUST_PROXY_HOPS: 'true' },
    { PUBLIC_URL: 'https://game.example/private' },
    { PUBLIC_URL: 'ftp://game.example' },
  ])
    assert.throws(() => loadConfig(env, []));
});

test('wire protocol rejects malformed input, session and host command payloads', () => {
  for (const value of [
    null,
    [],
    false,
    'input',
    {},
    { seq: 1, left: true, right: false, actionSeq: -1 },
    { seq: Infinity, left: true, right: false, actionSeq: 0 },
  ])
    assert.equal(isInput(value), false);
  assert.equal(isInput({ seq: 1, left: true, right: false, actionSeq: 0 }), true);
  for (const value of [
    null,
    [],
    { code: 'ABC234', token: 'x', role: 'admin' },
    { code: 'ABC234', token: 'x', role: 'player' },
  ])
    assert.equal(parseSession(value), null);
  assert.equal(parseHostCommand({ action: 'unknown' }), null);
  assert.equal(parseHostCommand({ action: 'remove' }), null);
  assert.deepEqual(parseHostCommand({ action: 'remove', id: 'player' }), {
    action: 'remove',
    id: 'player',
  });
});

test('rate limit resets on its exact boundary and separates clients', () => {
  let now = 1000;
  const limit = new FixedWindowRateLimit(2, 100, () => now);
  assert.equal(limit.allow('a'), true);
  assert.equal(limit.allow('a'), true);
  assert.equal(limit.allow('a'), false);
  assert.equal(limit.allow('b'), true);
  now += 100;
  limit.cleanup();
  assert.equal(limit.allow('a'), true);
});

test('room capacity, host credentials and monotonic actions remain authoritative', () => {
  const registry = new RoomRegistry(1);
  try {
    const { room, session } = registry.create();
    assert.throws(() => registry.create());
    const player = registry.join(room.code, 'Player').session;
    assert.equal(registry.authenticate({ ...session, token: 'wrong' }), null);
    assert.equal(registry.authenticate({ ...player, role: 'host' }), null);
    const id = player.playerId!;
    assert.equal(room.race.input(id, { seq: 1, left: true, right: false, actionSeq: 2 }), true);
    assert.equal(room.race.input(id, { seq: 2, left: false, right: true, actionSeq: 1 }), false);
    assert.equal(room.race.input(id, null), false);
    room.race.resetInput(id);
    assert.equal(room.race.input(id, { seq: 1, left: false, right: false, actionSeq: 0 }), true);
    for (let i = 1; i < 8; i++) registry.command(room, { action: 'bot' });
    assert.throws(() => registry.join(room.code, 'Ninth'));
    assert.throws(() => registry.command(room, { action: 'bot' }));
    room.race.setConnected(id, true);
    room.race.cars.get(id)!.ready = true;
    registry.command(room, { action: 'start' });
    assert.throws(() => registry.command(room, { action: 'start' }));
    assert.throws(() => registry.command(room, { action: 'remove', id }));
  } finally {
    registry.disposeAll();
  }
});

test('SQLite saves once, survives reopening and creates an integrity-checked live backup', async () => {
  const folder = mkdtempSync(resolve(tmpdir(), 'turbo-store-'));
  const store = new ResultsStore(folder);
  try {
    store.save('match', 'ABC234', [result]);
    store.activity.record({ players: 6, playingPlayers: 4, activeRooms: 1 });
    store.save('match', 'ABC234', [{ ...result, score: 0 }]);
    await backupResults(resolve(folder, 'results.sqlite'), resolve(folder, 'backup.sqlite'));
    assert.equal(store.latest().length, 1);
    assert.equal(store.latest()[0].results[0].score, 10);
    await assert.rejects(
      backupResults(resolve(folder, 'results.sqlite'), resolve(folder, 'backup.sqlite')),
    );
    const copied = new DatabaseSync(resolve(folder, 'backup.sqlite'), { readOnly: true });
    try {
      assert.equal(copied.prepare('SELECT COUNT(*) AS count FROM matches').get()?.count, 1);
      assert.equal(
        copied.prepare('SELECT peak_players FROM activity_summary').get()?.peak_players,
        6,
      );
    } finally {
      copied.close();
    }
  } finally {
    store.close();
  }
  try {
    const reopened = new ResultsStore(folder);
    try {
      assert.equal(reopened.latest()[0].results[0].name, 'Winner');
      const history = reopened.activity.history('24h', {
        players: 0,
        playingPlayers: 0,
        activeRooms: 0,
      });
      assert.equal(history.peak.players, 6);
      assert.equal(history.points[0].playingPlayers, 4);
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('HTTP and real sockets validate sessions, lock ready during racing and close idempotently', async () => {
  const folder = mkdtempSync(resolve(tmpdir(), 'turbo-http-'));
  const server = await createGameServer({
    ...loadConfig({}, []),
    production: true,
    dataDir: folder,
    host: '127.0.0.1',
    port: 0,
    trustProxyHops: 1,
  });
  const sockets: GameSocket[] = [];
  try {
    const port = await server.listen(),
      base = `http://127.0.0.1:${port}`;
    assert.equal((await fetch(base + '/api/health')).status, 200);
    assert.equal(
      (
        await fetch(base + '/api/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: [], name: 5 }),
        })
      ).status,
      400,
    );
    const response = await fetch(base + '/api/rooms', { method: 'POST' }),
      session = (await response.json()) as Session;
    assert.equal(response.status, 201);
    const join = await fetch(base + '/api/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: session.code, name: 'Driver' }),
    });
    const player = (await join.json()) as Session;
    async function connect(auth: unknown, valid = true) {
      const socket: GameSocket = io(base, {
        auth: auth as object,
        autoConnect: false,
        reconnection: false,
        transports: ['websocket'],
      });
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', () =>
          valid ? resolve() : reject(new Error('Invalid session accepted')),
        );
        socket.once('connect_error', (error) => (valid ? reject(error) : resolve()));
        socket.connect();
      });
      return socket;
    }
    const host = await connect(session),
      pad = await connect(player);
    await connect(
      { code: session.code, role: 'player', token: session.token, playerId: player.playerId },
      false,
    );
    await pad.timeout(1000).emitWithAck('ready', true);
    assert.equal((await pad.timeout(1000).emitWithAck('host', { action: 'start' })).ok, false);
    assert.equal((await host.timeout(1000).emitWithAck('host', { action: 'bot' })).ok, true);
    assert.equal((await host.timeout(1000).emitWithAck('host', { action: 'start' })).ok, true);
    const room = server.registry.rooms.get(session.code)!;
    room.race.phase = 'racing';
    pad.emit('ready', false);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(room.race.cars.get(player.playerId!)!.ready, true);
    room.race.results = [result];
    room.race.phase = 'finished';
    // Closing while sockets are still connected exercises disconnect callbacks before freeing Rapier.
    await Promise.all([server.close(), server.close()]);
    const persisted = new ResultsStore(folder);
    try {
      assert.equal(persisted.latest().length, 1);
    } finally {
      persisted.close();
    }
  } finally {
    for (const socket of sockets) socket.disconnect();
    await server.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
