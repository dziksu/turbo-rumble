import { backup, DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export async function backupResults(source: string, destination: string) {
  const input = resolve(source),
    output = resolve(destination);
  if (input === output || existsSync(output))
    throw new Error('Backup destination must be a new file, different from the source.');
  const db = new DatabaseSync(input, { readOnly: true });
  try {
    mkdirSync(dirname(output), { recursive: true });
    await backup(db, output);
    const copy = new DatabaseSync(output, { readOnly: true });
    try {
      const integrity = copy.prepare('PRAGMA integrity_check').get();
      if (integrity?.integrity_check !== 'ok') throw new Error('Backup integrity check failed.');
    } finally {
      copy.close();
    }
  } finally {
    db.close();
  }
  return output;
}
