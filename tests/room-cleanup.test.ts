import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { Server } from 'socket.io';
import { io, type Socket } from 'socket.io-client';
import { createGameServer } from '../server/app.ts';
import { loadConfig } from '../server/config.ts';
import { FixedWindowRateLimit } from '../server/rate-limit.ts';
import type { GameServer } from '../server/realtime.ts';
import { ResultsStore } from '../server/results-store.ts';
import { RoomRegistry, type Room } from '../server/rooms.ts';
import { startRuntime } from '../server/runtime.ts';
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/protocol.ts';
import { initPhysics } from '../shared/simulation.ts';
import type { Phase, Session } from '../shared/types.ts';

await initPhysics();
type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check: () => boolean, timeout = 1500) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    assert.ok(Date.now() < deadline, 'room lifecycle condition timed out');
    await delay(10);
  }
}

function runtimeFixture(t: TestContext) {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 1000 });
  const folder = mkdtempSync(join(tmpdir(), 'turbo-cleanup-clock-'));
  const config = loadConfig({}, []),
    registry = new RoomRegistry(),
    sockets: GameServer = new Server(),
    results = new ResultsStore(folder),
    broadcast = t.mock.fn<(room: Room) => void>();
  const runtime = startRuntime(
    config,
    registry,
    sockets,
    results,
    new FixedWindowRateLimit(),
    broadcast,
  );
  t.after(() => {
    runtime.stop();
    registry.disposeAll();
    results.close();
    rmSync(folder, { recursive: true, force: true });
  });
  return { config, registry, results, broadcast };
}

test('empty rooms freeze every phase, including eight bots and finished physics, while results still persist', (t) => {
  const { registry, results } = runtimeFixture(t);
  const phases: Phase[] = ['lobby', 'countdown', 'racing', 'segment', 'finished', 'paused'];
  const rooms = phases.map((phase) => {
    const { room } = registry.create();
    for (let i = 0; i < 8; i++) registry.command(room, { action: 'bot' });
    room.race.start();
    room.race.phase = phase;
    room.hostLost = Date.now();
    const step = t.mock.method(room.race, 'step'),
      physics = t.mock.method(room.race.world, 'step');
    return { room, step, physics, snapshot: room.race.snapshot(room.code) };
  });
  t.mock.timers.tick(60_000);
  for (const { room, step, physics, snapshot } of rooms) {
    assert.equal(step.mock.callCount(), 0, snapshot.phase);
    assert.equal(physics.mock.callCount(), 0, snapshot.phase);
    assert.deepEqual(room.race.snapshot(room.code), snapshot, snapshot.phase);
  }
  assert.equal(results.latest().length, 1, 'a finished empty room still saves its result');
});

test('empty-room TTL is exactly three minutes and frees vehicles and WASM once; HTTP joins do not extend it', (t) => {
  const { config, registry, results } = runtimeFixture(t);
  assert.equal(config.roomTtlMs, 180_000);
  const { room, session } = registry.create(),
    emptySince = room.emptySince;
  registry.command(room, { action: 'bot' });
  const vehicle = t.mock.method([...room.race.cars.values()][0].vehicle, 'dispose'),
    free = t.mock.method(room.race.world, 'free');
  t.mock.timers.tick(config.roomTtlMs - 1);
  registry.join(room.code, 'Never connected');
  assert.equal(room.emptySince, emptySince);
  assert.equal(registry.rooms.has(room.code), true);
  t.mock.timers.tick(1);
  assert.equal(registry.rooms.has(room.code), false);
  assert.equal(registry.authenticate(session), null);
  assert.throws(() => registry.join(room.code, 'Late arrival'));
  registry.dispose(room.code);
  t.mock.timers.tick(config.roomTtlMs);
  assert.equal(vehicle.mock.callCount(), 1);
  assert.equal(free.mock.callCount(), 1);
  assert.equal(results.latest().length, 0, 'abandoned races do not create a fabricated result');
});

test('active old rooms stay alive and a new empty period receives the full TTL; deleting another room preserves saved results', (t) => {
  const { config, registry, results } = runtimeFixture(t);
  const active = registry.create().room,
    finished = registry.create().room;
  active.emptySince = null;
  finished.race.phase = 'finished';
  t.mock.timers.tick(20);
  assert.equal(results.latest().length, 1, 'the completed match is saved before its TTL expires');
  t.mock.timers.tick(config.roomTtlMs * 2);
  assert.equal(registry.rooms.get(active.code), active);
  assert.equal(registry.rooms.has(finished.code), false);
  assert.equal(results.latest().length, 1);
  active.emptySince = Date.now();
  t.mock.timers.tick(config.roomTtlMs - 1);
  assert.equal(registry.rooms.has(active.code), true);
  t.mock.timers.tick(1);
  assert.equal(registry.rooms.has(active.code), false);
  assert.equal(results.latest().length, 1, 'removing the physical room preserves SQLite history');
});

test(
  'real sockets: final disconnect stops bots, phone-first/host reconnect restores the match, and expiry rejects old sessions',
  { timeout: 20_000 },
  async (t) => {
    const folder = mkdtempSync(join(tmpdir(), 'turbo-cleanup-network-'));
    const config = {
      ...loadConfig({}, []),
      production: true,
      dataDir: folder,
      host: '127.0.0.1',
      port: 0,
      roomTtlMs: 1500,
      hostReconnectMs: 100,
    };
    const server = await createGameServer(config),
      sockets: GameSocket[] = [];
    try {
      const base = `http://127.0.0.1:${await server.listen()}`;
      const post = async (path: string, body: object) => {
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
      const hostSession = await post('/api/rooms', {}),
        host = await connect(hostSession),
        secondHost = await connect(hostSession),
        room = server.registry.rooms.get(hostSession.code)!;
      const otherSession = await post('/api/rooms', {});
      await connect(otherSession);
      const playerSession = await post('/api/join', { code: room.code, name: 'Returning driver' }),
        player = await connect(playerSession);
      for (let i = 0; i < 7; i++) await host.timeout(1500).emitWithAck('host', { action: 'bot' });
      await player.timeout(1500).emitWithAck('ready', true);
      await waitFor(() => room.race.phase === 'racing', 8000);
      assert.equal(room.race.cars.size, 8);
      host.disconnect();
      await waitFor(() => room.hosts.size === 1);
      assert.equal(room.race.phase, 'racing', 'another host tab still owns the shared screen');
      assert.equal(room.emptySince, null);
      const replacement = await connect(playerSession);
      await waitFor(() => !player.connected);
      assert.equal(room.emptySince, null, 'controller takeover never makes the room empty');
      secondHost.disconnect();
      await waitFor(() => room.race.phase === 'paused');
      assert.equal(room.emptySince, null, 'a remaining phone still keeps the room alive');
      replacement.disconnect();
      await waitFor(() => room.emptySince !== null);
      const firstEmpty = room.emptySince!,
        snapshot = room.race.snapshot(room.code),
        step = t.mock.method(room.race, 'step'),
        physics = t.mock.method(room.race.world, 'step');
      await delay(config.hostReconnectMs + 60);
      assert.deepEqual(room.race.snapshot(room.code), snapshot);
      assert.equal(step.mock.callCount(), 0);
      assert.equal(physics.mock.callCount(), 0);
      assert.equal(server.registry.rooms.get(room.code), room);
      const returningPad = await connect(playerSession);
      await delay(30);
      assert.equal(room.race.phase, 'paused', 'phone-first return allows time for the host');
      assert.equal(room.emptySince, null);
      const returningHost = await connect(hostSession);
      await waitFor(() => room.race.phase === 'racing' && room.race.tick > snapshot.tick);
      assert.equal(server.registry.rooms.get(room.code), room, 'reconnect retains the same match');
      assert.equal(room.race.cars.get(playerSession.playerId!)!.connected, true);
      assert.ok(physics.mock.callCount() > 0, 'physics resumes only with the host');
      returningHost.disconnect();
      returningPad.disconnect();
      await waitFor(() => room.emptySince !== null);
      assert.ok(room.emptySince! > firstEmpty, 'a second absence gets a new deadline');
      const finalEmpty = room.emptySince;
      await assert.rejects(connect({ ...hostSession, token: 'invalid-token' }), /sesja|wygasł/);
      assert.equal(room.emptySince, finalEmpty, 'invalid sessions cannot extend the grace period');
      const free = t.mock.method(room.race.world, 'free');
      await waitFor(() => !server.registry.rooms.has(room.code), 2500);
      assert.equal(free.mock.callCount(), 1);
      assert.equal(server.registry.rooms.has(otherSession.code), true, 'active rooms are isolated');
      await assert.rejects(connect(hostSession), /sesja|wygasł/);
      await assert.rejects(connect(playerSession), /sesja|wygasł/);
      const lateJoin = await fetch(base + '/api/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: room.code, name: 'Too late' }),
      });
      assert.equal(lateJoin.status, 404);
      t.diagnostic(
        '8 cars; 7 bots frozen; real reconnect before expiry; expired HTTP/socket sessions rejected',
      );
    } finally {
      for (const socket of sockets) socket.disconnect();
      await server.close();
      rmSync(folder, { recursive: true, force: true });
    }
  },
);
