import { resolve } from 'node:path';

export interface ServerConfig {
  port: number;
  host: string;
  production: boolean;
  rootDir: string;
  dataDir: string;
  publicUrl?: string;
  trustProxyHops: number;
  maxRooms: number;
  roomTtlMs: number;
  hostReconnectMs: number;
  playerReconnectMs: number;
}
function integer(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number) {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${key} must be an integer between ${min} and ${max}`);
  return value;
}
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  args = process.argv,
): ServerConfig {
  const rootDir = resolve(env.APP_ROOT || process.cwd());
  let publicUrl: string | undefined;
  if (env.PUBLIC_URL) {
    const url = new URL(env.PUBLIC_URL);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      throw new Error('PUBLIC_URL must be an http(s) origin, without a path or credentials');
    publicUrl = url.origin;
  }
  return {
    port: integer(env, 'PORT', 4317, 1, 65535),
    host: env.HOST || '0.0.0.0',
    production: env.NODE_ENV === 'production' || args.includes('--production'),
    rootDir,
    dataDir: resolve(env.DATA_DIR || resolve(rootDir, 'data')),
    publicUrl,
    trustProxyHops: integer(env, 'TRUST_PROXY_HOPS', 0, 0, 5),
    maxRooms: integer(env, 'MAX_ROOMS', 50, 1, 500),
    roomTtlMs: 3 * 60_000,
    hostReconnectMs: 30_000,
    playerReconnectMs: 30_000,
  };
}
