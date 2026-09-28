import { YouTubeVideoInfo, ClipCandidate, ContentGoal, HookType } from '../types';
import { SAMPLE_VIDEOS, generateSampleClips } from '../data/sampleVideos';

export function extractYouTubeId(url: string): string | null {
  if (!url) return null;
  const cleanUrl = url.trim();
  const watchMatch = cleanUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  if (watchMatch?.[1]) return watchMatch[1];
  return /^[a-zA-Z0-9_-]{11}$/.test(cleanUrl) ? cleanUrl : null;
}

export function isValidYouTubeUrl(url: string): boolean {
  return extractYouTubeId(url) !== null;
}

export async function fetchVideoMetadata(url: string): Promise<YouTubeVideoInfo> {
  const videoId = extractYouTubeId(url);
  if (!videoId) throw new Error('Invalid YouTube URL. Please provide a valid YouTube video link.');
  const matchedSample = SAMPLE_VIDEOS.find((sample) => sample.id === videoId || extractYouTubeId(sample.url) === videoId);
  if (matchedSample) return { ...matchedSample, url };
  throw new Error('Live YouTube processing is available through the configured backend. Set VITE_API_URL and start the API/worker services.');
}

export interface AnalysisProgressCallback {
  (stepIndex: number, stepName: string, progressPercent: number, logMessage: string): void;
}

export const PROCESSING_STEPS = [
  'Fetching video information', 'Extracting transcript & audio stream', 'Analyzing speech patterns & cadence',
  'Detecting important moments & high energy', 'Detecting emotional peaks & controversy', 'Finding potential hooks & curiosity gaps',
  'Generating ranked clip candidates', 'Applying AI smart reframing & auto-cuts', 'Preparing multi-track timeline preview',
];

export async function analyzeVideoWithAI(
  videoInfo: YouTubeVideoInfo,
  _contentGoal: ContentGoal = 'retention',
  _hookType: HookType = 'curiosity',
  _preferredDuration = 45,
  onProgress?: AnalysisProgressCallback,
): Promise<ClipCandidate[]> {
  const matchedSample = SAMPLE_VIDEOS.find((sample) => sample.id === videoInfo.id);
  if (!matchedSample) throw new Error('This browser demo cannot analyze live media. Use the backend Generate Clips pipeline.');
  for (let index = 0; index < PROCESSING_STEPS.length; index += 1) {
    onProgress?.(index, PROCESSING_STEPS[index], Math.round(((index + 1) / PROCESSING_STEPS.length) * 100), `Demo sample only: ${PROCESSING_STEPS[index]}.`);
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return generateSampleClips(videoInfo);
}
