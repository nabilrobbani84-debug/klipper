import crypto from 'crypto';
import { Response } from 'express';
import { QueueJob, JobStage, JobStatus, JobLogEntry, SystemMetrics } from '../src/types';
import { db } from './db';
import { Logger } from './logger';

type JobListener = (job: QueueJob) => void;

export class JobQueue {
  private static instance: JobQueue;
  private jobs = new Map<string, QueueJob>();
  private listeners = new Set<JobListener>();
  private sseClients = new Map<string, Set<Response>>();
  private maxConcurrency = 4;
  private totalRenderTimeAccumulator = 0;
  private totalCompletedRenders = 0;

  private constructor() {
    this.hydrateFromDb();
  }

  public static getInstance(): JobQueue {
    if (!JobQueue.instance) {
      JobQueue.instance = new JobQueue();
    }
    return JobQueue.instance;
  }

  private hydrateFromDb() {
    try {
      const persistedJobs = db.getAllRenderJobs();
      for (const pj of persistedJobs) {
        this.jobs.set(pj.id, {
          id: pj.id,
          type: pj.type as any,
          userId: pj.userId,
          clipId: pj.clipId,
          targetResolution: pj.targetResolution as any,
          targetAspectRatio: pj.targetAspectRatio as any,
          status: pj.status as any,
          currentStage: pj.currentStage as any,
          progressPercent: pj.progress,
          currentAttempt: pj.attempts,
          maxAttempts: pj.maxAttempts,
          createdAt: pj.createdAt,
          startedAt: pj.startedAt,
          completedAt: pj.completedAt,
          error: pj.error,
          logs: pj.logs || [],
          resultData: pj.resultData,
        });
      }
    } catch (e) {
      console.warn('[Queue] Hydration note:', e);
    }
  }

  public createJob(params: Partial<QueueJob> & { type: QueueJob['type']; userId: string }): QueueJob {
    // Idempotency check: if an identical video analysis is currently active, return existing job
    if (params.type === 'ANALYZE_VIDEO' && params.videoUrl) {
      const activeJob = Array.from(this.jobs.values()).find(
        j => j.type === 'ANALYZE_VIDEO' &&
             j.videoUrl === params.videoUrl &&
             (j.status === 'pending' || j.status === 'processing')
      );
      if (activeJob) {
        Logger.info('Returning existing idempotent job for URL', { jobId: activeJob.id, url: params.videoUrl });
        return activeJob;
      }
    }

    const jobId = `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const initialLog: JobLogEntry = {
      timestamp: new Date().toLocaleTimeString(),
      stage: 'QUEUED',
      message: `Job ${jobId} initialized in worker pipeline`,
      level: 'info',
    };

    const newJob: QueueJob = {
      id: jobId,
      type: params.type,
      userId: params.userId,
      videoUrl: params.videoUrl,
      videoInfo: params.videoInfo,
      clipId: params.clipId,
      targetResolution: params.targetResolution || '1080p',
      targetAspectRatio: params.targetAspectRatio || '9:16',
      status: 'pending',
      currentStage: 'QUEUED',
      progressPercent: 0,
      currentAttempt: 1,
      maxAttempts: 3,
      createdAt: new Date().toISOString(),
      logs: [initialLog],
    };

    this.jobs.set(jobId, newJob);

    // Save to DB
    db.saveRenderJob({
      id: newJob.id,
      userId: newJob.userId,
      clipId: newJob.clipId,
      type: newJob.type,
      targetResolution: newJob.targetResolution || '1080p',
      targetAspectRatio: newJob.targetAspectRatio || '9:16',
      status: 'pending',
      currentStage: 'QUEUED',
      progress: 0,
      attempts: 1,
      maxAttempts: 3,
      logs: [initialLog],
      createdAt: newJob.createdAt,
    });

    Logger.info('New job queued', { jobId, type: params.type, userId: params.userId });
    this.notify(newJob);
    return newJob;
  }

  public getJob(jobId: string): QueueJob | undefined {
    return this.jobs.get(jobId);
  }

  public getAllJobs(): QueueJob[] {
    return Array.from(this.jobs.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  public updateJobStage(
    jobId: string,
    stage: JobStage,
    progress: number,
    logMsg?: string,
    logLevel: JobLogEntry['level'] = 'info'
  ) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.currentStage = stage;
    job.progressPercent = Math.min(100, Math.max(0, progress));

    if (stage === 'COMPLETED') {
      job.status = 'completed';
      job.completedAt = new Date().toISOString();
      if (job.startedAt) {
        job.durationSeconds = Math.round(
          (new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()) / 1000
        );
        this.totalRenderTimeAccumulator += job.durationSeconds;
        this.totalCompletedRenders++;
      }
    } else if (stage === 'FAILED') {
      job.status = 'failed';
    } else {
      job.status = 'processing';
      if (!job.startedAt) {
        job.startedAt = new Date().toISOString();
      }
    }

    if (logMsg) {
      job.logs.push({
        timestamp: new Date().toLocaleTimeString(),
        stage,
        message: logMsg,
        level: logLevel,
      });
      if (job.logs.length > 50) {
        job.logs = job.logs.slice(-50);
      }
    }

    // Persist update
    db.saveRenderJob({
      id: job.id,
      userId: job.userId,
      clipId: job.clipId,
      type: job.type,
      targetResolution: job.targetResolution || '1080p',
      targetAspectRatio: job.targetAspectRatio || '9:16',
      status: job.status,
      currentStage: job.currentStage,
      progress: job.progressPercent,
      attempts: job.currentAttempt,
      maxAttempts: job.maxAttempts,
      error: job.error,
      logs: job.logs,
      resultData: job.resultData,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      createdAt: job.createdAt,
    });

    this.notify(job);
    this.broadcastSSE(jobId, job);
  }

  public failJob(jobId: string, error: string, retryDelayMs: number = 2000): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    job.logs.push({
      timestamp: new Date().toLocaleTimeString(),
      stage: job.currentStage,
      message: `Error encountered: ${error}`,
      level: 'error',
    });

    if (job.currentAttempt < job.maxAttempts) {
      job.currentAttempt++;
      job.status = 'retrying';
      job.logs.push({
        timestamp: new Date().toLocaleTimeString(),
        stage: job.currentStage,
        message: `Scheduling Retry attempt ${job.currentAttempt}/${job.maxAttempts} in ${retryDelayMs / 1000}s...`,
        level: 'warn',
      });
      this.notify(job);
      this.broadcastSSE(jobId, job);
      return true;
    } else {
      job.status = 'failed';
      job.error = error;
      job.currentStage = 'FAILED';
      this.notify(job);
      this.broadcastSSE(jobId, job);
      return false;
    }
  }

  public cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.status === 'completed') return false;

    job.status = 'cancelled';
    job.logs.push({
      timestamp: new Date().toLocaleTimeString(),
      stage: job.currentStage,
      message: 'Job cancelled by user request',
      level: 'warn',
    });
    this.notify(job);
    this.broadcastSSE(jobId, job);
    return true;
  }

  // Server-Sent Events (SSE) Registration
  public registerSSEClient(jobId: string, res: Response) {
    if (!this.sseClients.has(jobId)) {
      this.sseClients.set(jobId, new Set());
    }
    this.sseClients.get(jobId)!.add(res);

    // Send current snapshot immediately
    const current = this.jobs.get(jobId);
    if (current) {
      res.write(`data: ${JSON.stringify(current)}\n\n`);
    }

    res.on('close', () => {
      const clients = this.sseClients.get(jobId);
      if (clients) {
        clients.delete(res);
        if (clients.size === 0) {
          this.sseClients.delete(jobId);
        }
      }
    });
  }

  private broadcastSSE(jobId: string, job: QueueJob) {
    const clients = this.sseClients.get(jobId);
    if (clients) {
      const payload = `data: ${JSON.stringify(job)}\n\n`;
      for (const res of clients) {
        try {
          res.write(payload);
        } catch {
          clients.delete(res);
        }
      }
    }
  }

  public getSystemMetrics(): SystemMetrics {
    const jobs = Array.from(this.jobs.values());
    const totalJobs = jobs.length;
    const completedJobs = jobs.filter(j => j.status === 'completed').length;
    const failedJobs = jobs.filter(j => j.status === 'failed').length;
    const processingJobs = jobs.filter(j => j.status === 'processing' || j.status === 'retrying').length;
    const pendingJobs = jobs.filter(j => j.status === 'pending').length;

    const avgRender =
      this.totalCompletedRenders > 0
        ? Math.round(this.totalRenderTimeAccumulator / this.totalCompletedRenders)
        : 14;

    return {
      totalJobs,
      completedJobs,
      failedJobs,
      processingJobs,
      pendingJobs,
      averageRenderTimeSeconds: avgRender,
      activeWorkers: processingJobs,
      maxWorkers: this.maxConcurrency,
      storageUsageMb: 142.5,
      storageLimitMb: 5000,
      queueLatencyMs: 45,
      ffmpegStatus: processingJobs > 0 ? 'busy' : 'idle',
    };
  }

  public subscribe(listener: JobListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(job: QueueJob) {
    for (const listener of this.listeners) {
      try {
        listener(job);
      } catch (err) {
        console.error('Job listener error:', err);
      }
    }
  }
}
