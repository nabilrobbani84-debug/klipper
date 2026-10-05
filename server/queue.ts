import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import type { AppConfig } from './config.js';
import type { QueuePayload } from './types.js';

export const QUEUE_NAME = 'clipforge-processing';

export function createRedisConnection(config: Pick<AppConfig, 'REDIS_URL'>): Redis {
  return new Redis(config.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true });
}

export type ProcessingQueue = Pick<Queue<QueuePayload>, 'add' | 'getJob' | 'waitUntilReady' | 'close' | 'getJobCounts' | 'getWorkersCount'>;

export function createProcessingQueue(config: Pick<AppConfig, 'REDIS_URL'>) {
  const connection = createRedisConnection(config);
  const queue = new Queue<QueuePayload>(QUEUE_NAME, {
    connection,
    defaultJobOptions: { attempts: 1, removeOnComplete: 500, removeOnFail: 1000 },
  });
  return { queue, connection };
}
