import crypto from 'crypto';
import { QueueJob, JobStage, JobStatus, JobLogEntry, SystemMetrics } from '../src/types';

type JobListener = (job: QueueJob) => void;

export class JobQueue {
  private static instance: JobQueue;
  private jobs: Map<string, QueueJob> = new Map();
  private listeners: Set<JobListener> = new Set();
  private maxConcurrency: number = 4;
  private activeJobsCount: number = 0;
  private totalRenderTimeAccumulator: number = 0;
  private totalCompletedRenders: number = 0;

  private constructor() {}

  public static getInstance(): JobQueue {
    if (!JobQueue.instance) {
      JobQueue.instance = new JobQueue();
    }
    return JobQueue.instance;
  }

  public createJob(params: Partial<QueueJob> & { type: QueueJob['type']; userId: string }): QueueJob {
    const jobId = `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const initialLog: JobLogEntry = {
      timestamp: new Date().toLocaleTimeString(),
      stage: 'QUEUED',
      message: `Job ${jobId} queued in worker pipeline`,
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
      // Cap log length
      if (job.logs.length > 50) {
        job.logs = job.logs.slice(-50);
      }
    }

    this.notify(job);
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
      return true; // will retry
    } else {
      job.status = 'failed';
      job.error = error;
      job.currentStage = 'FAILED';
      this.notify(job);
      return false; // dead letter / permanently failed
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
    return true;
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
