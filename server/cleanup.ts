import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { Repository } from './db.js';
import { createLogger } from './logger.js';
import { createObjectStorage } from './services/storage.js';

/**
 * Retention job. Run on a schedule (the production compose file runs it daily):
 *  - removes abandoned worker temp directories
 *  - deletes exports and source videos past their retention window
 *  - fails jobs that stopped reporting progress (crashed workers)
 *  - prunes expired sessions
 */
const config = loadConfig();
const logger = createLogger(config);
const repository = new Repository(config);
const storage = createObjectStorage(config);

async function removeOldTempDirectories() {
  const root = path.resolve(config.TEMP_DIR);
  await fs.mkdir(root, { recursive: true });
  const cutoff = Date.now() - config.TEMP_RETENTION_HOURS * 3600_000;
  let removed = 0;
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    const stat = await fs.stat(fullPath).catch(() => null);
    if (stat && stat.mtimeMs < cutoff) {
      await fs.rm(fullPath, { recursive: true, force: true });
      removed += 1;
    }
  }
  return removed;
}

async function removeExpiredExports() {
  const result = await repository.pool.query(`SELECT id, storage_key FROM exports WHERE created_at < NOW() - make_interval(days => $1::int)`, [Math.round(config.EXPORT_RETENTION_DAYS)]);
  for (const row of result.rows) {
    await storage.delete(String(row.storage_key)).catch((error) => logger.warn({ err: error }, 'export delete failed'));
    await repository.pool.query(`DELETE FROM exports WHERE id = $1`, [row.id]);
  }
  return result.rowCount ?? 0;
}

async function removeExpiredSources() {
  const result = await repository.pool.query(
    `SELECT DISTINCT v.source_storage_key AS key FROM videos v JOIN projects p ON p.id = v.project_id
     WHERE v.source_storage_key IS NOT NULL
     GROUP BY v.source_storage_key HAVING MAX(p.updated_at) < NOW() - make_interval(days => $1::int)`,
    [Math.round(config.SOURCE_RETENTION_DAYS)],
  );
  for (const row of result.rows) {
    await storage.delete(String(row.key)).catch((error) => logger.warn({ err: error }, 'source delete failed'));
    await repository.pool.query(`UPDATE videos SET source_storage_key = NULL WHERE source_storage_key = $1`, [row.key]);
  }
  return result.rowCount ?? 0;
}

async function failStalledJobs() {
  const result = await repository.pool.query(
    `UPDATE render_jobs SET state = 'FAILED', error_code = 'WORKER_TIMEOUT', message = 'Processing stopped responding. Please retry.', completed_at = NOW(), updated_at = NOW()
     WHERE state NOT IN ('COMPLETED','FAILED','CANCELLED') AND updated_at < NOW() - INTERVAL '6 hours'`,
  );
  return result.rowCount ?? 0;
}

async function pruneSessions() {
  const result = await repository.pool.query(`DELETE FROM auth_sessions WHERE expires_at < NOW() - INTERVAL '7 days' OR revoked_at < NOW() - INTERVAL '7 days'`);
  return result.rowCount ?? 0;
}

try {
  const summary = {
    tempDirs: await removeOldTempDirectories(),
    exports: await removeExpiredExports(),
    sources: await removeExpiredSources(),
    stalledJobs: await failStalledJobs(),
    sessions: await pruneSessions(),
  };
  logger.info(summary, 'cleanup completed');
} finally {
  await repository.close();
}
