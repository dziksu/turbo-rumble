import { isRecord } from './protocol.ts';

export const ACTIVITY_RANGES = { '24h': 24, '7d': 7 * 24, '30d': 30 * 24 } as const;
export type ActivityRange = keyof typeof ACTIVITY_RANGES;
export interface ActivityCounts {
  players: number;
  playingPlayers: number;
  activeRooms: number;
}
export interface ActivityPoint extends ActivityCounts {
  at: number;
  peakAt: number;
}
export interface ActivityHistory {
  generatedAt: number;
  startedAt: number;
  range: ActivityRange;
  bucketMs: number;
  current: ActivityCounts;
  peak: { players: number; at: number | null };
  points: ActivityPoint[];
}
export function isActivityRange(value: unknown): value is ActivityRange {
  return typeof value === 'string' && Object.hasOwn(ACTIVITY_RANGES, value);
}
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function counts(value: unknown): value is ActivityCounts {
  return (
    isRecord(value) &&
    count(value.players) &&
    count(value.playingPlayers) &&
    count(value.activeRooms) &&
    value.playingPlayers <= value.players
  );
}
export function isActivityHistory(value: unknown): value is ActivityHistory {
  return (
    isRecord(value) &&
    count(value.generatedAt) &&
    count(value.startedAt) &&
    value.startedAt <= value.generatedAt &&
    isActivityRange(value.range) &&
    (value.bucketMs === 60_000 || value.bucketMs === 3_600_000) &&
    counts(value.current) &&
    isRecord(value.peak) &&
    count(value.peak.players) &&
    (value.peak.at === null || count(value.peak.at)) &&
    Array.isArray(value.points) &&
    value.points.length <= 1441 &&
    value.points.every(
      (point: unknown) =>
        counts(point) && isRecord(point) && count(point.at) && count(point.peakAt),
    )
  );
}
