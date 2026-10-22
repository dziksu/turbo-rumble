import { resolve } from 'node:path';
import { loadConfig } from '../server/config.ts';
import { backupResults } from '../server/backup.ts';

const destination = process.argv[2];
if (!destination) throw new Error('Usage: npm run backup -- /path/to/new-backup.sqlite');
console.log(await backupResults(resolve(loadConfig().dataDir, 'results.sqlite'), destination));
