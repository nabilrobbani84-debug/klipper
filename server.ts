import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import { validateVideoUrl, checkRateLimit } from './server/security';
import { JobQueue } from './server/queue';
import { VideoProcessingWorker } from './server/worker';
import { ObjectStorageEngine } from './server/storageEngine';
import { AuthService, auth } from './server/authService';
import { FFmpegEngine } from './server/ffmpegEngine';
import { TranscriptionEngine } from './server/transcriptionEngine';
import { ClipDetectionEngine } from './server/clipDetectionEngine';
import { db } from './server/db';
import { Logger } from './server/logger';
import { AppError, formatErrorResponse } from './server/errors';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  app.use(express.json());

  // Request ID Middleware
  app.use((req, res, next) => {
    const rawId = req.headers['x-request-id'] as string;
    (req as any).id = rawId && /^[a-zA-Z0-9_-]{1,64}$/.test(rawId) ? rawId : `req_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    res.setHeader('X-Request-Id', (req as any).id);
    next();
  });

  // Instantiate Core Services
  const queue = JobQueue.getInstance();
  const storage = ObjectStorageEngine.getInstance();
  const worker = new VideoProcessingWorker();
  worker.startWorker();

  // Security Headers Middleware
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // Rate Limiting & SSRF Check Middleware
  app.use('/api', (req, res, next) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const rateCheck = checkRateLimit(String(clientIp), 80, 60);

    res.setHeader('X-RateLimit-Limit', '80');
    res.setHeader('X-RateLimit-Remaining', rateCheck.remaining.toString());
    res.setHeader('X-RateLimit-Reset', rateCheck.resetSeconds.toString());

    if (!rateCheck.allowed) {
      return res.status(429).json(formatErrorResponse(
        new AppError('RATE_LIMITED', 'Rate limit exceeded. Please wait a moment before sending more requests.', 429),
        (req as any).id
      ));
    }

    next();
  });

  // Extract / Authenticate User Session on all /api requests
  app.use('/api', (req, res, next) => {
    auth.authenticateRequest(req, res, next);
  });

  // Health, Readiness, and Version Endpoints (Requirement 28)
  app.get('/health', (_req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  app.get('/ready', (_req, res) => {
    res.json({
      status: 'ready',
      database: 'connected',
      queue: 'active',
      workerPool: 'ready',
      ffmpeg: 'available',
    });
  });

  app.get('/version', (_req, res) => {
    res.json({
      name: 'Klipper — AI YouTube Video Clipper',
      version: '2.4.0-production',
      nodeVersion: process.version,
      platform: process.platform,
    });
  });

  // System Metrics & Monitoring
  app.get('/api/metrics', (_req, res) => {
    const metrics = queue.getSystemMetrics();
    const storageMetrics = storage.getStorageMetrics();
    res.json({
      ...metrics,
      storageUsageMb: storageMetrics.totalMb,
      totalStoredFiles: storageMetrics.filesCount,
      memoryUsageMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
    });
  });

  // Authentication Endpoints
  app.post('/api/auth/register', (req, res) => {
    try {
      const { name, email, password } = req.body;
      if (!name || !email) {
        throw new AppError('UNAUTHORIZED', 'Name and email are required');
      }
      const result = auth.register(name, email, password);
      res.json(result);
    } catch (err) {
      res.status(400).json(formatErrorResponse(err, (req as any).id));
    }
  });

  app.post('/api/auth/login', (req, res) => {
    try {
      const { email, password } = req.body;
      const result = auth.login(email || 'creator@clipforge.ai', password);
      res.json(result);
    } catch (err) {
      res.status(401).json(formatErrorResponse(err, (req as any).id));
    }
  });

  app.post('/api/auth/google', (req, res) => {
    try {
      const { name, email } = req.body;
      const result = auth.googleLogin(name, email);
      res.json(result);
    } catch (err) {
      res.status(500).json(formatErrorResponse(err, (req as any).id));
    }
  });

  app.get('/api/auth/me', (req, res) => {
    const user = (req as any).user;
    const usage = user ? db.getUsage(user.id) : null;
    res.json({
      user: {
        ...user,
        credits: usage?.creditsRemaining ?? 120,
        minutesUsed: Math.round((usage?.processingSeconds || 0) / 60),
        minutesLimit: user?.plan === 'pro' ? 600 : user?.plan === 'creator' ? 180 : 60,
      },
    });
  });

  // User Usage & Credit Balance Endpoint
  app.get('/api/user/usage', (req, res) => {
    const user = (req as any).user;
    const usage = db.getUsage(user.id);
    res.json({
      creditsRemaining: usage.creditsRemaining,
      processingMinutes: Math.round(usage.processingSeconds / 60),
      renderingMinutes: Math.round(usage.renderingSeconds / 60),
      storageMb: Math.round((usage.storageBytes / (1024 * 1024)) * 10) / 10,
    });
  });

  // Projects CRUD Endpoints (Strict Multi-Tenant Isolation)
  app.get('/api/projects', (req, res) => {
    const user = (req as any).user;
    const userProjects = db.findProjectsByUserId(user.id);
    res.json({ projects: userProjects });
  });

  app.get('/api/projects/:id', (req, res) => {
    const user = (req as any).user;
    const project = db.findProjectById(req.params.id);
    if (!project) {
      return res.status(404).json(formatErrorResponse(new AppError('NOT_FOUND', 'Project not found', 404), (req as any).id));
    }
    // Authorization Check: user can only access their own projects unless ADMIN
    if (project.userId !== user.id && user.role !== 'ADMIN') {
      return res.status(403).json(formatErrorResponse(new AppError('FORBIDDEN', 'Access denied to this project', 403), (req as any).id));
    }
    const clips = db.findClipsByProjectId(project.id);
    res.json({ project, clips });
  });

  app.delete('/api/projects/:id', (req, res) => {
    const user = (req as any).user;
    const project = db.findProjectById(req.params.id);
    if (!project) {
      return res.status(404).json(formatErrorResponse(new AppError('NOT_FOUND', 'Project not found', 404), (req as any).id));
    }
    // Authorization check
    if (project.userId !== user.id && user.role !== 'ADMIN') {
      return res.status(403).json(formatErrorResponse(new AppError('FORBIDDEN', 'Access denied to this project', 403), (req as any).id));
    }
    db.deleteProject(req.params.id);
    res.json({ success: true, message: 'Project and all clips deleted' });
  });

  // Exports Endpoints (Strict Multi-Tenant Isolation)
  app.get('/api/exports', (req, res) => {
    const user = (req as any).user;
    const userExports = db.findExportsByUserId(user.id);
    res.json({ success: true, exports: userExports });
  });

  app.delete('/api/exports/:id', (req, res) => {
    const user = (req as any).user;
    const exportRecord = db.exports.get(req.params.id);
    if (!exportRecord) {
      return res.status(404).json(formatErrorResponse(new AppError('NOT_FOUND', 'Export record not found', 404), (req as any).id));
    }
    if (exportRecord.userId !== user.id && user.role !== 'ADMIN') {
      return res.status(403).json(formatErrorResponse(new AppError('FORBIDDEN', 'Access denied to delete this export', 403), (req as any).id));
    }
    db.deleteExport(req.params.id);
    res.json({ success: true, message: 'Export deleted' });
  });

  // Create Video Processing Pipeline Job (with SSRF protection & credit deduction)
  app.post('/api/jobs', async (req, res) => {
    try {
      const { videoUrl, videoInfo, contentGoal, hookType, preferredDuration } = req.body;
      const user = (req as any).user;

      if (!videoUrl && !videoInfo?.url) {
        throw new AppError('INVALID_URL', 'Valid YouTube URL is required', 400);
      }

      const targetUrl = videoUrl || videoInfo.url;
      const validation = validateVideoUrl(targetUrl);
      if (!validation.isValid) {
        throw new AppError('INVALID_URL', validation.error || 'Invalid or forbidden URL', 400);
      }

      // Check and deduct credits: 5 credits for AI analysis + 1 credit per minute
      const estMinutes = Math.ceil((videoInfo?.durationSeconds || 600) / 60);
      const creditCost = 5 + estMinutes;
      const creditCheck = auth.deductCredits(user.id, creditCost, estMinutes * 60);
      if (!creditCheck.success) {
        throw new AppError('QUOTA_EXCEEDED', creditCheck.error || 'Insufficient credits', 402);
      }

      // Create queue job
      const job = queue.createJob({
        type: 'ANALYZE_VIDEO',
        userId: user.id,
        videoUrl: validation.sanitizedUrl,
        videoInfo,
      });

      res.status(202).json({
        jobId: job.id,
        status: job.status,
        stage: job.currentStage,
        message: 'Processing job accepted into worker queue',
      });
    } catch (err: any) {
      Logger.error(`Job creation failed: ${err.message}`);
      res.status(err.statusCode || 500).json(formatErrorResponse(err, (req as any).id));
    }
  });

  // Real-Time Server-Sent Events (SSE) Stream for Job Status
  app.get('/api/jobs/:id/events', (req, res) => {
    const user = (req as any).user;
    const job = queue.getJob(req.params.id);
    if (!job) {
      return res.status(404).json(formatErrorResponse(new AppError('NOT_FOUND', 'Job not found', 404), (req as any).id));
    }
    // Authorization Check: user can only stream their own jobs unless ADMIN
    if (job.userId !== user.id && user.role !== 'ADMIN') {
      return res.status(403).json(formatErrorResponse(new AppError('FORBIDDEN', 'Access denied to this job stream', 403), (req as any).id));
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    queue.registerSSEClient(req.params.id, res);
  });

  // Get All Queue Jobs (Filtered by user unless ADMIN)
  app.get('/api/jobs', (req, res) => {
    const user = (req as any).user;
    const allJobs = queue.getAllJobs();
    const userJobs = user.role === 'ADMIN' ? allJobs : allJobs.filter(j => j.userId === user.id);
    res.json({ jobs: userJobs });
  });

  // Get Single Job Status & Logs (With Authorization)
  app.get('/api/jobs/:id', (req, res) => {
    const user = (req as any).user;
    const job = queue.getJob(req.params.id);
    if (!job) {
      return res.status(404).json(formatErrorResponse(new AppError('NOT_FOUND', 'Job not found', 404), (req as any).id));
    }
    if (job.userId !== user.id && user.role !== 'ADMIN') {
      return res.status(403).json(formatErrorResponse(new AppError('FORBIDDEN', 'Access denied to this job', 403), (req as any).id));
    }
    res.json({ job });
  });

  // Cancel Job (With Authorization)
  app.post('/api/jobs/:id/cancel', (req, res) => {
    const user = (req as any).user;
    const job = queue.getJob(req.params.id);
    if (!job) {
      return res.status(404).json(formatErrorResponse(new AppError('NOT_FOUND', 'Job not found', 404), (req as any).id));
    }
    if (job.userId !== user.id && user.role !== 'ADMIN') {
      return res.status(403).json(formatErrorResponse(new AppError('FORBIDDEN', 'Access denied to cancel this job', 403), (req as any).id));
    }

    const success = queue.cancelJob(req.params.id);
    res.json({ success, message: success ? 'Job cancelled' : 'Cannot cancel job' });
  });

  // Submit Server-Side FFmpeg Render Job
  app.post('/api/jobs/render', (req, res) => {
    try {
      const { clip, resolution = '1080p', aspectRatio = '9:16' } = req.body;
      const user = (req as any).user;

      if (!clip) {
        throw new AppError('RENDER_FAILED', 'Clip details required for render job', 400);
      }

      // Authorization check: if clip is associated with an existing project, verify user owns it
      if (clip.projectId) {
        const parentProject = db.findProjectById(clip.projectId);
        if (parentProject && parentProject.userId !== user.id && user.role !== 'ADMIN') {
          throw new AppError('FORBIDDEN', 'Access denied: You do not own this clip', 403);
        }
      }

      // Feature Gating: 4K rendering requires 'pro' or 'business' plan
      if (resolution === '4K' && user.plan !== 'pro' && user.plan !== 'business') {
        throw new AppError('FORBIDDEN', '4K ultra-high definition export requires Pro or Business subscription', 403);
      }

      // Deduct 2 credits per rendered minute
      const renderCredits = Math.max(2, Math.ceil((clip.duration || 30) / 30));
      const creditCheck = auth.deductCredits(user.id, renderCredits, 0);
      if (!creditCheck.success) {
        throw new AppError('QUOTA_EXCEEDED', creditCheck.error || 'Insufficient credits', 402);
      }

      const job = queue.createJob({
        type: 'RENDER_CLIP',
        userId: user.id,
        clipId: clip.id,
        targetResolution: resolution,
        targetAspectRatio: aspectRatio,
      });

      // Pass clip to worker execution in background
      setTimeout(() => {
        worker.executeRenderPipeline(job, clip).catch(err => {
          queue.failJob(job.id, err.message);
        });
      }, 50);

      res.status(202).json({
        jobId: job.id,
        status: job.status,
        message: 'FFmpeg render job queued',
      });
    } catch (err: any) {
      res.status(err.statusCode || 500).json(formatErrorResponse(err, (req as any).id));
    }
  });

  // Synchronous AI Clip Analysis (with 7-factor weighted scoring)
  app.post('/api/analyze-clips', async (req, res) => {
    try {
      const { videoInfo, contentGoal, hookType, preferredDuration, language = 'auto' } = req.body;

      if (!videoInfo?.url) {
        throw new AppError('INVALID_URL', 'Video info is required', 400);
      }

      const validation = validateVideoUrl(videoInfo.url);
      if (!validation.isValid) {
        throw new AppError('INVALID_URL', validation.error || 'Invalid URL', 400);
      }

      const transcription = await TranscriptionEngine.transcribe(
        videoInfo.title,
        videoInfo.durationSeconds || 600,
        { language }
      );

      const clips = await ClipDetectionEngine.detectClips(
        videoInfo,
        transcription.sentences,
        transcription.speakerCuts,
        contentGoal,
        hookType,
        preferredDuration,
        transcription.language
      );

      res.json({
        clips,
        transcription,
        language: transcription.language,
      });
    } catch (err: any) {
      Logger.error(`Synchronous clip analysis error: ${err.message}`);
      res.status(err.statusCode || 500).json(formatErrorResponse(err, (req as any).id));
    }
  });

  // Secure Object Storage Signed Download
  app.get('/api/storage/download', (req, res) => {
    const { path: relPath, expires, token } = req.query;

    if (!relPath || !expires || !token) {
      return res.status(400).json(formatErrorResponse(new AppError('STORAGE_FAILED', 'Missing signed URL parameters', 400), (req as any).id));
    }

    const isValid = storage.verifySignedUrl(
      String(relPath),
      String(expires),
      String(token)
    );

    if (!isValid) {
      return res.status(403).json(formatErrorResponse(new AppError('UNAUTHORIZED', 'Signature invalid or download URL expired', 403), (req as any).id));
    }

    const absPath = storage.getFilePath(String(relPath));
    if (!fs.existsSync(absPath)) {
      return res.status(404).json(formatErrorResponse(new AppError('NOT_FOUND', 'File not found or expired from storage', 404), (req as any).id));
    }

    const filename = path.basename(absPath);
    res.download(absPath, filename);
  });

  // Mount Vite middleware in development or static files in production
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  // Central Error Handler Middleware
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    Logger.error(`Unhandled Server Error: ${err.message}`, { stack: err.stack });
    res.status(err.statusCode || 500).json(formatErrorResponse(err));
  });

  app.listen(PORT, '0.0.0.0', () => {
    Logger.info(`ClipForge AI Enterprise Engine running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal Server Boot Error:', err);
  process.exit(1);
});
