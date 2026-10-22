import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Result } from '../shared/types.ts';

export interface SavedMatch {
  id: string;
  finishedAt: string;
  results: Result[];
}
export class ResultsStore {
  private readonly db: DatabaseSync;
  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(resolve(dataDir, 'results.sqlite'));
    this.db.exec(
      'PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS matches (id TEXT PRIMARY KEY, code TEXT NOT NULL, finished_at TEXT NOT NULL, results TEXT NOT NULL)',
    );
  }
  save(id: string, code: string, results: Result[]) {
    this.db
      .prepare('INSERT OR IGNORE INTO matches(id,code,finished_at,results) VALUES(?,?,?,?)')
      .run(id, code, new Date().toISOString(), JSON.stringify(results));
  }
  latest(): SavedMatch[] {
    return this.db
      .prepare('SELECT id,finished_at,results FROM matches ORDER BY finished_at DESC LIMIT 12')
      .all()
      .map((row) => ({
        id: String(row.id),
        finishedAt: String(row.finished_at),
        results: JSON.parse(String(row.results)) as Result[],
      }));
  }
  checkpoint() {
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  }
  close() {
    this.checkpoint();
    this.db.close();
  }
}
