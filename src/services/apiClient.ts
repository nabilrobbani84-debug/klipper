import {
  AspectRatio,
  AudioConfig,
  CaptionConfig,
  ClipCandidate,
  EditingPreset,
  Project,
  ReframingConfig,
  TranscriptSentence,
  YouTubeVideoInfo,
} from '../types';
import { DEFAULT_AUDIO, DEFAULT_CAPTIONS, DEFAULT_REFRAMING } from '../data/sampleVideos';

export interface BackendJob {
  id: string;
  projectId: string;
  state: string;
  progress: number;
  message: string;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
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
  status: string;
  metadata: {
    sourceUrl: string;
    sourceId: string;
    title: string;
    channel: string;
    durationSeconds: number;
    thumbnailUrl: string | null;
    description: string | null;
    width: number | null;
    height: number | null;
  } | null;
  transcript: BackendTranscript | null;
  clips: BackendClip[];
  createdAt: string;
  updatedAt: string;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: { code: string; message: string } | null;
  requestId: string;
}

const apiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '');

export function isBackendConfigured(): boolean {
  return Boolean(apiUrl);
}

function headers(): HeadersInit {
  const result: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = typeof window !== 'undefined' ? window.localStorage.getItem('clipforge.session') : null;
  const devUserId = import.meta.env.VITE_DEV_USER_ID as string | undefined;
  if (token) result.Authorization = `Bearer ${token}`;
  if (import.meta.env.DEV && devUserId) result['x-dev-user-id'] = devUserId;
  return result;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!apiUrl) throw new Error('The ClipForge API is not configured. Set VITE_API_URL to enable live processing.');
  const response = await fetch(`${apiUrl}${path}`, { ...init, headers: { ...headers(), ...(init.headers ?? {}) } });
  const body = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || !body.success || body.data === null) {
    throw new Error(body.error?.message || 'The server could not complete the request.');
  }
  return body.data;
}

export async function createAnalysisJob(input: {
  youtubeUrl: string;
  contentGoal: string;
  hookType: string;
  preferredDuration: number;
  aspectRatio: AspectRatio;
  requestedClipCount?: number;
}): Promise<{ projectId: string; jobId: string; status: string }> {
  return request('/api/v1/projects', { method: 'POST', body: JSON.stringify(input) });
}

export async function getBackendProject(projectId: string): Promise<BackendProject> {
  return request(`/api/v1/projects/${encodeURIComponent(projectId)}`);
}

export async function cancelBackendJob(jobId: string): Promise<void> {
  await request(`/api/v1/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' });
}

export async function watchBackendJob(
  jobId: string,
  onUpdate: (job: BackendJob) => void,
): Promise<BackendJob> {
  if (!apiUrl) throw new Error('The ClipForge API is not configured.');
  const response = await fetch(`${apiUrl}/api/v1/jobs/${encodeURIComponent(jobId)}/events`, { headers: headers() });
  if (!response.ok || !response.body) throw new Error('Unable to subscribe to processing progress.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';
    for (const event of events) {
      const dataLine = event.split('\n').find((line) => line.startsWith('data:'));
      if (!dataLine) continue;
      const job = JSON.parse(dataLine.slice(5).trim()) as BackendJob;
      onUpdate(job);
      if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.state)) {
        await reader.cancel();
        return job;
      }
    }
    if (done) break;
  }
  throw new Error('Processing progress stream ended before the job completed.');
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
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

function mapClip(project: BackendProject, clip: BackendClip, index: number, videoUrl: string): ClipCandidate {
  const captions: CaptionConfig = { ...DEFAULT_CAPTIONS };
  const reframing: ReframingConfig = { ...DEFAULT_REFRAMING };
  const audio: AudioConfig = { ...DEFAULT_AUDIO };
  return {
    id: clip.id,
    title: clip.title,
    score: clip.score,
    startTime: clip.start,
    endTime: clip.end,
    duration: clip.duration,
    hook: clip.hook,
    topic: project.name,
    emotion: 'Editorial relevance',
    estimatedEngagement: 'Internal relevance score only',
    viralityReason: clip.reason,
    clipStyle: 'viral-short',
    aspectRatio: '9:16',
    editingPreset: 'dynamic-mrbeast' as EditingPreset,
    thumbnailUrl: project.metadata?.thumbnailUrl ?? '',
    videoUrl,
    captions,
    reframing,
    audio,
    transcript: mapTranscript(project, clip),
    bRolls: [],
    social: {
      youtubeShorts: { title: `${clip.title} #shorts`, description: clip.reason, hashtags: ['#shorts'] },
      tikTok: { caption: clip.hook, hashtags: ['#fyp'] },
      reels: { caption: clip.hook, hashtags: ['#reels'] },
      facebookReels: { caption: clip.hook },
    },
  };
}

export function mapBackendProject(project: BackendProject): Project {
  const metadata = project.metadata;
  const videoUrl = `${apiUrl ?? ''}/api/v1/projects/${encodeURIComponent(project.id)}/source`;
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
    videoUrl,
    description: metadata?.description ?? '',
  };
  const clips = project.clips.map((clip, index) => mapClip(project, clip, index, videoUrl));
  return {
    id: project.id,
    name: project.name,
    videoInfo,
    clips,
    createdAt: project.createdAt,
    lastEdited: project.updatedAt,
    status: project.status === 'READY' ? 'ready' : project.status === 'FAILED' ? 'analyzing' : 'analyzing',
    contentGoal: 'retention',
    hookType: 'curiosity',
    preferredDuration: clips[0]?.duration ?? 45,
  };
}
