import 'dotenv/config';
import { createApp } from './api.js';
import { loadConfig } from './config.js';
import { PostgresProjectRepository } from './db.js';
import { createLogger } from './logger.js';
import { Metrics } from './metrics.js';
import { createProcessingQueue } from './queue.js';
import { createObjectStorage } from './services/storage.js';

const config = loadConfig();
const logger = createLogger(config);
const repository = new PostgresProjectRepository(config);
const { queue, connection } = createProcessingQueue(config);
const storage = createObjectStorage(config);
const app = createApp({ config, repository, queue, metrics: new Metrics(), logger, storage });

const server = app.listen(config.PORT, () => logger.info({ port: config.PORT }, 'ClipForge API listening'));

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  server.close();
  await queue.close();
  await connection.quit();
  await repository.pool.end();
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
