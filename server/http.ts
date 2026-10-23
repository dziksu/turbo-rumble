import { GAME_VERSION } from '../shared/version.ts';
import { isActivityRange } from '../shared/activity.ts';
import type { Express, ErrorRequestHandler } from 'express';
import { networkInterfaces } from 'node:os';
import { isRecord, type NetworkInfo } from '../shared/protocol.ts';
import type { ServerConfig } from './config.ts';
import { RoomError, type Room, type RoomRegistry } from './rooms.ts';
import type { ResultsStore } from './results-store.ts';
import type { FixedWindowRateLimit } from './rate-limit.ts';

export function networkInfo(config: ServerConfig): NetworkInfo {
  const networkUrls = Object.values(networkInterfaces())
    .flatMap((net) => net ?? [])
    .filter((net) => net.family === 'IPv4' && !net.internal)
    .map((net) => `http://${net.address}:${config.port}`);
  return {
    localUrl: `http://localhost:${config.port}`,
    networkUrls,
    publicUrl: config.publicUrl ?? null,
  };
}

export function registerHttp(
  app: Express,
  config: ServerConfig,
  registry: RoomRegistry,
  results: ResultsStore,
  limiter: FixedWindowRateLimit,
  broadcast: (room: Room) => void,
  isClosing: () => boolean,
) {
  app.get('/api/health', (_req, res) =>
    res.status(isClosing() ? 503 : 200).json({
      ok: !isClosing(),
      game: 'Turbo Rumble',
      version: GAME_VERSION,
      rooms: registry.rooms.size,
    }),
  );
  app.get('/api/stats', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (isClosing()) {
      res.status(503).json({ error: 'Serwer jest zatrzymywany.' });
      return;
    }
    res.json(registry.stats());
  });
  app.get('/api/stats/history', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (isClosing()) {
      res.status(503).json({ error: 'Serwer jest zatrzymywany.' });
      return;
    }
    const range = req.query.range ?? '24h';
    if (!isActivityRange(range) || Object.keys(req.query).some((key) => key !== 'range')) {
      res.status(400).json({ error: 'Wybierz zakres 24h, 7d lub 30d.' });
      return;
    }
    res.json(results.activity.history(range, registry.activity()));
  });
  app.get('/api/rooms/:code', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const room = registry.rooms.get(req.params.code.toUpperCase());
    if (!room) {
      res.status(404).json({ error: 'Nie ma takiego pokoju. Sprawdź kod na ekranie hosta.' });
      return;
    }
    res.json({ code: room.code, phase: room.race.phase, players: room.race.cars.size });
  });
  app.get('/api/info', (_req, res) => res.json(networkInfo(config)));
  app.get('/api/results', (_req, res) => res.json(results.latest()));
  app.post(['/api/rooms', '/api/join'], (req, res, next) => {
    if (isClosing()) {
      res.status(503).json({ error: 'Serwer jest zatrzymywany.' });
      return;
    }
    if (!limiter.allow(req.ip ?? 'unknown')) {
      res.status(429).json({ error: 'Za dużo prób. Poczekaj minutę.' });
      return;
    }
    try {
      if (req.path === '/api/rooms') {
        res.status(201).json(registry.create().session);
        return;
      }
      const body: unknown = req.body;
      if (
        !isRecord(body) ||
        typeof body.code !== 'string' ||
        (body.name !== undefined && typeof body.name !== 'string')
      ) {
        res.status(400).json({ error: 'Podaj kod pokoju i nazwę kierowcy.' });
        return;
      }
      const code = body.code.toUpperCase().replace(/[^A-Z2-9]/g, '');
      const name =
        (body.name ?? 'Kierowca')
          .trim()
          .split('')
          .filter((char) => char.charCodeAt(0) >= 32)
          .join('')
          .slice(0, 18) || 'Kierowca';
      const { room, session } = registry.join(code, name);
      res.status(201).json(session);
      broadcast(room);
    } catch (error) {
      next(error);
    }
  });
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof RoomError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (error instanceof SyntaxError) {
      res.status(400).json({ error: 'Nieprawidłowy JSON.' });
      return;
    }
    console.error('HTTP request failed', error);
    res.status(500).json({ error: 'Błąd serwera.' });
  };
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Nieznane API.' }));
  app.use(errors);
}
