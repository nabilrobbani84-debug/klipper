import 'dotenv/config';
import { createApp } from './api.js';
import { loadConfig } from './config.js';
import { Repository, runMigrations } from './db.js';
import { createLogger } from './logger.js';
import { Metrics } from './metrics.js';
import { createProcessingQueue } from './queue.js';
import { createObjectStorage } from './services/storage.js';

const config = loadConfig();
const logger = createLogger(config);
const repository = new Repository(config);

await runMigrations(repository.pool, (message) => logger.info(message));

const { queue, connection } = createProcessingQueue(config);
const storage = createObjectStorage(config);
const app = createApp({ config, repository, queue, storage, metrics: new Metrics(), logger });

const server = app.listen(config.PORT, () => logger.info({ port: config.PORT, url: config.APP_URL }, 'ClipForge API listening'));
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'API shutting down');
  server.close();
  await queue.close().catch(() => undefined);
  await connection.quit().catch(() => undefined);
  await repository.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
