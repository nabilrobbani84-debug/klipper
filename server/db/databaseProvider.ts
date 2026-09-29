import { QueueJob } from '../../src/types';

export interface UserEntity {
  id: string;
  email: string;
  name: string;
  passwordHash?: string;
  avatarUrl?: string;
  role: 'USER' | 'ADMIN';
  plan: 'free' | 'creator' | 'pro' | 'business';
  createdAt: string;
  updatedAt: string;
}

export interface ProjectEntity {
  id: string;
  userId: string;
  sourceUrl: string;
  sourceVideoId: string;
  title: string;
  thumbnailUrl?: string;
  durationSeconds: number;
  status: 'analyzing' | 'ready' | 'exported';
  contentGoal: string;
  hookType: string;
  preferredDuration: number;
  metadata?: any;
  createdAt: string;
  updatedAt: string;
}

export interface ClipEntity {
  id: string;
  projectId: string;
  title: string;
  startTime: number;
  endTime: number;
  duration: number;
  score: number;
  scoringBreakdown?: any;
  category: string;
  hook: string;
  topic?: string;
  emotion?: string;
  viralityReason?: string;
  transcript?: any;
  captionsConfig?: any;
  reframingConfig?: any;
  smartReframeConfig?: any;
  audioConfig?: any;
  socialMetadata?: any;
  status: string;
  createdAt: string;
}

export interface RenderJobEntity {
  id: string;
  projectId?: string;
  clipId?: string;
  userId: string;
  type: string;
  targetResolution: string;
  targetAspectRatio: string;
  status: string;
  currentStage: string;
  progress: number;
  attempts: number;
  maxAttempts: number;
  error?: string;
  logs?: any;
  resultData?: any;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}

export interface ExportEntity {
  id: string;
  projectId?: string;
  clipId?: string;
  userId: string;
  clipTitle: string;
  storageKey: string;
  format: string;
  resolution: string;
  fps: number;
  fileSizeBytes: number;
  signedUrl: string;
  expiresAt: string;
  createdAt: string;
}

export interface UsageEntity {
  id: string;
  userId: string;
  processingSeconds: number;
  renderingSeconds: number;
  aiTokens: number;
  storageBytes: number;
  creditsRemaining: number;
  period: string;
  updatedAt: string;
}

export interface SubscriptionEntity {
  id: string;
  userId: string;
  plan: 'free' | 'creator' | 'pro' | 'business';
  status: 'active' | 'past_due' | 'canceled';
  currentPeriodStart: string;
  currentPeriodEnd: string;
  updatedAt: string;
}

export interface UserSettingsEntity {
  id: string;
  userId: string;
  defaultLanguage: 'auto' | 'en' | 'id';
  defaultAspectRatio: '9:16' | '16:9' | '1:1' | '4:5';
  defaultPreset: string;
  defaultResolution: '720p' | '1080p' | '1440p' | '4K';
  autoCaptions: boolean;
  autoReframing: boolean;
  watermarkEnabled: boolean;
  exportFormat: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Universal Database Provider Abstraction
 * Supports PostgreSQL (+ Cloudflare Hyperdrive), Cloudflare D1, or Local Persistent Store
 */
export interface DatabaseProvider {
  name: 'postgresql' | 'cloudflare-d1' | 'in-memory-persistent';

  // Lifecycle
  connect(): Promise<void> | void;
  disconnect(): Promise<void> | void;
  ping(): Promise<boolean> | boolean;

  // Users
  getUser(id: string): Promise<UserEntity | undefined> | UserEntity | undefined;
  getUserByEmail(email: string): Promise<UserEntity | undefined> | UserEntity | undefined;
  saveUser(user: UserEntity): Promise<UserEntity> | UserEntity;

  // Projects (with strict user authorization)
  getProject(id: string, userId?: string): Promise<ProjectEntity | undefined> | ProjectEntity | undefined;
  listProjects(userId: string): Promise<ProjectEntity[]> | ProjectEntity[];
  saveProject(project: ProjectEntity): Promise<ProjectEntity> | ProjectEntity;
  deleteProject(id: string, userId: string): Promise<boolean> | boolean;

  // Clips
  getClipsByProjectId(projectId: string): Promise<ClipEntity[]> | ClipEntity[];
  getClipById(id: string): Promise<ClipEntity | undefined> | ClipEntity | undefined;
  saveClip(clip: ClipEntity): Promise<ClipEntity> | ClipEntity;
  deleteClip(id: string): Promise<boolean> | boolean;

  // Jobs
  getJob(id: string, userId?: string): Promise<QueueJob | undefined> | QueueJob | undefined;
  listJobs(userId?: string): Promise<QueueJob[]> | QueueJob[];
  saveJob(job: QueueJob): Promise<QueueJob> | QueueJob;
  updateJob(id: string, updates: Partial<QueueJob>): Promise<QueueJob | undefined> | QueueJob | undefined;

  // Exports
  getExport(id: string, userId?: string): Promise<ExportEntity | undefined> | ExportEntity | undefined;
  listExports(userId: string): Promise<ExportEntity[]> | ExportEntity[];
  saveExport(exportItem: ExportEntity): Promise<ExportEntity> | ExportEntity;
  deleteExport(id: string, userId: string): Promise<boolean> | boolean;

  // Usage & Atomic Credit Metering
  getUsage(userId: string): Promise<UsageEntity> | UsageEntity;
  updateUsage(userId: string, delta: Partial<UsageEntity>): Promise<UsageEntity> | UsageEntity;
  deductCreditsAtomic(
    userId: string,
    credits: number,
    processingSeconds: number
  ): Promise<{ success: boolean; remainingCredits: number; error?: string }> | { success: boolean; remainingCredits: number; error?: string };

  // Settings
  getSettings(userId: string): Promise<UserSettingsEntity> | UserSettingsEntity;
  updateSettings(userId: string, delta: Partial<UserSettingsEntity>): Promise<UserSettingsEntity> | UserSettingsEntity;
}
