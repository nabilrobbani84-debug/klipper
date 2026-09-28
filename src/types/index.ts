export type AspectRatio = '9:16' | '16:9' | '1:1' | '4:5';

export type ClipStyle =
  | 'viral-short'
  | 'podcast'
  | 'educational'
  | 'motivational'
  | 'storytelling'
  | 'funny'
  | 'news'
  | 'interview'
  | 'business'
  | 'gaming'
  | 'reaction'
  | 'cinematic';

export type EditingPreset =
  | 'auto-viral'
  | 'podcast'
  | 'dynamic-mrbeast'
  | 'cinematic'
  | 'minimal';

export type CaptionPreset =
  | 'bold-viral'
  | 'clean-podcast'
  | 'minimal'
  | 'karaoke'
  | 'modern'
  | 'cinema';

export type ReframingMode = 'center' | 'speaker' | 'face' | 'object' | 'manual';

export type ContentGoal =
  | 'retention'
  | 'educational'
  | 'entertainment'
  | 'storytelling'
  | 'lead-gen'
  | 'personal-branding'
  | 'product-promo';

export type HookType =
  | 'question'
  | 'bold-statement'
  | 'curiosity'
  | 'controversy'
  | 'story'
  | 'unexpected-fact'
  | 'emotional';

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptSentence {
  id: string;
  text: string;
  start: number;
  end: number;
  speaker?: string;
  words?: WordTimestamp[];
}

export interface BRollItem {
  id: string;
  keyword: string;
  startSeconds: number;
  durationSeconds: number;
  title: string;
  videoUrl: string;
  previewUrl: string;
}

export interface CaptionConfig {
  preset: CaptionPreset;
  fontFamily: string;
  fontSize: number; // in pt/px
  textColor: string;
  highlightColor: string;
  strokeColor: string;
  strokeWidth: number;
  backgroundColor: string;
  hasBackground: boolean;
  positionY: number; // percentage 10 - 90
  uppercase: boolean;
  animated: boolean;
  karaokeEffect: boolean;
  maxWordsPerLine: number;
}

export interface ReframingConfig {
  mode: ReframingMode;
  panX: number; // 0 to 100%
  panY: number; // 0 to 100%
  zoom: number; // 1.0 to 2.5
  smoothTracking: boolean;
}

export interface AudioConfig {
  noiseReduction: boolean;
  voiceEnhance: boolean;
  compressor: boolean;
  loudnessNorm: boolean;
  preset: 'podcast' | 'studio' | 'interview' | 'cinematic' | 'social';
  bgMusicTrack: string | null;
  bgMusicVolume: number;
  musicDucking: boolean;
}

export interface BrandKit {
  logoUrl: string;
  showLogo: boolean;
  logoPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  logoScale: number;
  primaryColor: string;
  secondaryColor: string;
  watermarkText: string;
  showWatermark: boolean;
  introCard: boolean;
  outroCard: boolean;
}

export interface SocialMetadata {
  youtubeShorts: {
    title: string;
    description: string;
    hashtags: string[];
  };
  tikTok: {
    caption: string;
    hashtags: string[];
  };
  reels: {
    caption: string;
    hashtags: string[];
  };
  facebookReels: {
    caption: string;
  };
}

export interface ClipCandidate {
  id: string;
  title: string;
  score: number; // 0 - 100
  startTime: number; // seconds
  endTime: number; // seconds
  duration: number; // seconds
  hook: string;
  topic: string;
  emotion: string;
  estimatedEngagement: string;
  viralityReason: string;
  clipStyle: ClipStyle;
  aspectRatio: AspectRatio;
  editingPreset: EditingPreset;
  thumbnailUrl: string;
  videoUrl: string;
  captions: CaptionConfig;
  reframing: ReframingConfig;
  audio: AudioConfig;
  transcript: TranscriptSentence[];
  bRolls: BRollItem[];
  social: SocialMetadata;
}

export interface YouTubeVideoInfo {
  id: string;
  url: string;
  title: string;
  channel: string;
  channelAvatar?: string;
  durationFormatted: string;
  durationSeconds: number;
  viewsFormatted: string;
  uploadDate: string;
  resolution: string;
  thumbnailUrl: string;
  videoUrl: string;
  description: string;
}

export interface Project {
  id: string;
  name: string;
  videoInfo: YouTubeVideoInfo;
  clips: ClipCandidate[];
  createdAt: string;
  lastEdited: string;
  status: 'analyzing' | 'ready' | 'exported';
  contentGoal: ContentGoal;
  hookType: HookType;
  preferredDuration: number;
}

export interface ExportRecord {
  id: string;
  projectId: string;
  clipId: string;
  clipTitle: string;
  projectName: string;
  thumbnailUrl: string;
  resolution: '720p' | '1080p' | '1440p' | '4K';
  fps: number;
  format: 'mp4' | 'mov';
  codec: 'h264' | 'h265';
  duration: number;
  sizeMb: number;
  downloadUrl: string;
  createdAt: string;
  status: 'ready' | 'rendering' | 'failed';
}

export interface UserAccount {
  name: string;
  email: string;
  avatarUrl: string;
  plan: 'free' | 'creator' | 'pro';
  credits: number;
  minutesUsed: number;
  minutesLimit: number;
  clipsGenerated: number;
  storageMbUsed: number;
  storageMbLimit: number;
}
