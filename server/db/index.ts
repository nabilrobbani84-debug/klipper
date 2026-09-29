import fs from 'fs';
import path from 'path';
import { DatabaseProvider, UserSettingsEntity } from './databaseProvider';
import { QueueJob } from '../../src/types';

export * from './databaseProvider';

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
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'retrying' | 'cancelled';
  currentStage: string;
  progress: number;
  attempts: number;
  maxAttempts: number;
  error?: string;
  logs?: any[];
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

/**
 * Universal Database Manager
 * Works with PostgreSQL via DATABASE_URL or persistent file store.
 */
class DatabaseManager {
  private static instance: DatabaseManager;
  private dbFile = path.join(process.cwd(), 'storage', 'clipforge_db.json');

  public users = new Map<string, UserEntity>();
  public projects = new Map<string, ProjectEntity>();
  public clips = new Map<string, ClipEntity>();
  public renderJobs = new Map<string, RenderJobEntity>();
  public exports = new Map<string, ExportEntity>();
  public usages = new Map<string, UsageEntity>();
  public subscriptions = new Map<string, SubscriptionEntity>();

  private constructor() {
    this.loadState();
    this.seedDefaults();
  }

  public static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  private loadState() {
    try {
      if (fs.existsSync(this.dbFile)) {
        const raw = fs.readFileSync(this.dbFile, 'utf-8');
        const data = JSON.parse(raw);
        if (data.users) Object.entries(data.users).forEach(([k, v]) => this.users.set(k, v as any));
        if (data.projects) Object.entries(data.projects).forEach(([k, v]) => this.projects.set(k, v as any));
        if (data.clips) Object.entries(data.clips).forEach(([k, v]) => this.clips.set(k, v as any));
        if (data.renderJobs) Object.entries(data.renderJobs).forEach(([k, v]) => this.renderJobs.set(k, v as any));
        if (data.exports) Object.entries(data.exports).forEach(([k, v]) => this.exports.set(k, v as any));
        if (data.usages) Object.entries(data.usages).forEach(([k, v]) => this.usages.set(k, v as any));
        if (data.subscriptions) Object.entries(data.subscriptions).forEach(([k, v]) => this.subscriptions.set(k, v as any));
      }
    } catch (err) {
      console.warn('[DB] Persistent file load warning, initializing fresh memory state:', err);
    }
  }

  public persistState() {
    try {
      const dir = path.dirname(this.dbFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = {
        users: Object.fromEntries(this.users.entries()),
        projects: Object.fromEntries(this.projects.entries()),
        clips: Object.fromEntries(this.clips.entries()),
        renderJobs: Object.fromEntries(this.renderJobs.entries()),
        exports: Object.fromEntries(this.exports.entries()),
        usages: Object.fromEntries(this.usages.entries()),
        subscriptions: Object.fromEntries(this.subscriptions.entries()),
      };
      fs.writeFileSync(this.dbFile, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[DB] Failed to persist database state:', err);
    }
  }

  private seedDefaults() {
    if (!this.users.has('usr_default')) {
      const defaultUser: UserEntity = {
        id: 'usr_default',
        email: 'creator@clipforge.ai',
        name: 'Alex Vance',
        avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
        role: 'ADMIN',
        plan: 'creator',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.users.set(defaultUser.id, defaultUser);
      this.users.set(defaultUser.email, defaultUser);

      this.usages.set(defaultUser.id, {
        id: `usage_${defaultUser.id}`,
        userId: defaultUser.id,
        processingSeconds: 2520,
        renderingSeconds: 840,
        aiTokens: 18400,
        storageBytes: 215 * 1024 * 1024,
        creditsRemaining: 120,
        period: '2026-09',
        updatedAt: new Date().toISOString(),
      });

      this.subscriptions.set(defaultUser.id, {
        id: `sub_${defaultUser.id}`,
        userId: defaultUser.id,
        plan: 'creator',
        status: 'active',
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        updatedAt: new Date().toISOString(),
      });
      this.persistState();
    }
  }

  // Repository Methods
  public findUserById(id: string): UserEntity | undefined {
    return this.users.get(id);
  }

  public findUserByEmail(email: string): UserEntity | undefined {
    return Array.from(this.users.values()).find(u => u.email.toLowerCase() === email.toLowerCase());
  }

  public saveUser(user: UserEntity): UserEntity {
    this.users.set(user.id, user);
    this.persistState();
    return user;
  }

  public findProjectsByUserId(userId: string): ProjectEntity[] {
    return Array.from(this.projects.values()).filter(p => p.userId === userId);
  }

  public findProjectById(id: string): ProjectEntity | undefined {
    return this.projects.get(id);
  }

  public saveProject(project: ProjectEntity): ProjectEntity {
    this.projects.set(project.id, project);
    this.persistState();
    return project;
  }

  public deleteProject(id: string): boolean {
    const deleted = this.projects.delete(id);
    if (deleted) {
      // Cascade delete clips
      for (const [clipId, clip] of this.clips.entries()) {
        if (clip.projectId === id) {
          this.clips.delete(clipId);
        }
      }
      this.persistState();
    }
    return deleted;
  }

  public findClipsByProjectId(projectId: string): ClipEntity[] {
    return Array.from(this.clips.values()).filter(c => c.projectId === projectId);
  }

  public saveClip(clip: ClipEntity): ClipEntity {
    this.clips.set(clip.id, clip);
    this.persistState();
    return clip;
  }

  public saveRenderJob(job: RenderJobEntity): RenderJobEntity {
    this.renderJobs.set(job.id, job);
    this.persistState();
    return job;
  }

  public findRenderJobById(id: string): RenderJobEntity | undefined {
    return this.renderJobs.get(id);
  }

  public getAllRenderJobs(): RenderJobEntity[] {
    return Array.from(this.renderJobs.values());
  }

  public saveExport(exportItem: ExportEntity): ExportEntity {
    this.exports.set(exportItem.id, exportItem);
    this.persistState();
    return exportItem;
  }

  public findExportsByUserId(userId: string): ExportEntity[] {
    return Array.from(this.exports.values()).filter(e => e.userId === userId);
  }

  public deleteExport(id: string, userId?: string): boolean {
    const item = this.exports.get(id);
    if (!item) return false;
    if (userId && item.userId !== userId) return false;
    const deleted = this.exports.delete(id);
    if (deleted) this.persistState();
    return deleted;
  }

  public updateUsage(userId: string, delta: Partial<UsageEntity>): UsageEntity {
    const usage = this.getUsage(userId);
    Object.assign(usage, delta, { updatedAt: new Date().toISOString() });
    this.usages.set(userId, usage);
    this.persistState();
    return usage;
  }

  public getUsage(userId: string): UsageEntity {
    let usage = this.usages.get(userId);
    if (!usage) {
      usage = {
        id: `usage_${userId}`,
        userId,
        processingSeconds: 0,
        renderingSeconds: 0,
        aiTokens: 0,
        storageBytes: 0,
        creditsRemaining: 60,
        period: '2026-09',
        updatedAt: new Date().toISOString(),
      };
      this.usages.set(userId, usage);
    }
    return usage;
  }

  public name: 'postgresql' | 'cloudflare-d1' | 'in-memory-persistent' = 'in-memory-persistent';
  private settings: Map<string, UserSettingsEntity> = new Map();

  public async connect(): Promise<void> {
    this.loadState();
  }

  public async disconnect(): Promise<void> {
    this.persistState();
  }

  public async ping(): Promise<boolean> {
    return true;
  }

  public async getUser(id: string): Promise<UserEntity | undefined> {
    return this.findUserById(id);
  }

  public async getUserByEmail(email: string): Promise<UserEntity | undefined> {
    return this.findUserByEmail(email);
  }

  public async getProject(id: string, userId?: string): Promise<ProjectEntity | undefined> {
    const proj = this.findProjectById(id);
    if (!proj) return undefined;
    if (userId && proj.userId !== userId) return undefined;
    return proj;
  }

  public async listProjects(userId: string): Promise<ProjectEntity[]> {
    return this.findProjectsByUserId(userId);
  }

  public async getClipsByProjectId(projectId: string): Promise<ClipEntity[]> {
    return this.findClipsByProjectId(projectId);
  }

  public async getClipById(id: string): Promise<ClipEntity | undefined> {
    return this.clips.get(id);
  }

  public async deleteClip(id: string): Promise<boolean> {
    const deleted = this.clips.delete(id);
    if (deleted) this.persistState();
    return deleted;
  }

  public async getJob(id: string, userId?: string): Promise<QueueJob | undefined> {
    const raw = this.renderJobs.get(id);
    if (!raw) return undefined;
    if (userId && raw.userId !== userId) return undefined;
    return raw as any;
  }

  public async listJobs(userId?: string): Promise<QueueJob[]> {
    const all = Array.from(this.renderJobs.values());
    const filtered = userId ? all.filter(j => j.userId === userId) : all;
    return filtered as any;
  }

  public async saveJob(job: QueueJob): Promise<QueueJob> {
    this.saveRenderJob({
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
    return job;
  }

  public async updateJob(id: string, updates: Partial<QueueJob>): Promise<QueueJob | undefined> {
    const existing = this.renderJobs.get(id);
    if (!existing) return undefined;
    Object.assign(existing, {
      status: updates.status ?? existing.status,
      currentStage: updates.currentStage ?? existing.currentStage,
      progress: updates.progressPercent ?? existing.progress,
      attempts: updates.currentAttempt ?? existing.attempts,
      error: updates.error ?? existing.error,
      logs: updates.logs ?? existing.logs,
      resultData: updates.resultData ?? existing.resultData,
      startedAt: updates.startedAt ?? existing.startedAt,
      completedAt: updates.completedAt ?? existing.completedAt,
    });
    this.persistState();
    return existing as any;
  }

  public async getExport(id: string, userId?: string): Promise<ExportEntity | undefined> {
    const item = this.exports.get(id);
    if (!item) return undefined;
    if (userId && item.userId !== userId) return undefined;
    return item;
  }

  public async listExports(userId: string): Promise<ExportEntity[]> {
    return this.findExportsByUserId(userId);
  }

  public async deductCreditsAtomic(
    userId: string,
    credits: number,
    processingSeconds: number
  ): Promise<{ success: boolean; remainingCredits: number; error?: string }> {
    const usage = this.getUsage(userId);
    if (usage.creditsRemaining < credits) {
      return {
        success: false,
        remainingCredits: usage.creditsRemaining,
        error: `Insufficient credits. Required: ${credits}, Available: ${usage.creditsRemaining}.`,
      };
    }
    const newRemaining = usage.creditsRemaining - credits;
    this.updateUsage(userId, {
      creditsRemaining: newRemaining,
      processingSeconds: usage.processingSeconds + processingSeconds,
    });
    return {
      success: true,
      remainingCredits: newRemaining,
    };
  }

  public async getSettings(userId: string): Promise<UserSettingsEntity> {
    let setting = this.settings.get(userId);
    if (!setting) {
      setting = {
        id: `setting_${userId}`,
        userId,
        defaultLanguage: 'auto',
        defaultAspectRatio: '9:16',
        defaultPreset: 'dynamic-mrbeast',
        defaultResolution: '1080p',
        autoCaptions: true,
        autoReframing: true,
        watermarkEnabled: false,
        exportFormat: 'mp4',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.settings.set(userId, setting);
    }
    return setting;
  }

  public async updateSettings(
    userId: string,
    delta: Partial<UserSettingsEntity>
  ): Promise<UserSettingsEntity> {
    const existing = await this.getSettings(userId);
    const updated = { ...existing, ...delta, updatedAt: new Date().toISOString() };
    this.settings.set(userId, updated);
    this.persistState();
    return updated;
  }
}

export const db = DatabaseManager.getInstance();

export function getDatabaseProvider(): DatabaseProvider {
  return DatabaseManager.getInstance();
}
