import { PHYSICS_STEP_SECONDS, SNAPSHOT_INTERVAL_TICKS } from '../shared/rules.ts';
import type { ServerConfig } from './config.ts';
import type { FixedWindowRateLimit } from './rate-limit.ts';
import type { ResultsStore } from './results-store.ts';
import type { Room, RoomRegistry } from './rooms.ts';
import type { GameServer } from './realtime.ts';

export function startRuntime(
  config: ServerConfig,
  registry: RoomRegistry,
  io: GameServer,
  results: ResultsStore,
  limiter: FixedWindowRateLimit,
  broadcast: (room: Room) => void,
) {
  let stepNumber = 0;
  function persistFinished() {
    for (const room of registry.rooms.values()) {
      if (room.race.phase !== 'finished' || room.saved) continue;
      try {
        results.save(room.matchId, room.code, room.race.results);
        room.saved = true;
        for (const car of room.race.cars.values()) if (!car.bot) car.ready = false;
        broadcast(room);
      } catch (error) {
        console.error('Result persistence failed', error);
      }
    }
  }
  const loop = setInterval(() => {
    const now = Date.now();
    for (const room of registry.rooms.values()) {
      // Skip every phase, including finished: even a settled race still steps Rapier.
      if (room.emptySince !== null) {
        if (now - room.emptySince >= config.roomTtlMs) registry.dispose(room.code);
        continue;
      }
      room.race.step();
      if (
        room.hostLost &&
        now - room.hostLost > config.hostReconnectMs &&
        room.race.phase === 'paused'
      )
        room.race.lobby();
      if (
        stepNumber % SNAPSHOT_INTERVAL_TICKS === 0 &&
        io.sockets.adapter.rooms.get(room.code)?.size
      )
        broadcast(room);
    }
    persistFinished();
    stepNumber++;
  }, PHYSICS_STEP_SECONDS * 1000);
  const cleanup = setInterval(() => {
    limiter.cleanup();
  }, 60_000);
  return {
    stop() {
      clearInterval(loop);
      clearInterval(cleanup);
      persistFinished();
    },
  };
}
