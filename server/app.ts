import express from 'express';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { pageMetadata, renderPageHtml } from '../shared/site-metadata.ts';
import { Server } from 'socket.io';
import { initPhysics } from '../shared/simulation.ts';
import type { ServerConfig } from './config.ts';
import { ResultsStore } from './results-store.ts';
import { RoomRegistry } from './rooms.ts';
import { FixedWindowRateLimit } from './rate-limit.ts';
import { registerRealtime, type GameServer } from './realtime.ts';
import { registerHttp } from './http.ts';
import { startRuntime } from './runtime.ts';

export async function createGameServer(config: ServerConfig) {
  await initPhysics();
  const app = express(),
    http = createServer(app);
  const io: GameServer = new Server(http, {
    maxHttpBufferSize: 8192,
    pingInterval: 5000,
    pingTimeout: 10_000,
  });
  const results = new ResultsStore(config.dataDir),
    registry = new RoomRegistry(config.maxRooms),
    limiter = new FixedWindowRateLimit();
  let closing = false,
    closePromise: Promise<void> | undefined;
  let closeFrontend: (() => Promise<void>) | undefined;
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/host/') || req.path === '/join')
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    next();
  });
  app.set('trust proxy', config.trustProxyHops);
  app.use(express.json({ limit: '4kb' }));
  const broadcast = registerRealtime(io, registry);
  registerHttp(app, config, registry, results, limiter, broadcast, () => closing);
  if (config.production) {
    const frontend = resolve(config.rootDir, 'dist');
    let indexHtml: Promise<string> | undefined;
    app.use(express.static(frontend, { index: false }));
    app.get('/{*path}', async (req, res, next) => {
      try {
        indexHtml ??= readFile(resolve(frontend, 'index.html'), 'utf8');
        const meta = pageMetadata(req.path);
        res.setHeader('X-Robots-Tag', meta.robots);
        res
          .status(meta.page === 'missing' ? 404 : 200)
          .type('html')
          .send(renderPageHtml(await indexHtml, req.path, config.publicUrl));
      } catch (error) {
        next(error);
      }
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      root: config.rootDir,
      server: { middlewareMode: true, hmr: { server: http } },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    closeFrontend = () => vite.close();
  }
  const runtime = startRuntime(config, registry, io, results, limiter, broadcast);
  return {
    app,
    http,
    io,
    registry,
    listen: () =>
      new Promise<number>((resolve, reject) => {
        http.once('error', reject);
        http.listen(config.port, config.host, () => {
          http.off('error', reject);
          const address = http.address();
          resolve(typeof address === 'object' && address ? address.port : config.port);
        });
      }),
    close(): Promise<void> {
      closePromise ??= (async () => {
        closing = true;
        runtime.stop();
        // Keep physics and SQLite alive until Socket.IO has run all disconnect handlers and closed HTTP.
        await new Promise<void>((resolve) => {
          io.close(() => resolve());
          http.closeIdleConnections();
        });
        await closeFrontend?.();
        registry.disposeAll();
        results.close();
      })();
      return closePromise;
    },
  };
}
