import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import type { AppConfig } from './config.js';
import type { QueuePayload } from './types.js';

export const QUEUE_NAME = 'clipforge-processing';

export function createRedisConnection(config: AppConfig) {
  return new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true });
}

export function createProcessingQueue(config: AppConfig) {
  const connection = createRedisConnection(config);
  const queue = new Queue<QueuePayload>(QUEUE_NAME, { connection, defaultJobOptions: { attempts: 2, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 100, removeOnFail: 500 } });
  return { queue, connection };
}
