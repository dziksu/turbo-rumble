import assert from 'node:assert/strict';
import { io, type Socket } from 'socket.io-client';
import type { Session, Snapshot } from '../shared/types.ts';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  HostCommand,
} from '../shared/protocol.ts';
type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const base = process.env.GAME_URL ?? 'http://localhost:4317';
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sockets: GameSocket[] = [],
  timers: ReturnType<typeof setInterval>[] = [];
async function post(path: string, body: unknown) {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  assert.ok(response.ok, JSON.stringify(data));
  return data as Session;
}
async function connect(auth: Session) {
  const s: GameSocket = io(base, { auth, autoConnect: false, reconnection: false });
  sockets.push(s);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket connection timeout')), 4000);
    s.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    s.once('connect_error', reject);
    s.connect();
  });
  return s;
}
function command(socket: GameSocket, action: HostCommand['action']) {
  return socket.timeout(3000).emitWithAck('host', { action } as HostCommand);
}
let latest: Snapshot | undefined;
async function stateWhere(check: (s: Snapshot) => boolean, timeout = 14000) {
  if (latest && check(latest)) return latest;
  return new Promise<Snapshot>((resolve, reject) => {
    const timer = setTimeout(() => {
      host?.off('state', listener);
      reject(
        new Error(
          'State timeout: ' +
            JSON.stringify(
              latest && { phase: latest.phase, tick: latest.tick, players: latest.cars.length },
            ),
        ),
      );
    }, timeout);
    const listener = (s: Snapshot) => {
      if (check(s)) {
        clearTimeout(timer);
        host.off('state', listener);
        resolve(s);
      }
    };
    host.on('state', listener);
  });
}
let host: GameSocket;
try {
  const session = await post('/api/rooms', {});
  host = await connect(session);
  host.on('state', (s: Snapshot) => {
    latest = s;
  });
  const sessions: Session[] = [],
    players: GameSocket[] = [];
  for (let i = 0; i < 8; i++) {
    const p = await post('/api/join', { code: session.code, name: 'Smoke ' + i });
    sessions.push(p);
    const socket = await connect(p);
    players.push(socket);
    await new Promise<void>((resolve) => socket.emit('ready', true, resolve));
    let seq = 0;
    socket.on('connect', () => {
      seq = 0;
    });
    timers.push(
      setInterval(() => {
        if (socket.connected)
          socket.emit('input', { seq: ++seq, left: false, right: false, actionSeq: 0 });
      }, 33),
    );
  }
  assert.equal((await command(players[1], 'start')).ok, false, 'player cannot start the host game');
  const countdown = await stateWhere((s) => s.phase === 'countdown');
  assert.ok(
    countdown.cars.every((c) => c.weapon === null),
    'all controllers start with empty inventory',
  );
  assert.equal((await command(host, 'start')).ok, true);
  const initial = await stateWhere((s) => s.phase === 'racing');
  assert.equal(initial.cars.length, 8);
  assert.ok(
    initial.cars.every((c) => c.weapon === null),
    'GO grants no starting weapons',
  );
  const next = await stateWhere((s) => s.phase === 'racing' && s.tick > initial.tick + 45);
  assert.ok(
    next.cars.some((c) => c.progress > initial.cars.find((p) => p.id === c.id)!.progress + 0.5),
    'cars move with real network inputs',
  );
  const oldId = sessions[0].playerId;
  const replacement = await connect(sessions[0]);
  let seq = 0;
  timers.push(
    setInterval(() => {
      if (replacement.connected)
        replacement.emit('input', { seq: ++seq, left: false, right: false, actionSeq: 0 });
    }, 33),
  );
  await stateWhere((s) => s.cars.some((c) => c.id === oldId && c.connected));
  assert.equal(latest!.cars.length, 8, 'reconnect does not create a new slot');
  assert.equal(players[0].connected, false, 'old controller is disconnected on session takeover');
  const bad = io(base, {
    auth: { ...session, token: 'invalid-token' },
    reconnection: false,
    autoConnect: false,
  });
  sockets.push(bad);
  await new Promise<void>((resolve, reject) => {
    bad.once('connect_error', () => resolve());
    bad.once('connect', () => reject(new Error('Invalid token accepted')));
    bad.connect();
  });
  players[1].on('state', (s: Snapshot) => {
    latest = s;
  });
  host.disconnect();
  await delay(150);
  assert.equal(latest!.phase, 'paused');
  host = await connect(session);
  host.on('state', (s: Snapshot) => {
    latest = s;
  });
  await stateWhere((s) => s.phase === 'racing' && s.tick > next.tick + 1);
  const info = await fetch(base + '/api/info').then((r) => r.json());
  assert.ok(info.networkUrls.length >= 0);
  console.log(
    JSON.stringify(
      {
        ok: true,
        room: session.code,
        clients: 8,
        checks: [
          'HTTP room creation',
          '8 independent controller connections',
          'ready/start',
          'empty starting inventory',
          'authoritative movement',
          'host authorization',
          'controller takeover',
          'invalid token rejection',
          'host reconnect',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  for (const t of timers) clearInterval(t);
  for (const s of sockets) s.disconnect();
}
