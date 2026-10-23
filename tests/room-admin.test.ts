import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io, type Socket } from 'socket.io-client';
import { createGameServer } from '../server/app.ts';
import { loadConfig } from '../server/config.ts';
import { initPhysics } from '../shared/simulation.ts';
import {
  parseHostCommand,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '../shared/protocol.ts';
import type { Session, Phase, Snapshot } from '../shared/types.ts';

await initPhysics();
type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

test('admin transfer validates untrusted target IDs', () => {
  for (const id of [undefined, null, '', 7, {}, 'a'.repeat(129)])
    assert.equal(parseHostCommand({ action: 'transfer-admin', id }), null);
  assert.deepEqual(parseHostCommand({ action: 'transfer-admin', id: 'player' }), {
    action: 'transfer-admin',
    id: 'player',
  });
});

test('real controllers transfer admin without interrupting play and can end every match phase', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'turbo-admin-'));
  const server = await createGameServer({
    ...loadConfig({}, []),
    production: true,
    dataDir: folder,
    host: '127.0.0.1',
    port: 0,
  });
  const sockets: GameSocket[] = [];
  try {
    const base = `http://127.0.0.1:${await server.listen()}`;
    const post = async (path: string, body: object): Promise<Session> => {
      const response = await fetch(base + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.ok(response.ok);
      return (await response.json()) as Session;
    };
    const connect = async (session: Session) => {
      const socket: GameSocket = io(base, {
        auth: session,
        autoConnect: false,
        reconnection: false,
        transports: ['websocket'],
      });
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
        socket.connect();
      });
      return socket;
    };
    const hostSession = await post('/api/rooms', {});
    const host = await connect(hostSession);
    const room = server.registry.rooms.get(hostSession.code)!;
    const first = await post('/api/join', { code: room.code, name: 'Keyboard admin' });
    const admin = await connect(first);
    const second = await post('/api/join', { code: room.code, name: 'Successor' });
    const successor = await connect(second);
    const offline = await post('/api/join', { code: room.code, name: 'Offline' });
    await host.timeout(1500).emitWithAck('host', { action: 'bot' });
    const bot = [...room.race.cars.values()].find((car) => car.bot)!;
    assert.equal(room.race.adminId, first.playerId);
    assert.equal(room.race.cars.get(first.playerId!)!.ready, false);
    for (const id of ['missing', offline.playerId!, bot.id]) {
      assert.equal(
        (await admin.timeout(1500).emitWithAck('host', { action: 'transfer-admin', id })).ok,
        false,
      );
      assert.equal(room.race.adminId, first.playerId);
    }
    assert.equal(
      (
        await successor
          .timeout(1500)
          .emitWithAck('host', { action: 'transfer-admin', id: second.playerId! })
      ).ok,
      false,
    );
    room.race.phase = 'racing';
    const matchId = room.matchId;
    room.race.cars.get(first.playerId!)!.score = 4;
    const update = new Promise<Snapshot>((resolve) => successor.once('state', resolve));
    assert.equal(
      (
        await admin
          .timeout(1500)
          .emitWithAck('host', { action: 'transfer-admin', id: second.playerId! })
      ).ok,
      true,
    );
    assert.equal((await update).adminId, second.playerId);
    assert.equal(room.race.phase, 'racing');
    assert.equal(room.matchId, matchId);
    assert.equal(room.race.cars.get(first.playerId!)!.score, 4);
    assert.equal((await admin.timeout(1500).emitWithAck('host', { action: 'lobby' })).ok, false);
    const revoked = new Promise<void>((resolve) => successor.once('disconnect', () => resolve()));
    const replacement = await connect(second);
    await revoked;
    assert.equal(successor.connected, false, 'old successor socket is revoked');
    for (const phase of ['countdown', 'racing', 'segment', 'paused', 'finished'] as Phase[]) {
      room.race.phase = phase;
      room.race.cars.get(first.playerId!)!.ready = true;
      room.race.cars.get(second.playerId!)!.ready = true;
      assert.equal(
        (await replacement.timeout(1500).emitWithAck('host', { action: 'lobby' })).ok,
        true,
        phase,
      );
      assert.equal(room.race.phase, 'lobby');
      assert.ok([...room.race.cars.values()].every((car) => car.ready === car.bot));
      assert.equal(room.race.adminId, second.playerId);
      assert.equal(room.race.cars.size, 4);
    }
    admin.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(
      (
        await replacement
          .timeout(1500)
          .emitWithAck('host', { action: 'transfer-admin', id: first.playerId! })
      ).ok,
      false,
      'a disconnected human cannot receive admin',
    );
    const returning = await connect(first);
    assert.equal(
      room.race.adminId,
      second.playerId,
      'returning former admin does not reclaim the role',
    );
    assert.equal(
      (await returning.timeout(1500).emitWithAck('host', { action: 'lobby' })).ok,
      false,
    );
    assert.equal(
      (
        await replacement
          .timeout(1500)
          .emitWithAck('host', { action: 'transfer-admin', id: first.playerId! })
      ).ok,
      true,
    );
    assert.equal(room.race.adminId, first.playerId);
  } finally {
    for (const socket of sockets) socket.disconnect();
    await server.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
