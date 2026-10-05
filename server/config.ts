import { z } from 'zod';

const bool = (fallback: 'true' | 'false') => z.enum(['true', 'false']).default(fallback).transform((value) => value === 'true');
const optionalString = z.preprocess((value) => (value === '' ? undefined : value), z.string().min(1).optional());
const optionalUrl = z.preprocess((value) => (value === '' ? undefined : value), z.string().url().optional());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  APP_URL: z.string().url().default('http://localhost:8080'),
  DATABASE_URL: optionalString,
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  SERVE_FRONTEND: bool('true'),
  FRONTEND_DIST: z.string().default('./dist'),
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(1),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(24 * 14),
  ALLOW_DEV_AUTH: bool('false'),
  ALLOW_REGISTRATION: bool('true'),
  ADMIN_EMAILS: z.string().default(''),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_DIR: z.string().min(1).default('./.runtime/storage'),
  TEMP_DIR: z.string().min(1).default('./.runtime/tmp'),
  STORAGE_ENDPOINT: optionalUrl,
  STORAGE_BUCKET: optionalString,
  STORAGE_ACCESS_KEY: optionalString,
  STORAGE_SECRET_KEY: optionalString,
  STORAGE_REGION: z.string().default('auto'),
  MEDIA_URL_TTL_SECONDS: z.coerce.number().int().positive().default(6 * 3600),
  TEMP_RETENTION_HOURS: z.coerce.number().positive().default(24),
  SOURCE_RETENTION_DAYS: z.coerce.number().positive().default(30),
  EXPORT_RETENTION_DAYS: z.coerce.number().positive().default(90),
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  WHISPER_BIN: z.string().default('whisper'),
  WHISPER_MODEL: z.string().default('small'),
  WHISPER_LANGUAGE: optionalString,
  WHISPER_THREADS: z.coerce.number().int().positive().default(4),
  FFMPEG_BIN: z.string().default('ffmpeg'),
  FFPROBE_BIN: z.string().default('ffprobe'),
  FFMPEG_THREADS: z.coerce.number().int().min(0).default(0),
  YTDLP_BIN: z.string().default('yt-dlp'),
  YTDLP_COOKIES_FILE: optionalString,
  YTDLP_MAX_HEIGHT: z.coerce.number().int().positive().default(1080),
  PYTHON_BIN: z.string().default('python3'),
  FACE_DETECTION: bool('true'),
  CAPTION_FONT: z.string().default('DejaVu Sans'),
  WATERMARK_TEXT: z.string().default('ClipForge AI'),
  MAX_VIDEO_DURATION_SECONDS: z.coerce.number().int().positive().default(14_400),
  JOB_CONCURRENCY: z.coerce.number().int().positive().max(8).default(1),
  METRICS_TOKEN: optionalString,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  const config = result.data;

  if (config.STORAGE_DRIVER === 's3' && (!config.STORAGE_ENDPOINT || !config.STORAGE_BUCKET || !config.STORAGE_ACCESS_KEY || !config.STORAGE_SECRET_KEY)) {
    throw new Error('STORAGE_DRIVER=s3 requires STORAGE_ENDPOINT, STORAGE_BUCKET, STORAGE_ACCESS_KEY and STORAGE_SECRET_KEY');
  }

  if (config.NODE_ENV === 'production') {
    if (!config.DATABASE_URL) throw new Error('DATABASE_URL is required in production');
    if (config.ALLOW_DEV_AUTH) throw new Error('ALLOW_DEV_AUTH must be false in production');
    if (/change|example|development/i.test(config.AUTH_SECRET)) throw new Error('AUTH_SECRET must be a random production secret');
  }

  return config;
}

export function adminEmails(config: AppConfig): Set<string> {
  return new Set(config.ADMIN_EMAILS.split(',').map((email) => email.trim().toLowerCase()).filter(Boolean));
}
