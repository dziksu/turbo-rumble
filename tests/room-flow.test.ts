import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io, type Socket } from 'socket.io-client';
import { createGameServer } from '../server/app.ts';
import { loadConfig } from '../server/config.ts';
import {
  parseHostCommand,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '../shared/protocol.ts';
import type { Session, Snapshot } from '../shared/types.ts';
import { initPhysics, Race } from '../shared/simulation.ts';
import { COUNTDOWN_TICKS } from '../shared/rules.ts';

await initPhysics();
type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
test('settings reject unknown maps and nonintegral/out-of-range rules', () => {
  for (const settings of [
    { mapId: 'unknown', lapLimit: 3, winningScore: 10 },
    { mapId: 'forest', lapLimit: 0, winningScore: 10 },
    { mapId: 'forest', lapLimit: 2.5, winningScore: 10 },
    { mapId: 'forest', lapLimit: 3, winningScore: 5 },
    { mapId: 'volcano', lapLimit: 3, winningScore: Infinity },
  ])
    assert.equal(parseHostCommand({ action: 'settings', settings }), null);
});
test('countdown lasts exactly ten simulation seconds and cars cannot move before GO', () => {
  const race = new Race();
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
    const start = { ...race.cars.get('p0')!.body.translation() };
    assert.equal(COUNTDOWN_TICKS, 500);
    assert.equal(race.snapshot('TEN').seconds, 10);
    for (let i = 0; i < 499; i++) race.step();
    assert.equal(race.phase, 'countdown');
    assert.deepEqual({ ...race.cars.get('p0')!.body.translation() }, start);
    race.step();
    assert.equal(race.phase, 'racing');
  } finally {
    race.dispose();
  }
});
test('host and first human configure shared settings; ready auto-starts, cancels, and isolates rooms', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'turbo-room-flow-'));
  const server = await createGameServer({
    ...loadConfig({}, []),
    production: true,
    dataDir: folder,
    host: '127.0.0.1',
    port: 0,
  });
  const sockets: GameSocket[] = [];
  try {
    const port = await server.listen(),
      base = `http://127.0.0.1:${port}`;
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
      host = await connect(hostSession);
    const room = server.registry.rooms.get(hostSession.code)!;
    await host.timeout(1500).emitWithAck('host', { action: 'bot' });
    assert.equal(room.race.adminId, null, 'bots never become administrator');
    const initialSettings = { mapId: 'volcano' as const, lapLimit: 4, winningScore: 12 };
    assert.equal(
      (
        await host
          .timeout(1500)
          .emitWithAck('host', { action: 'settings', settings: initialSettings })
      ).ok,
      true,
      'host can configure before any human joins',
    );
    assert.deepEqual({ ...room.race.settings }, initialSettings);
    assert.equal(room.race.cars.size, 1, 'configuring does not add a hidden keyboard player');
    const firstSession = await post('/api/join', { code: room.code, name: 'Admin' }),
      admin = await connect(firstSession);
    const secondSession = await post('/api/join', { code: room.code, name: 'Guest' }),
      guest = await connect(secondSession);
    assert.equal(room.race.snapshot(room.code).adminId, firstSession.playerId);
    const settings = { mapId: 'forest' as const, lapLimit: 2, winningScore: 15 };
    assert.equal(
      (await guest.timeout(1500).emitWithAck('host', { action: 'settings', settings })).ok,
      false,
    );
    await admin.timeout(1500).emitWithAck('ready', true);
    const sharedUpdate = new Promise<Snapshot>((resolve, reject) => {
      const timer = setTimeout(() => {
        guest.off('state', receive);
        reject(new Error('Settings not broadcast to guest'));
      }, 1500);
      const receive = (state: Snapshot) => {
        if (state.settings?.mapId !== settings.mapId) return;
        clearTimeout(timer);
        guest.off('state', receive);
        resolve(state);
      };
      guest.on('state', receive);
    });
    assert.equal(
      (await host.timeout(1500).emitWithAck('host', { action: 'settings', settings })).ok,
      true,
    );
    const guestView = await sharedUpdate;
    assert.deepEqual(guestView.settings, settings, 'all controllers see the host selection');
    assert.ok(
      guestView.cars.filter((car) => !car.bot).every((car) => !car.ready),
      'host changes reset readiness',
    );
    const other = server.registry.create().room;
    assert.equal(
      (await admin.timeout(1500).emitWithAck('host', { action: 'settings', settings })).ok,
      true,
    );
    assert.deepEqual(room.race.settings, settings);
    assert.equal(other.race.settings.mapId, 'desert');
    assert.equal(room.race.cars.size, 3);
    assert.equal(room.race.adminId, firstSession.playerId);
    await admin.timeout(1500).emitWithAck('ready', true);
    assert.equal(room.race.phase, 'lobby');
    await guest.timeout(1500).emitWithAck('ready', true);
    assert.equal(room.race.phase, 'countdown');
    assert.ok(room.race.snapshot(room.code).seconds > 9.8);
    const deadline = room.race.phaseUntil;
    assert.equal(
      (
        await host
          .timeout(1500)
          .emitWithAck('host', { action: 'settings', settings: initialSettings })
      ).ok,
      false,
      'host cannot change settings during countdown',
    );
    assert.deepEqual(room.race.settings, settings);
    await host.timeout(1500).emitWithAck('host', { action: 'start' });
    assert.equal(room.race.phaseUntil, deadline, 'duplicate start never restarts the timer');
    await guest.timeout(1500).emitWithAck('ready', false);
    assert.equal(room.race.phase, 'lobby');
    await guest.timeout(1500).emitWithAck('ready', true);
    assert.equal(room.race.phase, 'countdown');
    guest.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(room.race.phase, 'lobby', 'disconnect cancels the start');
    const restored = await connect(secondSession);
    assert.equal(room.race.phase, 'countdown', 'same controller can recover its ready slot');
    const newcomerSession = await post('/api/join', { code: room.code, name: 'Newcomer' });
    assert.equal(room.race.phase, 'lobby', 'new unready join cancels the timer');
    const newcomer = await connect(newcomerSession);
    assert.equal(room.race.adminId, firstSession.playerId);
    await restored.timeout(1500).emitWithAck('ready', false);
    const volcano = { mapId: 'volcano' as const, lapLimit: 4, winningScore: 20 };
    assert.equal(
      (await admin.timeout(1500).emitWithAck('host', { action: 'settings', settings: volcano })).ok,
      true,
    );
    assert.ok([...room.race.cars.values()].filter((c) => !c.bot).every((c) => !c.ready));
    assert.equal(room.race.settings.mapId, 'volcano');
    // Controller takeover must revoke old administrator sockets, too.
    const replacement = await connect(firstSession);
    assert.equal(
      (await replacement.timeout(1500).emitWithAck('host', { action: 'settings', settings })).ok,
      true,
    );
    assert.equal(room.race.settings.mapId, 'forest');
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(admin.connected, false);
    await host.timeout(1500).emitWithAck('host', { action: 'remove', id: firstSession.playerId! });
    assert.equal(
      room.race.adminId,
      secondSession.playerId,
      'removing the admin passes rights to the next human',
    );
    while (room.race.cars.size < 8) await host.timeout(1500).emitWithAck('host', { action: 'bot' });
    await restored.timeout(1500).emitWithAck('ready', true);
    await newcomer.timeout(1500).emitWithAck('ready', true);
    assert.equal(room.race.phase, 'countdown');
    const finalDeadline = room.race.phaseUntil;
    const full = await fetch(base + '/api/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: room.code, name: 'Overflow' }),
    });
    assert.equal(full.status, 409);
    assert.equal(room.race.phase, 'countdown');
    assert.equal(
      room.race.phaseUntil,
      finalDeadline,
      'rejected join never cancels a valid countdown',
    );
  } finally {
    for (const socket of sockets) socket.disconnect();
    await server.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
