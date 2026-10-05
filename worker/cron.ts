import { AppError } from '../shared/errors.js';
import { Repository } from './db.js';
import { numberVar, type Env } from './env.js';
import { failJob, log } from './pipeline.js';

const MINUTE = 60_000;
const DAY = 86_400_000;

/**
 * Hourly maintenance:
 *  - fails jobs that stopped reporting progress (crashed/evicted containers, lost queue messages)
 *  - deletes exports and source videos past their retention window
 *  - prunes expired sessions
 */
export async function runMaintenance(env: Env, now = Date.now()) {
  const repo = new Repository(env.DB);
  let stalled = 0;
  for (const job of await repo.stalledJobs(now - 30 * MINUTE)) {
    await failJob(env, job, new AppError('WORKER_TIMEOUT', 'Processing stopped responding. Please retry.', 503, true));
    stalled += 1;
  }

  let exports = 0;
  for (const item of await repo.expiredExports(now - numberVar(env.EXPORT_RETENTION_DAYS, 90) * DAY)) {
    await env.MEDIA_BUCKET.delete(item.key).catch(() => undefined);
    await repo.deleteExportById(item.id);
    exports += 1;
  }

  let sources = 0;
  for (const key of await repo.expiredSources(now - numberVar(env.SOURCE_RETENTION_DAYS, 30) * DAY)) {
    await env.MEDIA_BUCKET.delete(key).catch(() => undefined);
    await repo.clearSourceKey(key);
    sources += 1;
  }

  await repo.pruneSessions(now);
  log('maintenance completed', { stalled, exports, sources });
  return { stalled, exports, sources };
}
