export type JobKind = 'analysis' | 'render';

export type JobState =
  | 'QUEUED'
  | 'DOWNLOADING'
  | 'EXTRACTING_AUDIO'
  | 'TRANSCRIBING'
  | 'ANALYZING'
  | 'GENERATING_CLIPS'
  | 'REFRAMING'
  | 'GENERATING_CAPTIONS'
  | 'RENDERING'
  | 'UPLOADING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface AuthenticatedUser {
  id: string;
  email?: string;
  role?: 'user' | 'admin';
}

export interface MediaMetadata {
  sourceUrl: string;
  sourceId: string;
  title: string;
  channel: string;
  durationSeconds: number;
  thumbnailUrl: string | null;
  description: string | null;
  width: number | null;
  height: number | null;
  formats: Array<{ formatId: string; ext: string; width?: number; height?: number; vcodec?: string; acodec?: string }>;
}

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface TranscriptSegment {
  id: string;
  text: string;
  start: number;
  end: number;
  speaker?: string;
  words: TranscriptWord[];
}

export interface TranscriptDocument {
  language: string;
  segments: TranscriptSegment[];
}

export interface ClipCandidate {
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

export interface ExportRecord {
  id: string;
  projectId: string;
  clipId: string;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface ProjectRecord {
  id: string;
  userId: string;
  name: string;
  sourceUrl: string;
  sourceVideoId: string;
  status: 'PROCESSING' | 'READY' | 'FAILED' | 'ARCHIVED';
  metadata: MediaMetadata | null;
  transcript: TranscriptDocument | null;
  clips: ClipCandidate[];
  createdAt: string;
  updatedAt: string;
}

export interface JobRecord {
  id: string;
  userId: string;
  projectId: string;
  kind: JobKind;
  state: JobState;
  progress: number;
  message: string;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  youtubeUrl: string;
  contentGoal?: string;
  hookType?: string;
  preferredDuration?: number;
  aspectRatio?: '9:16' | '16:9' | '1:1' | '4:5';
  requestedClipCount?: number;
}

export interface AnalysisJobPayload {
  kind: 'analysis';
  jobId: string;
  projectId: string;
  userId: string;
  sourceUrl: string;
  sourceVideoId: string;
  preferredDuration: number;
  requestedClipCount: number;
}

export interface RenderJobPayload {
  kind: 'render';
  jobId: string;
  projectId: string;
  userId: string;
  clipId: string;
  quality: 'draft' | 'standard' | 'high' | 'ultra';
  aspectRatio: '9:16' | '16:9' | '1:1' | '4:5';
}

export type QueuePayload = AnalysisJobPayload | RenderJobPayload;

export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: { code: string; message: string } | null;
  requestId: string;
}
