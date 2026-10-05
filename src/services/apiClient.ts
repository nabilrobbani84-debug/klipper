import {
  AspectRatio,
  AudioConfig,
  CaptionConfig,
  ClipCandidate,
  Project,
  ReframingConfig,
  TranscriptSentence,
  UserAccount,
  YouTubeVideoInfo,
} from '../types';
import { DEFAULT_AUDIO, DEFAULT_CAPTIONS, DEFAULT_REFRAMING } from '../data/sampleVideos';

// ----------------------------------------------------------------------------- backend response shapes

export interface BackendJob {
  id: string;
  userId: string;
  projectId: string;
  kind: 'analysis' | 'render';
  state: string;
  progress: number;
  message: string;
  errorCode: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface BackendEditor {
  aspectRatio?: AspectRatio;
  captions?: Partial<CaptionConfig> & { enabled?: boolean };
  reframing?: Partial<ReframingConfig>;
  audio?: Partial<AudioConfig> & { volume?: number };
}

interface BackendClip {
  id: string;
  start: number;
  end: number;
  duration: number;
  score: number;
  title: string;
  hook: string;
  reason: string;
  transcript: string;
  editor?: BackendEditor;
}

interface BackendTranscript {
  language: string;
  segments: Array<{ id: string; text: string; start: number; end: number; speaker?: string; words?: Array<{ word: string; start: number; end: number }> }>;
}

export interface BackendProject {
  id: string;
  name: string;
  sourceUrl: string;
  sourceVideoId: string;
  status: 'PROCESSING' | 'READY' | 'FAILED' | 'ARCHIVED';
  metadata: {
    sourceUrl: string; sourceId: string; title: string; channel: string; durationSeconds: number;
    thumbnailUrl: string | null; description: string | null; width: number | null; height: number | null;
  } | null;
  transcript: BackendTranscript | null;
  clips: BackendClip[];
  sourceMediaUrl: string | null;
  latestJobId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BackendExport {
  id: string;
  projectId: string;
  clipId: string;
  clipTitle: string;
  projectName: string;
  thumbnailUrl: string | null;
  contentType: string;
  sizeBytes: number;
  settings: Record<string, unknown>;
  previewUrl: string;
  downloadUrl: string;
  createdAt: string;
}

export interface PlanEntitlements {
  code: 'FREE' | 'CREATOR' | 'PRO';
  monthlyCredits: number;
  maxVideoDurationSeconds: number;
  maxOutputResolution: string;
  maxClipsPerJob: number;
  storageLimitBytes: number;
  concurrentJobs: number;
  watermark: boolean;
  priority: number;
}

export interface UsageSummary {
  plan: PlanEntitlements;
  creditsUsed: number;
  creditsRemaining: number;
  storageBytes: number;
  activeJobs: number;
}

export interface SessionUser {
  id: string;
  email: string | null;
  role: 'user' | 'admin';
  createdAt?: string | null;
  usage?: UsageSummary;
}

export interface AuthResult {
  token: string;
  expiresAt: string;
  user: { id: string; email: string; role: 'user' | 'admin' };
}

export interface PublicConfig {
  registrationOpen: boolean;
  plans: PlanEntitlements[];
  billingEnabled: boolean;
  googleAuth: boolean;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: { code: string; message: string } | null;
  requestId: string;
}

// ----------------------------------------------------------------------------- transport

const SESSION_KEY = 'clipforge.session';
// Empty base = same-origin (production: API serves the SPA; dev: Vite proxies /api and /media).
const apiBase = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(message: string, public readonly code: string, public readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export function getSessionToken(): string | null {
  return typeof window === 'undefined' ? null : window.localStorage.getItem(SESSION_KEY);
}

export function setSessionToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(SESSION_KEY, token);
  else window.localStorage.removeItem(SESSION_KEY);
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const token = getSessionToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const devUserId = import.meta.env.VITE_DEV_USER_ID as string | undefined;
  const devRole = import.meta.env.VITE_DEV_ROLE as string | undefined;
  if (import.meta.env.DEV && devUserId && !token) {
    headers['x-dev-user-id'] = devUserId;
    if (devRole) headers['x-dev-role'] = devRole;
  }
  return headers;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      ...init,
      headers: authHeaders({ 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) }),
    });
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.', 'NETWORK_ERROR', 0);
  }
  let body: ApiEnvelope<T> | null = null;
  try {
    body = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiError('The server returned an unexpected response.', 'BAD_RESPONSE', response.status);
  }
  if (!response.ok || !body.success) {
    if (response.status === 401 && getSessionToken()) setSessionToken(null);
    throw new ApiError(body.error?.message ?? 'The request failed.', body.error?.code ?? 'UNKNOWN', response.status);
  }
  return body.data as T;
}

// ----------------------------------------------------------------------------- auth

export async function fetchPublicConfig(): Promise<PublicConfig> {
  return request('/api/v1/config');
}

export async function register(email: string, password: string): Promise<AuthResult> {
  const result = await request<AuthResult>('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) });
  setSessionToken(result.token);
  return result;
}

export async function login(email: string, password: string): Promise<AuthResult> {
  const result = await request<AuthResult>('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  setSessionToken(result.token);
  return result;
}

export async function loginWithGoogle(idToken: string): Promise<AuthResult> {
  const result = await request<AuthResult>('/api/v1/auth/google', { method: 'POST', body: JSON.stringify({ idToken }) });
  setSessionToken(result.token);
  return result;
}

export async function logout(): Promise<void> {
  try {
    await request('/api/v1/auth/logout', { method: 'POST' });
  } finally {
    setSessionToken(null);
  }
}

export async function fetchCurrentUser(): Promise<SessionUser> {
  return request('/api/v1/auth/me');
}

export async function fetchUsage(): Promise<UsageSummary> {
  return request('/api/v1/account/usage');
}

export async function deleteAccount(password?: string): Promise<void> {
  await request('/api/v1/account', { method: 'DELETE', body: JSON.stringify({ confirm: 'DELETE', password }) });
  setSessionToken(null);
}

// ----------------------------------------------------------------------------- projects & jobs

export async function createAnalysisJob(input: {
  youtubeUrl: string;
  contentGoal?: string;
  hookType?: string;
  preferredDuration: number;
  aspectRatio: AspectRatio;
  requestedClipCount: number;
}): Promise<{ projectId: string; jobId: string; status: string }> {
  return request('/api/v1/projects', { method: 'POST', body: JSON.stringify({ ...input, rightsConfirmed: true }) });
}

export async function listBackendProjects(): Promise<BackendProject[]> {
  return request('/api/v1/projects');
}

export async function getBackendProject(projectId: string): Promise<BackendProject> {
  return request(`/api/v1/projects/${encodeURIComponent(projectId)}`);
}

export async function renameBackendProject(projectId: string, name: string): Promise<void> {
  await request(`/api/v1/projects/${encodeURIComponent(projectId)}`, { method: 'PATCH', body: JSON.stringify({ name }) });
}

export async function deleteBackendProject(projectId: string): Promise<void> {
  await request(`/api/v1/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
}

export async function duplicateBackendProject(projectId: string): Promise<BackendProject> {
  return request(`/api/v1/projects/${encodeURIComponent(projectId)}/duplicate`, { method: 'POST' });
}

export async function patchClip(projectId: string, clipId: string, patch: {
  start?: number; end?: number; title?: string; editor?: BackendEditor;
}): Promise<BackendClip> {
  return request(`/api/v1/projects/${encodeURIComponent(projectId)}/clips/${encodeURIComponent(clipId)}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export async function requestExport(projectId: string, clipId: string, options: {
  resolution: string; fps: number; format: string; codec: string; quality: string; aspectRatio?: AspectRatio;
}): Promise<{ jobId: string; status: string }> {
  return request(`/api/v1/projects/${encodeURIComponent(projectId)}/clips/${encodeURIComponent(clipId)}/exports`, { method: 'POST', body: JSON.stringify(options) });
}

export async function listExports(): Promise<BackendExport[]> {
  return request('/api/v1/exports');
}

export async function getExportForJob(jobId: string): Promise<BackendExport> {
  return request(`/api/v1/jobs/${encodeURIComponent(jobId)}/export`);
}

export async function deleteExport(exportId: string): Promise<void> {
  await request(`/api/v1/exports/${encodeURIComponent(exportId)}`, { method: 'DELETE' });
}

export async function listJobs(): Promise<BackendJob[]> {
  return request('/api/v1/jobs');
}

export async function getJob(jobId: string): Promise<BackendJob> {
  return request(`/api/v1/jobs/${encodeURIComponent(jobId)}`);
}

export async function cancelBackendJob(jobId: string): Promise<void> {
  await request(`/api/v1/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' });
}

export async function retryBackendJob(jobId: string): Promise<void> {
  await request(`/api/v1/jobs/${encodeURIComponent(jobId)}/retry`, { method: 'POST' });
}

const TERMINAL = ['COMPLETED', 'FAILED', 'CANCELLED'];

/**
 * Streams job progress via SSE. Falls back to polling when the stream drops so the UI never
 * silently stalls on flaky connections. Resolves with the terminal job state.
 */
export async function watchBackendJob(jobId: string, onUpdate: (job: BackendJob) => void, signal?: AbortSignal): Promise<BackendJob> {
  try {
    const response = await fetch(`${apiBase}/api/v1/jobs/${encodeURIComponent(jobId)}/events`, { headers: authHeaders(), signal });
    if (response.ok && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let last: BackendJob | null = null;
      for (;;) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const event of events) {
          const dataLine = event.split('\n').find((line) => line.startsWith('data:'));
          if (!dataLine) continue;
          const job = JSON.parse(dataLine.slice(5).trim()) as BackendJob;
          last = job;
          onUpdate(job);
          if (TERMINAL.includes(job.state)) {
            await reader.cancel().catch(() => undefined);
            return job;
          }
        }
        if (done) break;
      }
      if (last && TERMINAL.includes(last.state)) return last;
    }
  } catch (error) {
    if (signal?.aborted) throw error;
  }
  return pollBackendJob(jobId, onUpdate, signal);
}

async function pollBackendJob(jobId: string, onUpdate: (job: BackendJob) => void, signal?: AbortSignal): Promise<BackendJob> {
  for (;;) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const job = await getJob(jobId);
    onUpdate(job);
    if (TERMINAL.includes(job.state)) return job;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

// ----------------------------------------------------------------------------- admin

export interface AdminOverview {
  users: number; active_users_30d: number; projects: number; active_jobs: number;
  failed_jobs_7d: number; completed_jobs_7d: number; export_bytes: number; ai_calls_month: number;
  avg_render_seconds: number; queue: Record<string, number> | null; workersOnline: number | null;
}

export interface AdminUser {
  id: string; email: string; role: 'user' | 'admin'; plan: string; suspended: boolean;
  createdAt: string; lastLoginAt: string | null; projects: number; creditsUsed: number;
}

export const admin = {
  overview: () => request<AdminOverview>('/api/v1/admin/overview'),
  jobs: (state?: string) => request<Array<BackendJob & { userEmail: string | null; projectName: string | null }>>(`/api/v1/admin/jobs${state ? `?state=${encodeURIComponent(state)}` : ''}`),
  users: (search?: string) => request<AdminUser[]>(`/api/v1/admin/users${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  retryJob: (jobId: string) => request(`/api/v1/admin/jobs/${encodeURIComponent(jobId)}/retry`, { method: 'POST' }),
  cancelJob: (jobId: string) => request(`/api/v1/admin/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' }),
  updateUser: (userId: string, patch: { plan?: string; suspended?: boolean; role?: 'user' | 'admin' }) =>
    request(`/api/v1/admin/users/${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  resetUsage: (userId: string) => request(`/api/v1/admin/users/${encodeURIComponent(userId)}/reset-usage`, { method: 'POST' }),
};

// ----------------------------------------------------------------------------- mappers (backend -> UI types)

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}

function mapTranscript(project: BackendProject, clip: BackendClip): TranscriptSentence[] {
  return (project.transcript?.segments ?? [])
    .filter((segment) => segment.end > clip.start && segment.start < clip.end)
    .map((segment) => ({
      id: segment.id,
      text: segment.text,
      start: segment.start,
      end: segment.end,
      speaker: segment.speaker,
      words: segment.words?.map((word) => ({ word: word.word, start: word.start, end: word.end })),
    }));
}

function mapClip(project: BackendProject, clip: BackendClip, previewUrl: string): ClipCandidate {
  const editor = clip.editor ?? {};
  const ec = editor.captions ?? {};
  const captions: CaptionConfig = {
    ...DEFAULT_CAPTIONS,
    preset: (ec.preset as CaptionConfig['preset']) ?? DEFAULT_CAPTIONS.preset,
    fontFamily: ec.fontFamily ?? DEFAULT_CAPTIONS.fontFamily,
    fontSize: ec.fontSize ?? DEFAULT_CAPTIONS.fontSize,
    textColor: ec.textColor ?? DEFAULT_CAPTIONS.textColor,
    highlightColor: ec.highlightColor ?? DEFAULT_CAPTIONS.highlightColor,
    strokeColor: ec.strokeColor ?? DEFAULT_CAPTIONS.strokeColor,
    strokeWidth: ec.strokeWidth ?? DEFAULT_CAPTIONS.strokeWidth,
    backgroundColor: ec.backgroundColor ?? DEFAULT_CAPTIONS.backgroundColor,
    hasBackground: ec.hasBackground ?? DEFAULT_CAPTIONS.hasBackground,
    positionY: ec.positionY ?? DEFAULT_CAPTIONS.positionY,
    uppercase: ec.uppercase ?? DEFAULT_CAPTIONS.uppercase,
    karaokeEffect: ec.karaokeEffect ?? DEFAULT_CAPTIONS.karaokeEffect,
    maxWordsPerLine: ec.maxWordsPerLine ?? DEFAULT_CAPTIONS.maxWordsPerLine,
  };
  const reframing: ReframingConfig = {
    mode: editor.reframing?.mode ?? DEFAULT_REFRAMING.mode,
    panX: editor.reframing?.panX ?? DEFAULT_REFRAMING.panX,
    panY: editor.reframing?.panY ?? DEFAULT_REFRAMING.panY,
    zoom: editor.reframing?.zoom ?? DEFAULT_REFRAMING.zoom,
    smoothTracking: editor.reframing?.smoothTracking ?? DEFAULT_REFRAMING.smoothTracking,
  };
  const audio: AudioConfig = {
    ...DEFAULT_AUDIO,
    noiseReduction: editor.audio?.noiseReduction ?? DEFAULT_AUDIO.noiseReduction,
    voiceEnhance: editor.audio?.voiceEnhance ?? DEFAULT_AUDIO.voiceEnhance,
    compressor: editor.audio?.compressor ?? DEFAULT_AUDIO.compressor,
    loudnessNorm: editor.audio?.loudnessNorm ?? DEFAULT_AUDIO.loudnessNorm,
  };
  return {
    id: clip.id,
    title: clip.title,
    score: clip.score,
    startTime: clip.start,
    endTime: clip.end,
    duration: clip.duration,
    hook: clip.hook,
    topic: project.metadata?.title ?? project.name,
    emotion: 'Editorial relevance',
    language: (project.transcript?.language === 'id' ? 'id' : 'en'),
    estimatedEngagement: 'AI relevance score',
    viralityReason: clip.reason,
    clipStyle: 'viral-short',
    aspectRatio: editor.aspectRatio ?? '9:16',
    editingPreset: 'dynamic-mrbeast',
    thumbnailUrl: project.metadata?.thumbnailUrl ?? '',
    videoUrl: previewUrl,
    captions,
    reframing,
    audio,
    transcript: mapTranscript(project, clip),
    bRolls: [],
    social: {
      youtubeShorts: { title: `${clip.title}`.slice(0, 90), description: clip.reason, hashtags: ['#shorts'] },
      tikTok: { caption: clip.hook, hashtags: ['#fyp'] },
      reels: { caption: clip.hook, hashtags: ['#reels'] },
      facebookReels: { caption: clip.hook },
    },
  };
}

export function mapBackendProject(project: BackendProject): Project {
  const metadata = project.metadata;
  const previewUrl = project.sourceMediaUrl ?? '';
  const videoInfo: YouTubeVideoInfo = {
    id: project.sourceVideoId,
    url: project.sourceUrl,
    title: metadata?.title ?? project.name,
    channel: metadata?.channel ?? 'YouTube creator',
    durationFormatted: formatDuration(metadata?.durationSeconds ?? 0),
    durationSeconds: metadata?.durationSeconds ?? 0,
    viewsFormatted: '—',
    uploadDate: '—',
    resolution: metadata?.width && metadata?.height ? `${metadata.width}×${metadata.height}` : 'Source resolution',
    thumbnailUrl: metadata?.thumbnailUrl ?? '',
    videoUrl: previewUrl,
    description: metadata?.description ?? '',
  };
  const clips = project.clips.map((clip) => mapClip(project, clip, previewUrl));
  return {
    id: project.id,
    name: metadata?.title ?? project.name,
    videoInfo,
    clips,
    createdAt: project.createdAt,
    lastEdited: project.updatedAt,
    status: project.status === 'READY' ? 'ready' : project.status === 'FAILED' ? 'exported' : 'analyzing',
    contentGoal: 'retention',
    hookType: 'curiosity',
    preferredDuration: clips[0]?.duration ?? 45,
  };
}

export function mapSessionToAccount(user: SessionUser): UserAccount {
  const usage = user.usage;
  const plan = usage?.plan;
  const planName = (plan?.code ?? 'FREE').toLowerCase() as UserAccount['plan'];
  const minutesLimit = plan ? Math.round(plan.maxVideoDurationSeconds / 60) : 30;
  return {
    name: user.email ? user.email.split('@')[0] : 'Creator',
    email: user.email ?? 'creator@clipforge.ai',
    avatarUrl: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(user.email ?? 'Creator')}`,
    plan: planName === 'creator' || planName === 'pro' ? planName : 'free',
    credits: usage?.creditsRemaining ?? 0,
    minutesUsed: usage?.creditsUsed ?? 0,
    minutesLimit: plan?.monthlyCredits ?? minutesLimit,
    clipsGenerated: 0,
    storageMbUsed: usage ? Math.round(usage.storageBytes / 1_000_000) : 0,
    storageMbLimit: plan ? Math.round(plan.storageLimitBytes / 1_000_000) : 2000,
    role: user.role,
  };
}

/** Maps a clip's editor state to the backend PATCH payload (percent pan, 0-100 audio volume). */
export function clipToEditorPatch(clip: ClipCandidate): BackendEditor {
  return {
    aspectRatio: clip.aspectRatio,
    captions: {
      enabled: true,
      preset: clip.captions.preset,
      fontFamily: clip.captions.fontFamily,
      fontSize: clip.captions.fontSize,
      textColor: clip.captions.textColor,
      highlightColor: clip.captions.highlightColor,
      strokeColor: clip.captions.strokeColor,
      strokeWidth: clip.captions.strokeWidth,
      backgroundColor: clip.captions.backgroundColor,
      hasBackground: clip.captions.hasBackground,
      positionY: clip.captions.positionY,
      uppercase: clip.captions.uppercase,
      karaokeEffect: clip.captions.karaokeEffect,
      maxWordsPerLine: clip.captions.maxWordsPerLine,
    },
    reframing: {
      mode: clip.reframing.mode,
      panX: clip.reframing.panX,
      panY: clip.reframing.panY,
      zoom: clip.reframing.zoom,
    },
    audio: {
      noiseReduction: clip.audio.noiseReduction,
      voiceEnhance: clip.audio.voiceEnhance,
      compressor: clip.audio.compressor,
      loudnessNorm: clip.audio.loudnessNorm,
      volume: 100,
    },
  };
}
