import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  APP_URL: z.string().url().default('http://localhost:8080'),
  DATABASE_URL: z.string().min(1).optional(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  STORAGE_DIR: z.string().min(1).default('./.runtime/storage'),
  TEMP_DIR: z.string().min(1).default('./.runtime/tmp'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  AUTH_SECRET: z.string().min(32).default('development-only-change-me-please-32-chars'),
  ALLOW_DEV_AUTH: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  GEMINI_API_KEY: z.string().min(1).optional(),
  WHISPER_BIN: z.string().default('whisper'),
  FFMPEG_BIN: z.string().default('ffmpeg'),
  YTDLP_BIN: z.string().default('yt-dlp'),
  MAX_VIDEO_DURATION_SECONDS: z.coerce.number().int().positive().default(7200),
  JOB_CONCURRENCY: z.coerce.number().int().positive().max(8).default(2),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  if (result.data.NODE_ENV === 'production') {
    if (!result.data.DATABASE_URL) throw new Error('DATABASE_URL is required in production');
    if (result.data.ALLOW_DEV_AUTH) throw new Error('ALLOW_DEV_AUTH must be false in production');
    if (result.data.AUTH_SECRET.includes('development-only')) throw new Error('AUTH_SECRET must be changed in production');
  }

  return result.data;
}
