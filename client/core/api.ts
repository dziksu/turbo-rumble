import { isRecord, parseSession } from '../../shared/protocol.ts';
import type { Session } from '../../shared/types.ts';
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body !== undefined ? 'POST' : 'GET',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const value: unknown = await response.json();
  if (!response.ok)
    throw new Error(
      isRecord(value) && typeof value.error === 'string'
        ? value.error
        : 'Nie udało się połączyć z grą.',
    );
  return value as T;
}
export function safeSession(key: string): Session | null {
  try {
    const session = parseSession(JSON.parse(localStorage.getItem(key) ?? 'null'));
    return session?.role === 'spectator' ? null : session;
  } catch {
    return null;
  }
}
