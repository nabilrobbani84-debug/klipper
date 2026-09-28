import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { PostgresProjectRepository } from './db.js';
import { createLogger } from './logger.js';
import { createObjectStorage } from './services/storage.js';

const config = loadConfig();
const logger = createLogger(config);
const repository = new PostgresProjectRepository(config);
const storage = createObjectStorage(config);

async function removeOldTempDirectories() {
  const root = path.resolve(config.TEMP_DIR);
  await fs.mkdir(root, { recursive: true });
  const entries = await fs.readdir(root, { withFileTypes: true });
  const cutoff = Date.now() - config.TEMP_RETENTION_HOURS * 60 * 60 * 1000;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(root, entry.name);
    const stat = await fs.stat(fullPath);
    if (stat.mtimeMs < cutoff) await fs.rm(fullPath, { recursive: true, force: true });
  }
}

async function removeExpiredExports() {
  const result = await repository.pool.query(`SELECT id, storage_key FROM exports WHERE created_at < NOW() - ($1 || ' days')::interval`, [config.EXPORT_RETENTION_DAYS]);
  for (const row of result.rows) {
    await storage.delete(String(row.storage_key));
    await repository.pool.query('DELETE FROM exports WHERE id = $1', [row.id]);
  }
}

async function removeExpiredSources() {
  const result = await repository.pool.query(`SELECT v.project_id, v.source_storage_key FROM videos v JOIN projects p ON p.id = v.project_id WHERE v.source_storage_key IS NOT NULL AND p.updated_at < NOW() - ($1 || ' days')::interval`, [config.SOURCE_RETENTION_DAYS]);
  for (const row of result.rows) {
    await storage.delete(String(row.source_storage_key));
    await repository.pool.query('UPDATE videos SET source_storage_key = NULL WHERE project_id = $1', [row.project_id]);
  }
}

await removeOldTempDirectories();
await removeExpiredExports();
await removeExpiredSources();
logger.info('storage cleanup completed');
await repository.pool.end();
