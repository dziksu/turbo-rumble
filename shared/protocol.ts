import { MAPS, type RaceSettings } from './maps.ts';
import type { Input, ConnectionSession, Snapshot } from './types.ts';

export type HostCommand =
  | { action: 'start' | 'lobby' | 'bot' }
  | { action: 'remove'; id: string }
  | { action: 'settings'; settings: RaceSettings };
export type CommandResult = { ok: true } | { ok: false; error: string };
export interface ClientToServerEvents {
  input: (input: Input) => void;
  ready: (ready: boolean, ack?: () => void) => void;
  host: (command: HostCommand, ack?: (result: CommandResult) => void) => void;
  'ping-time': (ack: () => void) => void;
}
export interface ServerToClientEvents {
  state: (state: Snapshot) => void;
  session: (session: { playerId: string | null }) => void;
}
export interface RoomInfo {
  code: string;
  phase: Snapshot['phase'];
  players: number;
}
export interface NetworkInfo {
  localUrl: string;
  networkUrls: string[];
  publicUrl: string | null;
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export interface ServerStats {
  players: number;
  activeRooms: number;
  rooms: number;
  maxRooms: number;
}
export function isServerStats(value: unknown): value is ServerStats {
  if (!isRecord(value)) return false;
  const { players, activeRooms, rooms, maxRooms } = value;
  return (
    typeof maxRooms === 'number' &&
    Number.isSafeInteger(maxRooms) &&
    maxRooms > 0 &&
    typeof rooms === 'number' &&
    Number.isSafeInteger(rooms) &&
    rooms >= 0 &&
    rooms <= maxRooms &&
    typeof activeRooms === 'number' &&
    Number.isSafeInteger(activeRooms) &&
    activeRooms >= 0 &&
    activeRooms <= rooms &&
    typeof players === 'number' &&
    Number.isSafeInteger(players) &&
    players >= 0 &&
    players <= activeRooms * 8
  );
}
export function isInput(value: unknown): value is Input {
  return (
    isRecord(value) &&
    typeof value.seq === 'number' &&
    Number.isSafeInteger(value.seq) &&
    value.seq >= 0 &&
    typeof value.actionSeq === 'number' &&
    Number.isSafeInteger(value.actionSeq) &&
    value.actionSeq >= 0 &&
    value.actionSeq <= 1e9 &&
    typeof value.left === 'boolean' &&
    typeof value.right === 'boolean'
  );
}
export function parseSession(value: unknown): ConnectionSession | null {
  if (
    isRecord(value) &&
    typeof value.code === 'string' &&
    /^[A-Z2-9]{6}$/.test(value.code) &&
    value.role === 'spectator'
  )
    return { code: value.code, role: 'spectator' };
  if (
    !isRecord(value) ||
    typeof value.code !== 'string' ||
    !/^[A-Z2-9]{6}$/.test(value.code) ||
    typeof value.token !== 'string' ||
    value.token.length < 1 ||
    value.token.length > 128
  )
    return null;
  if (value.role === 'host') return { code: value.code, token: value.token, role: 'host' };
  if (value.role === 'player' && typeof value.playerId === 'string' && value.playerId.length > 0)
    return { code: value.code, token: value.token, role: 'player', playerId: value.playerId };
  return null;
}
export function parseHostCommand(value: unknown): HostCommand | null {
  if (!isRecord(value)) return null;
  if (value.action === 'settings' && isRecord(value.settings)) {
    const { mapId, lapLimit, winningScore } = value.settings;
    if (
      typeof mapId === 'string' &&
      Object.hasOwn(MAPS, mapId) &&
      Number.isInteger(lapLimit) &&
      typeof lapLimit === 'number' &&
      lapLimit >= 1 &&
      lapLimit <= 9 &&
      Number.isInteger(winningScore) &&
      typeof winningScore === 'number' &&
      winningScore >= 6 &&
      winningScore <= 50
    )
      return {
        action: 'settings',
        settings: { mapId: mapId as RaceSettings['mapId'], lapLimit, winningScore },
      };
    return null;
  }
  if (value.action === 'start' || value.action === 'lobby' || value.action === 'bot')
    return { action: value.action };
  if (value.action === 'remove' && typeof value.id === 'string' && value.id.length > 0)
    return { action: 'remove', id: value.id };
  return null;
}
