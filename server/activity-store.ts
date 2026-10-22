import type { DatabaseSync } from 'node:sqlite';
import {
  ACTIVITY_RANGES,
  type ActivityCounts,
  type ActivityHistory,
  type ActivityRange,
} from '../shared/activity.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// Only aggregate counts and times enter these tables. No sessions, names, IPs or room codes.
export class ActivityStore {
  private previous = '';
  private cleanupAt = 0;
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS activity_minutes (
        at INTEGER PRIMARY KEY, players INTEGER NOT NULL, playing_players INTEGER NOT NULL,
        active_rooms INTEGER NOT NULL, peak_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS activity_summary (
        id INTEGER PRIMARY KEY CHECK(id = 1), started_at INTEGER NOT NULL,
        peak_players INTEGER NOT NULL, peak_at INTEGER
      );
    `);
  }
  record(counts: ActivityCounts, now = Date.now()) {
    const minute = Math.floor(now / MINUTE) * MINUTE;
    const key = `${minute}:${counts.players}:${counts.playingPlayers}:${counts.activeRooms}`;
    if (key === this.previous) return;
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          `
        INSERT INTO activity_summary(id, started_at, peak_players, peak_at) VALUES(1, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          peak_at = CASE WHEN excluded.peak_players > peak_players THEN excluded.peak_at ELSE peak_at END,
          peak_players = MAX(peak_players, excluded.peak_players)
      `,
        )
        .run(now, counts.players, counts.players > 0 ? now : null);
      this.db
        .prepare(
          `
        INSERT INTO activity_minutes(at, players, playing_players, active_rooms, peak_at) VALUES(?, ?, ?, ?, ?)
        ON CONFLICT(at) DO UPDATE SET
          peak_at = CASE WHEN excluded.players > players THEN excluded.peak_at ELSE peak_at END,
          players = MAX(players, excluded.players),
          playing_players = MAX(playing_players, excluded.playing_players),
          active_rooms = MAX(active_rooms, excluded.active_rooms)
      `,
        )
        .run(minute, counts.players, counts.playingPlayers, counts.activeRooms, now);
      if (now >= this.cleanupAt)
        this.db.prepare('DELETE FROM activity_minutes WHERE at < ?').run(minute - 90 * 24 * HOUR);
      this.db.exec('COMMIT');
      this.previous = key;
      this.cleanupAt = Math.floor(now / (24 * HOUR)) * 24 * HOUR + 24 * HOUR;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  history(range: ActivityRange, current: ActivityCounts, now = Date.now()): ActivityHistory {
    const bucketMs = range === '24h' ? MINUTE : HOUR;
    const from = Math.floor((now - ACTIVITY_RANGES[range] * HOUR) / bucketMs) * bucketMs;
    const summary = this.db
      .prepare('SELECT started_at, peak_players, peak_at FROM activity_summary WHERE id = 1')
      .get();
    const points = this.db
      .prepare(
        `
      WITH buckets AS (
        SELECT *, CAST(at / ? AS INTEGER) * ? AS bucket FROM activity_minutes WHERE at >= ? AND at <= ?
      ), peaks AS (
        SELECT bucket, MAX(players) AS players, MAX(playing_players) AS playing_players,
          MAX(active_rooms) AS active_rooms FROM buckets GROUP BY bucket
      )
      SELECT p.*, MIN(b.peak_at) AS peak_at FROM peaks p
        JOIN buckets b ON b.bucket = p.bucket AND b.players = p.players
        GROUP BY p.bucket ORDER BY p.bucket
    `,
      )
      .all(bucketMs, bucketMs, from, now)
      .map((row) => ({
        at: Number(row.bucket),
        players: Number(row.players),
        playingPlayers: Number(row.playing_players),
        activeRooms: Number(row.active_rooms),
        peakAt: Number(row.peak_at),
      }));
    return {
      generatedAt: now,
      startedAt: Number(summary?.started_at ?? now),
      range,
      bucketMs,
      current,
      peak: {
        players: Number(summary?.peak_players ?? 0),
        at: summary?.peak_at == null ? null : Number(summary.peak_at),
      },
      points,
    };
  }
}
