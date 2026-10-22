import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { io, type Socket } from 'socket.io-client';
import { createGameServer } from '../server/app.ts';
import { loadConfig } from '../server/config.ts';
import {
  isServerStats,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '../shared/protocol.ts';
import type { Session } from '../shared/types.ts';

test('public activity follows real controllers and hosts, excludes bots and retains reserved room capacity', async () => {
  const folder = mkdtempSync(resolve(tmpdir(), 'turbo-stats-'));
  const server = await createGameServer({
    ...loadConfig({}, []),
    production: true,
    dataDir: folder,
    host: '127.0.0.1',
    port: 0,
    maxRooms: 3,
  });
  type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
  const sockets: GameSocket[] = [];
  const base = `http://127.0.0.1:${await server.listen()}`;
  async function post(path: string, body?: object): Promise<Session> {
    const response = await fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 201);
    return (await response.json()) as Session;
  }
  async function connect(auth: Session) {
    const socket: GameSocket = io(base, {
      auth,
      autoConnect: false,
      reconnection: false,
      transports: ['websocket'],
    });
    sockets.push(socket);
    await new Promise<void>((done, reject) => {
      socket.once('connect', done);
      socket.once('connect_error', reject);
      socket.connect();
    });
    return socket;
  }
  async function expectStats(players: number, activeRooms: number, rooms: number) {
    const deadline = Date.now() + 2000;
    do {
      const response = await fetch(base + '/api/stats');
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
      const value: unknown = await response.json();
      assert.ok(isServerStats(value));
      const expected = { players, activeRooms, rooms, maxRooms: 3 };
      if (JSON.stringify(value) === JSON.stringify(expected)) return;
      if (Date.now() >= deadline) assert.deepEqual(value, expected);
      await new Promise((done) => setTimeout(done, 10));
    } while (Date.now() < deadline);
    assert.fail('Activity did not settle before the deadline');
  }
  try {
    await expectStats(0, 0, 0);
    const first = await post('/api/rooms'),
      second = await post('/api/rooms');
    const playerA = await post('/api/join', { code: first.code, name: 'First human' });
    const playerB = await post('/api/join', { code: first.code, name: 'Second human' });
    await expectStats(0, 0, 2); // HTTP reservations and unconnected drivers are not online.
    const hostA = await connect(first),
      duplicateHost = await connect(first);
    await expectStats(0, 1, 2);
    assert.equal((await hostA.timeout(1000).emitWithAck('host', { action: 'bot' })).ok, true);
    await expectStats(0, 1, 2);
    const padA = await connect(playerA),
      padB = await connect(playerB);
    await expectStats(2, 1, 2);
    const takeover = await connect(playerA);
    await expectStats(2, 1, 2);
    assert.equal(padA.connected, false);
    padB.disconnect();
    await expectStats(1, 1, 2);
    const hostB = await connect(second);
    await expectStats(1, 2, 2);
    hostA.disconnect();
    await expectStats(1, 2, 2); // The other host tab still owns the shared screen.
    assert.equal(
      (
        await duplicateHost
          .timeout(1000)
          .emitWithAck('host', { action: 'remove', id: playerA.playerId! })
      ).ok,
      true,
    );
    await expectStats(0, 2, 2);
    assert.equal(takeover.connected, false);
    duplicateHost.disconnect();
    await expectStats(0, 1, 2); // A connected bot never keeps a room active.
    hostB.disconnect();
    await expectStats(0, 0, 2); // Reconnect grace still occupies real capacity.
    await post('/api/rooms');
    await expectStats(0, 0, 3);
    assert.equal((await fetch(base + '/api/rooms', { method: 'POST' })).status, 429);
    server.registry.dispose(first.code);
    await expectStats(0, 0, 2);
  } finally {
    for (const socket of sockets) socket.disconnect();
    await server.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test('activity payload validation rejects malformed, impossible and stale-version responses', () => {
  assert.ok(isServerStats({ players: 8, activeRooms: 1, rooms: 2, maxRooms: 50 }));
  for (const value of [
    null,
    [],
    {},
    { players: 0, rooms: 0 },
    { players: -1, activeRooms: 0, rooms: 0, maxRooms: 50 },
    { players: '2', activeRooms: 1, rooms: 1, maxRooms: 50 },
    { players: 9, activeRooms: 1, rooms: 1, maxRooms: 50 },
    { players: 1, activeRooms: 0, rooms: 1, maxRooms: 50 },
    { players: 0, activeRooms: 2, rooms: 1, maxRooms: 50 },
    { players: 0, activeRooms: 0, rooms: 51, maxRooms: 50 },
    { players: 0, activeRooms: 0, rooms: 0, maxRooms: 0 },
    { players: 0.5, activeRooms: 1, rooms: 1, maxRooms: 50 },
    { players: NaN, activeRooms: 1, rooms: 1, maxRooms: 50 },
  ])
    assert.equal(isServerStats(value), false);
});
