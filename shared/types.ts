// Types shared by the Cloudflare Worker (API + orchestration) and the media container.
// This module must stay runtime-neutral: no Node or Workers-specific imports.

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
export const ACTIVE_JOB_STATES: readonly JobState[] = [
  'QUEUED', 'DOWNLOADING', 'EXTRACTING_AUDIO', 'TRANSCRIBING', 'ANALYZING', 'GENERATING_CLIPS',
  'REFRAMING', 'GENERATING_CAPTIONS', 'RENDERING', 'UPLOADING',
];

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

export interface RenderOptions {
  resolution: OutputResolution;
  fps: 24 | 30 | 60;
  format: 'mp4' | 'mov';
  codec: 'h264' | 'h265';
  aspectRatio: AspectRatio;
  quality: RenderQuality;
}

// ----------------------------------------------------------------------------- container protocol

/** Sent by the Worker to the container to download + prepare a YouTube video. */
export interface AcquireRequest {
  jobId: string;
  sourceUrl: string;
  sourceKey: string;
  audioPrefix: string;
  maxDurationSeconds: number;
  maxHeight: number;
  audioChunkSeconds: number;
  ytdlpCookies?: string;
}

export interface AudioChunk {
  key: string;
  offset: number;
  duration: number;
}

/** Reported by the container once the source and audio chunks are stored in R2. */
export interface AcquireResult {
  metadata: MediaMetadata;
  width: number;
  height: number;
  duration: number;
  hasAudio: boolean;
  chunks: AudioChunk[];
}

/** Sent by the Worker to the container to render one clip. */
export interface RenderRequest {
  jobId: string;
  sourceKey: string;
  outputKey: string;
  start: number;
  duration: number;
  options: RenderOptions;
  reframing: ReframingSettings;
  audio: AudioSettings;
  /** Complete ASS subtitle file, or null when captions are disabled. */
  ass: string | null;
  watermarkText: string | null;
  faceDetection: boolean;
  captionFont: string;
}

export interface RenderResult {
  key: string;
  sizeBytes: number;
  width: number;
  height: number;
  contentType: string;
}

/** Progress/heartbeat report from the container. The reply tells the container whether to stop. */
export interface ProgressReport {
  state: JobState;
  progress: number;
  message: string;
}

export interface ProgressReply {
  cancelled: boolean;
}

export interface FailureReport {
  code: string;
  message: string;
}

export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: { code: string; message: string } | null;
  requestId: string;
}
