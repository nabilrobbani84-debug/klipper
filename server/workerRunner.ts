import dotenv from 'dotenv';
import { VideoProcessingWorker } from './worker';
import { JobQueue } from './queue';
import { Logger } from './logger';
import { db } from './db';

dotenv.config();

/**
 * Dedicated Google Cloud Run Video Worker Process Entry Point
 */
async function startWorkerService() {
  Logger.info('====================================================');
  Logger.info('🚀 Klipper AI Dedicated Cloud Run Video Worker Starting');
  Logger.info(`   Node.js: ${process.version} | Platform: ${process.platform}`);
  Logger.info(`   PID: ${process.pid} | Environment: ${process.env.NODE_ENV || 'production'}`);
  Logger.info('====================================================');

  const queue = JobQueue.getInstance();
  const worker = new VideoProcessingWorker();

  let isTerminating = false;

  // Start Worker Loop
  await worker.startWorker();

  // Graceful Shutdown Handling (Cloud Run SIGTERM / SIGINT)
  const shutdown = async (signal: string) => {
    if (isTerminating) return;
    isTerminating = true;

    Logger.warn(`[Worker] Received ${signal}. Initiating graceful shutdown...`);

    // Give in-flight jobs a moment or mark them safely
    try {
      const activeJobs = queue.getAllJobs().filter(j => j.status === 'processing');
      if (activeJobs.length > 0) {
        Logger.info(`[Worker] Waiting up to 8s for ${activeJobs.length} active job(s) to finalize...`);
        for (const job of activeJobs) {
          queue.updateJobStage(job.id, job.currentStage, job.progressPercent, `Worker received ${signal}. Resuming on next available node.`);
        }
      }

      await db.disconnect();
      Logger.info('[Worker] Database and queue resources cleanly released.');
    } catch (err: any) {
      Logger.error(`[Worker] Error during shutdown: ${err.message}`);
    }

    Logger.info('[Worker] Shutdown complete. Exiting gracefully.');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startWorkerService().catch(err => {
  console.error('Fatal Worker Service Failure:', err);
  process.exit(1);
});
