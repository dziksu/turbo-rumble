import assert from 'node:assert/strict';
import { io, type Socket } from 'socket.io-client';
import type {
  Session,
  Snapshot,
  GameEvent,
  Phase,
  Weapon,
  Result,
  Input,
} from '../shared/types.ts';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  HostCommand,
} from '../shared/protocol.ts';
import type { SavedMatch } from '../server/results-store.ts';
import { CATCH_UP } from '../shared/catch-up.ts';
type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
interface Driver {
  s: GameSocket;
  auth: Session;
  slot: number;
  start?: number;
}
interface Report {
  startedAt: string;
  mode: string;
  base: string;
  checks: string[];
  events: Partial<Record<GameEvent['type'], GameEvent[]>>;
  phases: Phase[];
  weapons: Weapon[];
  samples: number;
  catchUp: { peakBonus: number; playerIds: string[] };
  suspension: { peakCompression: number; airborneIds: string[]; landedIds: string[] };
  room?: string;
  result?: Result[];
  ok?: boolean;
  error?: string;
  finishedAt?: string;
}
import { resolve, dirname } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { getTrack } from '../shared/track.ts';
import { MAPS, type MapId } from '../shared/maps.ts';
const base = process.env.GAME_URL || 'http://localhost:4317';
const joinedCode = process.env.ROOM_CODE;
const out = process.env.QA_REPORT || resolve('data', 'playtest-report.json');
mkdirSync(dirname(out), { recursive: true });
const report: Report = {
  startedAt: new Date().toISOString(),
  mode: joinedCode ? 'shared-play' : 'network-qa',
  base,
  checks: [],
  events: {},
  phases: [],
  weapons: [],
  samples: 0,
  catchUp: { peakBonus: 0, playerIds: [] },
  suspension: { peakCompression: 0, airborneIds: [], landedIds: [] },
};
const sockets: GameSocket[] = [],
  timers: ReturnType<typeof setInterval>[] = [];
let latest!: Snapshot;
let host: GameSocket, session: Session;
const drivers: Driver[] = [];
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const check = (name: string, value = true) => {
  assert.ok(value, name);
  report.checks.push(name);
  console.log('PASS', name);
};
async function post<T = Session>(path: string, body: unknown, expected = 201): Promise<T> {
  const r = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  assert.equal(r.status, expected, path + ' ' + JSON.stringify(data));
  return data as T;
}
async function connect(auth: Session) {
  const s: GameSocket = io(base, { auth, reconnection: false, autoConnect: false, timeout: 4000 });
  sockets.push(s);
  await new Promise<void>((resolve, reject) => {
    s.once('connect', resolve);
    s.once('connect_error', reject);
    s.connect();
  });
  return s;
}
function observe(s: GameSocket) {
  s.on('state', (state: Snapshot) => {
    latest = state;
    report.samples++;
    if (!report.phases.includes(state.phase)) {
      report.phases.push(state.phase);
      console.log('PHASE', state.phase, 'round', state.round, 'tick', state.tick);
    }
    for (const e of state.events) {
      const events = (report.events[e.type] ??= []);
      if (!events.some((x) => x.id === e.id)) events.push(e);
    }
    for (const c of state.cars) {
      assert.equal(c.suspension?.length, 4, 'Server sends all four suspension travels');
      assert.ok(
        c.suspension.every(
          (travel) => Number.isFinite(travel) && travel >= -0.22 && travel <= 0.25,
        ),
        'Suspension stays finite and within physical travel',
      );
      assert.ok(
        c.rotation && Object.values(c.rotation).every(Number.isFinite),
        'Chassis rotation stays finite',
      );
      report.suspension.peakCompression = Math.max(
        report.suspension.peakCompression,
        ...c.suspension,
      );
      if (state.phase === 'racing' && c.alive) {
        if (!c.grounded && c.position.y > 2 && !report.suspension.airborneIds.includes(c.id))
          report.suspension.airborneIds.push(c.id);
        if (
          c.grounded &&
          report.suspension.airborneIds.includes(c.id) &&
          !report.suspension.landedIds.includes(c.id)
        )
          report.suspension.landedIds.push(c.id);
      }
      if (c.weapon && !report.weapons.includes(c.weapon)) report.weapons.push(c.weapon);
      const bonus = c.catchUpBonus ?? 0;
      assert.ok(bonus >= 0 && bonus <= CATCH_UP.maxSpeedBonus, 'Catch-up remains within its cap');
      if (c.boosted) assert.equal(bonus, 0, 'Nitro does not stack with catch-up');
      if (bonus > 0) {
        report.catchUp.peakBonus = Math.max(report.catchUp.peakBonus, bonus);
        if (!report.catchUp.playerIds.includes(c.id)) report.catchUp.playerIds.push(c.id);
      }
    }
  });
}
async function until(predicate: (state: Snapshot) => boolean, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (latest && predicate(latest)) return latest;
    await delay(40);
  }
  throw new Error(
    'State timeout ' +
      JSON.stringify(
        latest && {
          phase: latest.phase,
          tick: latest.tick,
          round: latest.round,
          cars: latest.cars.length,
        },
      ),
  );
}
async function cmd(socket: GameSocket, action: string, id?: string) {
  // The unknown-command case deliberately exercises runtime validation.
  const command = (action === 'remove' ? { action, id } : { action }) as HostCommand;
  return socket.timeout(4000).emitWithAck('host', command);
}
async function ready(socket: GameSocket) {
  await socket.timeout(4000).emitWithAck('ready', true);
}
function drive(s: GameSocket, auth: Session, slot: number) {
  let seq = 0,
    actionSeq = 0,
    lastFire = 0,
    projection: number | undefined;
  const data = { s, auth, slot, start: undefined as number | undefined };
  drivers.push(data);
  const t = setInterval(() => {
    if (!s.connected) return;
    const c = latest?.cars.find((x) => x.id === auth.playerId);
    let left = false,
      right = false;
    if (c) {
      const track = getTrack(latest.settings?.mapId ?? 'desert');
      const tr = track.projectOnTrack(c.position, projection);
      projection = tr.s;
      const lane = ((slot % 3) - 1) * 1.5 + Math.sin(c.progress / 36 + slot) * 0.7;
      const lookahead = track.trackAt(tr.s + Math.max(5, c.speed * 0.42)),
        target = lookahead.p.addScaledVector(lookahead.n, lane),
        desired = Math.atan2(target.x - c.position.x, target.z - c.position.z),
        error = Math.atan2(Math.sin(desired - c.yaw), Math.cos(desired - c.yaw));
      left = error > 0.07;
      right = error < -0.07;
      if (latest.phase === 'racing' && c.alive) {
        if (data.start === undefined) data.start = c.progress;
        if (c.weapon && Date.now() - lastFire > 850) {
          actionSeq++;
          lastFire = Date.now();
          report.checks.push('fired ' + c.weapon + ' by ' + c.name);
          console.log('FIRE', c.name, c.weapon);
        }
      }
    }
    s.emit('input', { seq: ++seq, left, right, actionSeq });
  }, 33);
  timers.push(t);
  return data;
}
try {
  if (joinedCode) {
    session = await post('/api/join', {
      code: joinedCode,
      name: process.env.PLAYER_NAME || 'Agent Celina',
    });
    host = await connect(session);
    observe(host);
    drive(host, session, 2);
    await ready(host);
    console.log('READY', session.code, session.playerId);
    await until((s) => s.phase === 'racing', 90000);
    await until((s) => s.phase === 'finished', 240000);
    report.result = latest.results;
    check('shared full match finished with independent Socket.IO controller');
  } else {
    session = await post('/api/rooms', {});
    host = await connect(session);
    observe(host);
    report.room = session.code;
    console.log('ROOM', session.code);
    for (let i = 0; i < 8; i++) {
      const auth = await post('/api/join', { code: session.code, name: 'Network QA ' + i });
      const s = await connect(auth);
      drive(s, auth, i);
      if (i === 0 && process.env.QA_MAP && Object.hasOwn(MAPS, process.env.QA_MAP)) {
        const result = await s.timeout(4000).emitWithAck('host', {
          action: 'settings',
          settings: { mapId: process.env.QA_MAP as MapId, lapLimit: 1, winningScore: 10 },
        });
        check('administrator selects requested map', result.ok);
      }
      if (i !== 7) await ready(s);
    }
    await until((s) => s.cars.length === 8);
    check('8 independent authenticated human-controller sockets');
    check('start rejected while one player not ready', !(await cmd(host, 'start')).ok);
    await ready(drivers[7].s);
    const full = await post<{ error: string }>(
      '/api/join',
      { code: session.code, name: 'Overflow' },
      409,
    );
    check('ninth player rejected', String(full.error).includes('8'));
    check('controller cannot execute host start', !(await cmd(drivers[1].s, 'start')).ok);
    check('unknown owner command rejected', !(await cmd(host, 'unknown')).ok);
    const bad = io(base, {
      auth: { ...session, token: 'invalid-token' },
      reconnection: false,
      autoConnect: false,
    });
    sockets.push(bad);
    await new Promise<void>((resolve, reject) => {
      bad.once('connect_error', () => resolve());
      bad.once('connect', () => reject(new Error('Invalid auth accepted')));
      bad.connect();
    });
    check('invalid authentication rejected');
    for (const value of [
      null,
      'bad',
      5,
      [],
      { seq: 'bad', left: {}, right: null, actionSeq: 'bad' },
      { seq: Number.MAX_VALUE, left: true, right: true, actionSeq: -1 },
    ])
      drivers[0].s.emit('input', value as Input);
    check('owner starts valid match', (await cmd(host, 'start')).ok);
    const initial = await until((s) => s.phase === 'racing');
    const initialProgress = initial.cars.map((c) => ({ id: c.id, progress: c.progress }));
    await until((s) => s.phase === 'racing' && s.tick > initial.tick + 80);
    check(
      'real controllers move cars',
      latest.cars.some(
        (c) => c.progress > initialProgress.find((x) => x.id === c.id)!.progress + 1,
      ),
    );
    const d = drivers[0],
      old = d.s;
    old.disconnect();
    await until((s) => s.cars.find((c) => c.id === d.auth.playerId)?.connected === false);
    await delay(500);
    const replacement = await connect(d.auth);
    drive(replacement, d.auth, d.slot);
    await until((s) => s.cars.find((c) => c.id === d.auth.playerId)?.connected === true);
    check('mid-race disconnect/reconnect preserves slot', latest.cars.length === 8);
    const takeover = await connect(drivers[1].auth);
    drive(takeover, drivers[1].auth, 1);
    await delay(150);
    check('session takeover disconnects previous controller', drivers[1].s.connected === false);
    check('takeover does not duplicate driver', latest.cars.length === 8);
    observe(replacement);
    const prePauseTick = latest.tick;
    host.disconnect();
    await until((s) => s.phase === 'paused');
    await delay(400);
    check(
      'host loss pauses simulation',
      latest.tick === prePauseTick || latest.tick <= prePauseTick + 4,
    );
    host = await connect(session);
    observe(host);
    await until((s) => s.phase === 'racing' && s.tick > prePauseTick + 5);
    check('host reconnect resumes same match');
    const blocked = await post<{ error: string }>(
      '/api/join',
      { code: session.code, name: 'Late' },
      409,
    );
    check('mid-race new join rejected', String(blocked.error).includes('trwa'));
    await until((s) => s.phase === 'finished', 240000);
    report.result = latest.results;
    check('full eight-controller match finishes', latest.results.length === 8);
    check('native four-wheel suspension and chassis rotations remain valid in every snapshot');
    check(
      'trailing assistance observed independently of nitro',
      report.catchUp.playerIds.length > 0,
    );
    check('all five weapon types offered', report.weapons.length === 5);
    check('fire events observed', (report.events.shot?.length ?? 0) > 0);
    check('eliminations observed', (report.events.elimination?.length ?? 0) > 0);
    await delay(200);
    const results = (await fetch(base + '/api/results').then((r) => r.json())) as SavedMatch[];
    check(
      'finished result persisted by HTTP API',
      results.some(
        (match) =>
          match.results.length === 8 &&
          match.results.every((r) => latest.results.some((own) => own.id === r.id)),
      ),
    );
    const saved = results.filter((match) =>
      match.results.some((r) => r.id === drivers[0].auth.playerId),
    );
    check('result persisted exactly once', saved.length === 1);
    for (const driver of drivers) if (driver.s.connected) await ready(driver.s);
    check('rematch starts', (await cmd(host, 'start')).ok);
    await until((s) => s.phase === 'countdown');
    check(
      'rematch resets starting score',
      latest.cars.every((c) => c.score === 5),
    );
    check('return to lobby', (await cmd(host, 'lobby')).ok);
    await until((s) => s.phase === 'lobby');
  }
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.error = String(error);
  console.error(error);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  for (const timer of timers) clearInterval(timer);
  for (const socket of sockets) socket.disconnect();
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(
    'REPORT',
    out,
    JSON.stringify({
      ok: report.ok,
      events: Object.fromEntries(
        Object.entries(report.events).map(([k, v]) => [k, v?.length ?? 0]),
      ),
      phases: report.phases,
      checks: report.checks.length,
      error: report.error,
    }),
  );
}
