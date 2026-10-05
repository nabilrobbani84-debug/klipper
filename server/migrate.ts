import 'dotenv/config';
import { Repository, runMigrations } from './db.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const repository = new Repository({ DATABASE_URL: databaseUrl });
try {
  const applied = await runMigrations(repository.pool, (message) => console.log(message));
  console.log(applied.length > 0 ? `Applied ${applied.length} migration(s).` : 'Database is up to date.');
} finally {
  await repository.close();
}
