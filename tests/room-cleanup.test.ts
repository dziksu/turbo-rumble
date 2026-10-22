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
  return { config, registry, results, broadcast, sockets };
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

test('offline players expire at 30 seconds, free full-room slots and nominate only a connected human', (t) => {
  const { config, registry, broadcast } = runtimeFixture(t);
  assert.equal(config.playerReconnectMs, 30_000);
  const { room } = registry.create();
  room.emptySince = null;
  for (let i = 0; i < 5; i++) registry.command(room, { action: 'bot' });
  const absent = registry.join(room.code, 'Absent admin').session;
  room.playerSockets.set(absent.playerId!, 'first');
  registry.playerConnected(room, absent.playerId!);
  const never = registry.join(room.code, 'Never connected').session;
  const online = registry.join(room.code, 'Connected successor').session;
  room.playerSockets.set(online.playerId!, 'online');
  registry.playerConnected(room, online.playerId!);
  room.playerSockets.delete(absent.playerId!);
  registry.playerDisconnected(room, absent.playerId!);
  const vehicle = t.mock.method(room.race.cars.get(absent.playerId!)!.vehicle, 'dispose');
  assert.equal(room.race.cars.size, 8);
  t.mock.timers.tick(29_999);
  assert.equal(room.race.adminId, absent.playerId);
  assert.equal(room.race.cars.size, 8);
  t.mock.timers.tick(1);
  assert.equal(room.race.cars.size, 6);
  assert.equal(room.race.adminId, online.playerId);
  assert.equal(room.race.cars.get(online.playerId!)!.bot, false);
  assert.equal(registry.authenticate(absent), null);
  assert.equal(registry.authenticate(never), null);
  assert.equal(vehicle.mock.callCount(), 1);
  assert.equal(room.disconnectedSince.size, 0);
  assert.ok(broadcast.mock.callCount() > 0, 'removal and admin change are broadcast immediately');
  registry.join(room.code, 'Replacement 1');
  registry.join(room.code, 'Replacement 2');
  assert.equal(room.race.cars.size, 8, 'both expired slots can be reused');
});

test('reconnect cancels expiration and another disconnect starts a fresh 30-second window', (t) => {
  const { registry } = runtimeFixture(t);
  const { room } = registry.create();
  room.emptySince = null;
  const player = registry.join(room.code, 'Returning admin').session;
  room.playerSockets.set(player.playerId!, 'first');
  registry.playerConnected(room, player.playerId!);
  room.playerSockets.delete(player.playerId!);
  registry.playerDisconnected(room, player.playerId!);
  t.mock.timers.tick(29_999);
  room.playerSockets.set(player.playerId!, 'returned');
  registry.playerConnected(room, player.playerId!);
  t.mock.timers.tick(1);
  assert.ok(room.race.cars.has(player.playerId!));
  assert.equal(room.race.adminId, player.playerId);
  assert.equal(room.disconnectedSince.size, 0);
  room.playerSockets.delete(player.playerId!);
  registry.playerDisconnected(room, player.playerId!);
  t.mock.timers.tick(29_999);
  assert.ok(room.race.cars.has(player.playerId!));
  t.mock.timers.tick(1);
  assert.equal(room.race.cars.has(player.playerId!), false);
  assert.equal(room.race.adminId, null);
});

test('empty paused rooms still expire humans without stepping physics or promoting bots', (t) => {
  const { registry } = runtimeFixture(t);
  const { room } = registry.create();
  registry.command(room, { action: 'bot' });
  const player = registry.join(room.code, 'Offline').session;
  room.playerSockets.set(player.playerId!, 'admin');
  registry.playerConnected(room, player.playerId!);
  room.playerSockets.delete(player.playerId!);
  registry.playerDisconnected(room, player.playerId!);
  room.race.phase = 'paused';
  const step = t.mock.method(room.race, 'step');
  t.mock.timers.tick(30_000);
  assert.equal(step.mock.callCount(), 0);
  assert.equal(room.race.adminId, null);
  assert.equal(room.race.cars.size, 1);
  assert.equal([...room.race.cars.values()][0].bot, true);
  assert.equal(registry.authenticate(player), null);
  room.race.lobby();
  const newcomer = registry.join(room.code, 'New admin').session;
  assert.equal(room.race.adminId, null);
  room.playerSockets.set(newcomer.playerId!, 'new');
  registry.playerConnected(room, newcomer.playerId!);
  assert.equal(room.race.adminId, newcomer.playerId);
});

test('map changes do not restart a disconnected player deadline, and race removal clears scoring queues', (t) => {
  const { registry, results } = runtimeFixture(t);
  const { room } = registry.create();
  room.emptySince = null;
  const absent = registry.join(room.code, 'Departing').session;
  room.playerSockets.set(absent.playerId!, 'departing');
  registry.playerConnected(room, absent.playerId!);
  room.playerSockets.delete(absent.playerId!);
  registry.playerDisconnected(room, absent.playerId!);
  const online = registry.join(room.code, 'Remaining').session;
  room.playerSockets.set(online.playerId!, 'remaining');
  registry.playerConnected(room, online.playerId!);
  registry.command(room, { action: 'bot' });
  const since = room.disconnectedSince.get(absent.playerId!);
  t.mock.timers.tick(5000);
  registry.command(room, {
    action: 'settings',
    settings: { mapId: 'forest', lapLimit: 3, winningScore: 10 },
  });
  assert.equal(room.disconnectedSince.get(absent.playerId!), since);
  t.mock.timers.tick(24_999);
  assert.ok(room.race.cars.has(absent.playerId!));
  // Expire during a real race after the car has entered both elimination queues.
  room.race.phase = 'racing';
  room.race.deaths = [[absent.playerId!]];
  room.race.pendingDeaths.set(absent.playerId!, 'test');
  room.race.lastCollision.set(absent.playerId!, room.race.tick);
  t.mock.timers.tick(1);
  assert.equal(room.race.cars.has(absent.playerId!), false);
  assert.equal(room.race.pendingDeaths.has(absent.playerId!), false);
  assert.ok(room.race.deaths.every((group) => !group.includes(absent.playerId!)));
  assert.equal(room.race.lastCollision.has(absent.playerId!), false);
  assert.doesNotThrow(() => room.race.endSegment(true));
  assert.ok(room.race.results.every((result) => result.id !== absent.playerId));
  const finished = room.race.results;
  room.playerSockets.delete(online.playerId!);
  registry.playerDisconnected(room, online.playerId!);
  t.mock.timers.tick(30_000);
  assert.equal(room.race.cars.has(online.playerId!), false);
  assert.deepEqual(
    results.latest()[0].results,
    finished,
    'saved results survive lobby return and later player expiration',
  );
});

test('authentication enforces the deadline before the next runtime tick', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const registry = new RoomRegistry();
  t.after(() => registry.disposeAll());
  const { room } = registry.create();
  const player = registry.join(room.code, 'No socket').session;
  t.mock.timers.tick(29_999);
  assert.ok(registry.authenticate(player));
  t.mock.timers.tick(1);
  assert.equal(registry.authenticate(player), null);
  assert.equal(room.race.cars.size, 0);
});

test(
  'real sockets: reconnect and takeover preserve the admin; expiry revokes tokens and grants the role to a human',
  { timeout: 15_000 },
  async () => {
    const folder = mkdtempSync(join(tmpdir(), 'turbo-player-expiry-'));
    const config = {
      ...loadConfig({}, []),
      production: true,
      host: '127.0.0.1',
      port: 0,
      dataDir: folder,
      playerReconnectMs: 1000,
    };
    const server = await createGameServer(config);
    const sockets: GameSocket[] = [];
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
      const hostSession = await post('/api/rooms', {});
      const host = await connect(hostSession);
      const room = server.registry.rooms.get(hostSession.code)!;
      await host.timeout(1500).emitWithAck('host', { action: 'bot' });
      const first = await post('/api/join', { code: room.code, name: 'Original admin' });
      const firstSocket = await connect(first);
      const second = await post('/api/join', { code: room.code, name: 'Human successor' });
      const successor = await connect(second);
      assert.equal(room.race.adminId, first.playerId);
      firstSocket.disconnect();
      await waitFor(() => room.disconnectedSince.has(first.playerId!));
      const returned = await connect(first);
      assert.equal(room.disconnectedSince.has(first.playerId!), false);
      assert.equal(room.race.adminId, first.playerId);
      const replacement = await connect(first);
      await waitFor(() => !returned.connected);
      assert.equal(
        room.disconnectedSince.has(first.playerId!),
        false,
        'superseded socket never starts an expiry timer',
      );
      replacement.disconnect();
      await waitFor(() => room.disconnectedSince.has(first.playerId!));
      assert.ok(room.race.cars.has(first.playerId!));
      await waitFor(() => !room.race.cars.has(first.playerId!), 2500);
      assert.equal(room.race.adminId, second.playerId);
      assert.equal(room.players.has(first.token), false);
      await assert.rejects(connect(first), /sesja|wygasł/);
      assert.equal(
        (await successor.timeout(1500).emitWithAck('host', { action: 'bot' })).ok,
        true,
        'successor has actual admin permission',
      );
      successor.disconnect();
      await waitFor(() => !room.race.cars.has(second.playerId!), 2500);
      assert.equal(room.race.adminId, null, 'bots never inherit administration');
      assert.ok([...room.race.cars.values()].every((car) => car.bot));
      const newcomer = await post('/api/join', { code: room.code, name: 'New human' });
      assert.equal(room.race.adminId, null, 'HTTP-only join does not claim administration');
      await connect(newcomer);
      assert.equal(room.race.adminId, newcomer.playerId);
    } finally {
      for (const socket of sockets) socket.disconnect();
      await server.close();
      rmSync(folder, { recursive: true, force: true });
    }
  },
);

test('final podium stays for five revealed seconds, then every player returns unready to the same lobby', (t) => {
  const { registry, results, broadcast, sockets } = runtimeFixture(t);
  const { room } = registry.create();
  room.emptySince = null;
  room.hosts.add('host');
  sockets.sockets.adapter.rooms.set(room.code, new Set(['host']));
  const sessions = [
    registry.join(room.code, 'Winner').session,
    registry.join(room.code, 'Runner up').session,
  ];
  for (const [index, session] of sessions.entries()) {
    room.playerSockets.set(session.playerId!, `socket-${index}`);
    registry.playerConnected(room, session.playerId!);
    room.race.cars.get(session.playerId!)!.ready = true;
  }
  registry.command(room, { action: 'bot' });
  const admin = room.race.adminId,
    settings = { ...room.race.settings };
  room.race.start();
  room.race.finish();
  const finalResults = [...room.race.results],
    matchId = room.matchId;
  const save = t.mock.method(results, 'save');
  t.mock.timers.tick(999);
  assert.equal(room.race.phase, 'finished');
  assert.ok(
    room.race.tick < room.race.summaryAt,
    'impact reveal comes before the five-second podium',
  );
  assert.equal(room.saved, true);
  assert.equal(save.mock.callCount(), 1);
  t.mock.timers.tick(1);
  assert.equal(room.race.tick, room.race.summaryAt);
  assert.equal(room.race.snapshot(room.code).seconds, 5);
  t.mock.timers.tick(4999);
  assert.equal(room.race.phase, 'finished', 'do not dismiss the podium early');
  t.mock.timers.tick(1);
  assert.equal(room.race.phase, 'lobby');
  assert.deepEqual(room.race.results, []);
  assert.equal(room.race.cars.size, 3);
  assert.equal(room.race.adminId, admin);
  assert.deepEqual(room.race.settings, settings);
  assert.ok(sessions.every((session) => registry.authenticate(session)));
  assert.ok([...room.race.cars.values()].every((car) => car.ready === car.bot));
  assert.equal(room.race.snapshot(room.code).canStart, false);
  assert.equal(save.mock.callCount(), 1);
  assert.equal(results.latest()[0].id, matchId);
  assert.deepEqual(results.latest()[0].results, finalResults);
  assert.ok(broadcast.mock.callCount() >= 2);
  for (const car of room.race.cars.values()) if (!car.bot) car.ready = true;
  registry.syncLobby(room);
  assert.equal(room.race.phase, 'countdown');
  assert.notEqual(room.matchId, matchId);
  assert.equal(room.saved, false);
});

test('a failed result save keeps the final podium until persistence succeeds', (t) => {
  const { registry, results } = runtimeFixture(t);
  const { room } = registry.create();
  room.emptySince = null;
  registry.command(room, { action: 'bot' });
  registry.command(room, { action: 'bot' });
  room.race.finish();
  const finished = [...room.race.results];
  const save = results.save.bind(results);
  const mockedSave = t.mock.method(results, 'save', () => {
    throw new Error('Test database failure');
  });
  t.mock.method(console, 'error', () => {});
  t.mock.timers.tick(6500);
  assert.equal(room.saved, false);
  assert.equal(room.race.phase, 'finished');
  assert.deepEqual(room.race.results, finished);
  mockedSave.mock.mockImplementation(save);
  t.mock.timers.tick(40);
  assert.equal(room.race.phase, 'lobby');
  assert.deepEqual(results.latest()[0].results, finished);
  assert.equal(results.latest().length, 1);
});
