import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io, type Socket } from 'socket.io-client';
import { createGameServer } from '../server/app.ts';
import { loadConfig } from '../server/config.ts';
import {
  parseSession,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type RoomInfo,
} from '../shared/protocol.ts';
import { pageMetadata } from '../shared/site-metadata.ts';
import type { ConnectionSession, Session, Snapshot } from '../shared/types.ts';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 2500;
  while (!check()) {
    assert.ok(Date.now() < deadline, 'spectator condition timed out');
    await delay(10);
  }
}

test('spectator protocol accepts only room codes and never promotes extra credentials', () => {
  assert.deepEqual(
    parseSession({ code: 'ABC234', role: 'spectator', token: 'secret', playerId: 'driver' }),
    { code: 'ABC234', role: 'spectator' },
  );
  for (const code of ['', '<svg/>', 'ABC2345', null, []])
    assert.equal(parseSession({ code, role: 'spectator' }), null);
  for (const path of ['/room/ABC234', '/watch/ABC234']) {
    assert.equal(pageMetadata(path).page, 'private');
    assert.equal(pageMetadata(path).indexable, false);
  }
});

test(
  'public room discovery and live spectators have no player or host privileges and cannot keep abandoned rooms alive',
  { timeout: 15000 },
  async () => {
    const folder = mkdtempSync(join(tmpdir(), 'turbo-spectator-'));
    const server = await createGameServer({
      ...loadConfig({}, []),
      production: true,
      dataDir: folder,
      host: '127.0.0.1',
      port: 0,
      roomTtlMs: 500,
    });
    const sockets: Socket<ServerToClientEvents, ClientToServerEvents>[] = [];
    try {
      const base = 'http://127.0.0.1:' + (await server.listen());
      const session = (await (
        await fetch(base + '/api/rooms', { method: 'POST' })
      ).json()) as Session;
      const room = server.registry.rooms.get(session.code)!;
      const initialEmpty = room.emptySince;
      const response = await fetch(base + '/api/rooms/' + session.code.toLowerCase());
      const info = (await response.json()) as RoomInfo;
      assert.deepEqual(info, { code: session.code, phase: 'lobby', players: 0 });
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(room.emptySince, initialEmpty);
      assert.equal((await fetch(base + '/api/rooms/ZZZZZZ')).status, 404);
      async function connect(auth: ConnectionSession) {
        const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(base, {
          auth,
          reconnection: false,
          autoConnect: false,
          transports: ['websocket'],
        });
        sockets.push(socket);
        const states: Snapshot[] = [];
        socket.on('state', (state) => states.push(state));
        await new Promise<void>((resolve, reject) => {
          socket.once('connect', resolve);
          socket.once('connect_error', reject);
          socket.connect();
        });
        await waitFor(() => states.length > 0);
        return { socket, states };
      }
      const viewer = await connect({ code: session.code, role: 'spectator' });
      assert.equal(room.emptySince, initialEmpty);
      assert.equal(room.hosts.size, 0);
      assert.equal(room.race.cars.size, 0);
      assert.equal(server.registry.stats().players, 0);
      const host = await connect(session);
      assert.equal(room.hosts.size, 1);
      for (let i = 0; i < 8; i++) server.registry.command(room, { action: 'bot' });
      const full = await connect({ code: session.code, role: 'spectator' });
      assert.equal(room.race.cars.size, 8, 'watching a full room takes no slot');
      const before = [...room.race.cars.values()].map((c) => ({ id: c.id, ready: c.ready }));
      for (const command of [
        { action: 'start' },
        { action: 'lobby' },
        { action: 'bot' },
        { action: 'remove', id: before[0].id },
        { action: 'settings', settings: { mapId: 'forest', lapLimit: 1, winningScore: 6 } },
      ] as const) {
        assert.equal((await viewer.socket.timeout(1000).emitWithAck('host', command)).ok, false);
      }
      viewer.socket.emit('ready', true);
      viewer.socket.emit('input', { seq: 1, actionSeq: 1, left: true, right: false });
      await delay(40);
      assert.equal(room.race.phase, 'lobby');
      assert.deepEqual(
        [...room.race.cars.values()].map((c) => ({ id: c.id, ready: c.ready })),
        before,
      );
      assert.equal(room.race.adminId, null);
      assert.equal(
        (await host.socket.timeout(1000).emitWithAck('host', { action: 'start' })).ok,
        true,
      );
      await waitFor(() => viewer.states.some((s) => s.phase === 'countdown'));
      host.socket.disconnect();
      await waitFor(() => room.race.phase === 'paused');
      assert.notEqual(room.emptySince, null, 'spectators do not keep the room active');
      const frozen = room.race.tick;
      const late = await connect({ code: session.code, role: 'spectator' });
      await delay(60);
      assert.equal(room.race.tick, frozen);
      assert.equal(room.race.phase, 'paused', 'new spectators cannot resume the host');
      assert.equal(server.registry.activity().playingPlayers, 0);
      await waitFor(() => !server.registry.rooms.has(room.code));
      await waitFor(
        () => !viewer.socket.connected && !full.socket.connected && !late.socket.connected,
      );
      assert.equal((await fetch(base + '/api/rooms/' + room.code)).status, 404);
    } finally {
      for (const socket of sockets) socket.disconnect();
      await server.close();
      rmSync(folder, { recursive: true, force: true });
    }
  },
);
