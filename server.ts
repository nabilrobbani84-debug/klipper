import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import { validateVideoUrl, checkRateLimit } from './server/security';
import { JobQueue } from './server/queue';
import { VideoProcessingWorker } from './server/worker';
import { ObjectStorageEngine } from './server/storageEngine';
import { AuthService } from './server/authService';
import { FFmpegEngine } from './server/ffmpegEngine';
import { TranscriptionEngine } from './server/transcriptionEngine';
import { ClipDetectionEngine } from './server/clipDetectionEngine';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  app.use(express.json());

  // Instantiate Core Services
  const queue = JobQueue.getInstance();
  const storage = ObjectStorageEngine.getInstance();
  const auth = AuthService.getInstance();
  const worker = new VideoProcessingWorker();
  worker.startWorker();

  // Rate Limiting & Security Middleware
  app.use('/api', (req, res, next) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const rateCheck = checkRateLimit(String(clientIp), 60, 60);

    res.setHeader('X-RateLimit-Limit', '60');
    res.setHeader('X-RateLimit-Remaining', rateCheck.remaining.toString());
    res.setHeader('X-RateLimit-Reset', rateCheck.resetSeconds.toString());

    if (!rateCheck.allowed) {
      return res.status(429).json({
        error: 'Too Many Requests: Rate limit exceeded. Please wait a moment before sending more requests.',
      });
    }

    next();
  });

  // Health Check
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'ClipForge AI Enterprise Engine',
      ffmpeg: 'available',
      queue: 'active',
      storage: 'ready',
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
    });
  });

  // Authentication Endpoints
  app.post('/api/auth/register', (req, res) => {
    const { name, email } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }
    const result = auth.register(name, email);
    res.json(result);
  });

  app.post('/api/auth/login', (req, res) => {
    const { email } = req.body;
    const result = auth.login(email || 'creator@clipforge.ai');
    if (!result) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    res.json(result);
  });

  app.post('/api/auth/google', (req, res) => {
    const { name, email } = req.body;
    const result = auth.googleLogin(name, email);
    res.json(result);
  });

  app.get('/api/auth/me', (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader ? authHeader.replace(/^Bearer\s+/, '') : '';
    const user = auth.verifySession(token);
    if (!user) {
      return res.json({ user: auth.login('creator@clipforge.ai')?.user });
    }
    res.json({ user });
  });

  // Create Video Processing Pipeline Job (with SSRF protection & credit deduction)
  app.post('/api/jobs', async (req, res) => {
    try {
      const { videoUrl, videoInfo, contentGoal, hookType, preferredDuration, userId = 'usr_default' } = req.body;

      if (!videoUrl && !videoInfo?.url) {
        return res.status(400).json({ error: 'Valid YouTube URL is required' });
      }

      const targetUrl = videoUrl || videoInfo.url;
      const validation = validateVideoUrl(targetUrl);
      if (!validation.isValid) {
        return res.status(400).json({ error: validation.error || 'Invalid or forbidden URL' });
      }

      // Check and deduct credits: 1 processing minute = 1 credit, AI analysis = 5 credits
      const estMinutes = Math.ceil((videoInfo?.durationSeconds || 600) / 60);
      const creditCost = 5 + estMinutes;
      const creditCheck = auth.deductCredits(userId, creditCost, estMinutes);
      if (!creditCheck.success) {
        return res.status(402).json({ error: creditCheck.error });
      }

      // Create queue job
      const job = queue.createJob({
        type: 'ANALYZE_VIDEO',
        userId,
        videoUrl: validation.sanitizedUrl,
        videoInfo,
      });

      // Immediate response with Job ID for async polling
      res.status(202).json({
        jobId: job.id,
        status: job.status,
        stage: job.currentStage,
        message: 'Processing job accepted into queue',
      });
    } catch (err: any) {
      console.error('Job creation error:', err);
      res.status(500).json({ error: err?.message || 'Failed to submit processing job' });
    }
  });

  // Get All Queue Jobs
  app.get('/api/jobs', (_req, res) => {
    res.json({ jobs: queue.getAllJobs() });
  });

  // Get Single Job Status & Logs
  app.get('/api/jobs/:id', (req, res) => {
    const job = queue.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    res.json({ job });
  });

  // Cancel Job
  app.post('/api/jobs/:id/cancel', (req, res) => {
    const success = queue.cancelJob(req.params.id);
    if (!success) {
      return res.status(400).json({ error: 'Cannot cancel job (not found or already completed)' });
    }
    res.json({ success: true, message: 'Job cancelled' });
  });

  // Submit Server-Side FFmpeg Render Job
  app.post('/api/jobs/render', (req, res) => {
    try {
      const { clip, resolution = '1080p', aspectRatio = '9:16', userId = 'usr_default' } = req.body;
      if (!clip) {
        return res.status(400).json({ error: 'Clip details required for render job' });
      }

      // Deduct 2 credits per rendered minute
      const renderCredits = Math.max(2, Math.ceil((clip.duration || 30) / 30));
      const creditCheck = auth.deductCredits(userId, renderCredits, 0);
      if (!creditCheck.success) {
        return res.status(402).json({ error: creditCheck.error });
      }

      const job = queue.createJob({
        type: 'RENDER_CLIP',
        userId,
        clipId: clip.id,
        targetResolution: resolution,
        targetAspectRatio: aspectRatio,
      });

      // Pass clip directly to worker execution in background
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
      res.status(500).json({ error: err.message });
    }
  });

  // Direct Synchronous AI Clip Analysis (with 7-factor weighted scoring)
  app.post('/api/analyze-clips', async (req, res) => {
    try {
      const { videoInfo, contentGoal, hookType, preferredDuration, language = 'auto' } = req.body;

      if (!videoInfo?.url) {
        return res.status(400).json({ error: 'Video info is required' });
      }

      const validation = validateVideoUrl(videoInfo.url);
      if (!validation.isValid) {
        return res.status(400).json({ error: validation.error });
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
      console.error('Synchronous clip analysis error:', err);
      res.status(500).json({ error: err.message || 'Analysis failed' });
    }
  });

  // Secure Object Storage Signed Download
  app.get('/api/storage/download', (req, res) => {
    const { path: relPath, expires, token } = req.query;

    if (!relPath || !expires || !token) {
      return res.status(400).json({ error: 'Missing signed URL verification parameters' });
    }

    const isValid = storage.verifySignedUrl(
      String(relPath),
      String(expires),
      String(token)
    );

    if (!isValid) {
      return res.status(403).json({ error: 'Signature invalid or URL expired' });
    }

    const absPath = storage.getFilePath(String(relPath));
    if (!fs.existsSync(absPath)) {
      return res.status(404).json({ error: 'File not found or expired from storage' });
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ClipForge AI Enterprise Engine running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal Server Boot Error:', err);
  process.exit(1);
});
