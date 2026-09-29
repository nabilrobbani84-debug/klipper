import { pgTable, text, integer, timestamp, boolean, jsonb, real } from 'drizzle-orm/pg-core';

/**
 * Users Table
 */
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash'),
  avatarUrl: text('avatar_url'),
  role: text('role').notNull().default('USER'), // 'USER' | 'ADMIN'
  plan: text('plan').notNull().default('free'), // 'free' | 'creator' | 'pro' | 'business'
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Projects Table
 */
export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sourceUrl: text('source_url').notNull(),
  sourceVideoId: text('source_video_id').notNull(),
  title: text('title').notNull(),
  thumbnailUrl: text('thumbnail_url'),
  durationSeconds: integer('duration_seconds').notNull(),
  status: text('status').notNull().default('ready'), // 'analyzing' | 'ready' | 'exported'
  contentGoal: text('content_goal').notNull().default('retention'),
  hookType: text('hook_type').notNull().default('curiosity'),
  preferredDuration: integer('preferred_duration').notNull().default(45),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Clips Table
 */
export const clips = pgTable('clips', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  startTime: real('start_time').notNull(),
  endTime: real('end_time').notNull(),
  duration: real('duration').notNull(),
  score: real('score').notNull(),
  scoringBreakdown: jsonb('scoring_breakdown'),
  category: text('category').notNull().default('viral-short'),
  hook: text('hook').notNull(),
  topic: text('topic'),
  emotion: text('emotion'),
  viralityReason: text('virality_reason'),
  transcript: jsonb('transcript'),
  captionsConfig: jsonb('captions_config'),
  reframingConfig: jsonb('reframing_config'),
  smartReframeConfig: jsonb('smart_reframe_config'),
  audioConfig: jsonb('audio_config'),
  socialMetadata: jsonb('social_metadata'),
  status: text('status').notNull().default('ready'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/**
 * Render Jobs Table
 */
export const renderJobs = pgTable('render_jobs', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  clipId: text('clip_id').references(() => clips.id, { onDelete: 'set null' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull().default('RENDER_CLIP'), // 'ANALYZE_VIDEO' | 'RENDER_CLIP'
  targetResolution: text('target_resolution').notNull().default('1080p'),
  targetAspectRatio: text('target_aspect_ratio').notNull().default('9:16'),
  status: text('status').notNull().default('pending'), // 'pending' | 'processing' | 'completed' | 'failed' | 'retrying' | 'cancelled'
  currentStage: text('current_stage').notNull().default('QUEUED'),
  progress: integer('progress').notNull().default(0),
  attempts: integer('attempts').notNull().default(1),
  maxAttempts: integer('max_attempts').notNull().default(3),
  error: text('error'),
  logs: jsonb('logs'),
  resultData: jsonb('result_data'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/**
 * Exports Table
 */
export const exports = pgTable('exports', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  clipId: text('clip_id').references(() => clips.id, { onDelete: 'set null' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  clipTitle: text('clip_title').notNull(),
  storageKey: text('storage_key').notNull(),
  format: text('format').notNull().default('mp4'),
  resolution: text('resolution').notNull().default('1080p'),
  fps: integer('fps').notNull().default(60),
  fileSizeBytes: integer('file_size_bytes').notNull(),
  signedUrl: text('signed_url').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/**
 * Usage Tracking Table
 */
export const usages = pgTable('usages', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  processingSeconds: integer('processing_seconds').notNull().default(0),
  renderingSeconds: integer('rendering_seconds').notNull().default(0),
  aiTokens: integer('ai_tokens').notNull().default(0),
  storageBytes: integer('storage_bytes').notNull().default(0),
  creditsRemaining: integer('credits_remaining').notNull().default(100),
  period: text('period').notNull().default('2026-09'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Subscriptions Table
 */
export const subscriptions = pgTable('subscriptions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  plan: text('plan').notNull().default('free'), // 'free' | 'creator' | 'pro' | 'business'
  status: text('status').notNull().default('active'), // 'active' | 'past_due' | 'canceled'
  currentPeriodStart: timestamp('current_period_start').notNull().defaultNow(),
  currentPeriodEnd: timestamp('current_period_end').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
