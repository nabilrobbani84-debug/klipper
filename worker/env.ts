import type { MediaContainer } from './container.js';

/** Messages on the `clipforge-jobs` queue. Each step is small so no invocation hits Worker time limits. */
export type JobMessage =
  | { type: 'analysis.acquire'; jobId: string }
  | { type: 'analysis.transcribe'; jobId: string; index: number }
  | { type: 'analysis.detect'; jobId: string }
  | { type: 'render'; jobId: string };

/** Minimal Workers AI surface we use (keeps us independent of the generated model union types). */
export interface AiBinding {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
}

export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      MEDIA_BUCKET: R2Bucket;
      JOBS: Queue<JobMessage>;
      AI?: AiBinding;
      MEDIA?: DurableObjectNamespace<MediaContainer>;
      ASSETS?: Fetcher;
      AUTH_LIMITER?: RateLimiter;
      API_LIMITER?: RateLimiter;

      AUTH_SECRET: string;
      ENVIRONMENT?: string;
      APP_URL?: string;
      ADMIN_EMAILS?: string;
      ALLOW_REGISTRATION?: string;
      SESSION_TTL_HOURS?: string;
      MEDIA_URL_TTL_SECONDS?: string;
      MAX_VIDEO_DURATION_SECONDS?: string;
      SOURCE_RETENTION_DAYS?: string;
      EXPORT_RETENTION_DAYS?: string;

      GEMINI_API_KEY?: string;
      GEMINI_MODEL?: string;
      TEXT_MODEL?: string;
      WHISPER_MODEL?: string;
      WHISPER_LANGUAGE?: string;

      FIREBASE_PROJECT_ID?: string;
      YTDLP_COOKIES?: string;
      YTDLP_MAX_HEIGHT?: string;
      AUDIO_CHUNK_SECONDS?: string;
      FACE_DETECTION?: string;
      CAPTION_FONT?: string;
      WATERMARK_TEXT?: string;
    }
  }
}

export type Env = Cloudflare.Env;

export function numberVar(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function boolVar(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
}

export function adminEmails(env: Env): Set<string> {
  return new Set((env.ADMIN_EMAILS ?? '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean));
}
