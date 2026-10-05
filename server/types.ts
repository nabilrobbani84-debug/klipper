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

export const TERMINAL_JOB_STATES: readonly JobState[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

export type UserRole = 'user' | 'admin';

export interface AuthenticatedUser {
  id: string;
  email?: string;
  role?: UserRole;
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

export type AspectRatio = '9:16' | '16:9' | '1:1' | '4:5';
export const ASPECT_RATIOS: readonly AspectRatio[] = ['9:16', '16:9', '1:1', '4:5'];
export function isAspectRatio(value: unknown): value is AspectRatio {
  return typeof value === 'string' && (ASPECT_RATIOS as readonly string[]).includes(value);
}
export type RenderQuality = 'draft' | 'standard' | 'high' | 'ultra';
export type OutputResolution = '720p' | '1080p' | '1440p' | '4K';

/** Caption styling persisted from the editor. Mirrors the frontend CaptionConfig. */
export interface CaptionSettings {
  enabled: boolean;
  preset: string;
  fontFamily: string;
  fontSize: number;
  textColor: string;
  highlightColor: string;
  strokeColor: string;
  strokeWidth: number;
  backgroundColor: string;
  hasBackground: boolean;
  positionY: number;
  uppercase: boolean;
  karaokeEffect: boolean;
  maxWordsPerLine: number;
}

/** Reframe settings persisted from the editor. panX/panY are 0-100 percentages. */
export interface ReframingSettings {
  mode: 'center' | 'speaker' | 'face' | 'object' | 'manual';
  panX: number;
  panY: number;
  zoom: number;
}

export interface AudioSettings {
  noiseReduction: boolean;
  voiceEnhance: boolean;
  compressor: boolean;
  loudnessNorm: boolean;
  volume: number;
}

export interface ClipEditorState {
  captions: CaptionSettings;
  reframing: ReframingSettings;
  audio: AudioSettings;
  aspectRatio: AspectRatio;
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
  editor?: Partial<ClipEditorState>;
}

export interface ExportRecord {
  id: string;
  projectId: string;
  clipId: string;
  clipTitle: string;
  projectName: string;
  thumbnailUrl: string | null;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
  settings: Record<string, unknown>;
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
  latestJobId: string | null;
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
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
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
  contentGoal?: string;
  hookType?: string;
}

export interface RenderOptions {
  resolution: OutputResolution;
  fps: 24 | 30 | 60;
  format: 'mp4' | 'mov';
  codec: 'h264' | 'h265';
  aspectRatio: AspectRatio;
  quality: RenderQuality;
}

export interface RenderJobPayload extends RenderOptions {
  kind: 'render';
  jobId: string;
  projectId: string;
  userId: string;
  clipId: string;
}

export type QueuePayload = AnalysisJobPayload | RenderJobPayload;

export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: { code: string; message: string } | null;
  requestId: string;
}
