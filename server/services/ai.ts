import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { AppError } from '../errors.js';
import type { ClipCandidate, TranscriptDocument } from '../types.js';
import { heuristicCandidates, normalizeClips, type RawCandidate } from './clips.js';

const candidateSchema = z.object({
  start: z.coerce.number().nonnegative(),
  end: z.coerce.number().positive(),
  score: z.coerce.number().min(0).max(100),
  title: z.string().min(1).max(200),
  hook: z.string().max(600).default(''),
  reason: z.string().max(1500).default(''),
});

export interface DetectClipsInput {
  transcript: TranscriptDocument;
  title: string;
  videoDuration: number;
  preferredDuration: number;
  requestedClipCount: number;
  contentGoal?: string;
  hookType?: string;
}

export interface DetectClipsResult {
  clips: ClipCandidate[];
  provider: 'gemini' | 'heuristic';
}

export interface AIProvider {
  detectClips(input: DetectClipsInput): Promise<DetectClipsResult>;
}

/** Keeps the prompt inside a safe token budget for very long videos. */
function compactTranscript(transcript: TranscriptDocument, maxChars = 120_000): string {
  const lines = transcript.segments.map((segment) => `[${segment.start.toFixed(1)}-${segment.end.toFixed(1)}] ${segment.text}`);
  let text = lines.join('\n');
  if (text.length <= maxChars) return text;
  const step = Math.ceil(text.length / maxChars);
  text = lines.filter((_, index) => index % step === 0).join('\n');
  return text.slice(0, maxChars);
}

export class GeminiAIProvider implements AIProvider {
  private readonly client: GoogleGenAI | null;

  constructor(private readonly config: AppConfig, private readonly onWarning: (message: string, error?: unknown) => void = () => undefined) {
    this.client = config.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: config.GEMINI_API_KEY }) : null;
  }

  private async askGemini(input: DetectClipsInput): Promise<RawCandidate[]> {
    if (!this.client) throw new AppError('AI_NOT_CONFIGURED', 'GEMINI_API_KEY is not configured.', 503);
    const prompt = [
      'You are an editorial assistant that selects standalone short-form video moments from a timestamped transcript.',
      `Video title: "${input.title.replace(/"/g, "'")}"`,
      `Return ${Math.min(input.requestedClipCount * 2, 20)} candidate moments, each about ${input.preferredDuration} seconds long.`,
      input.contentGoal ? `Content goal: ${input.contentGoal}.` : '',
      input.hookType ? `Preferred hook style: ${input.hookType}.` : '',
      'Each moment must start at the beginning of a sentence with a strong hook, be understandable without the rest of the video, and end on a complete thought or payoff.',
      'Prefer: surprising statements, useful insights, emotional or funny moments, storytelling, clear conclusions. Avoid silence, intros/outros, sponsor reads and duplicate topics.',
      '"score" is an internal 0-100 relevance score, not a guarantee of virality.',
      'Only use timestamps that exist in the transcript.',
      'Respond with a JSON array of objects: {"start": number, "end": number, "score": number, "title": string, "hook": string, "reason": string}.',
      '',
      'TRANSCRIPT:',
      compactTranscript(input.transcript),
    ].filter(Boolean).join('\n');

    const response = await this.client.models.generateContent({
      model: this.config.GEMINI_MODEL,
      contents: prompt,
      config: { responseMimeType: 'application/json', temperature: 0.4 },
    });
    const text = (response.text ?? '').replace(/```json|```/g, '').trim();
    return z.array(candidateSchema).parse(JSON.parse(text));
  }

  async detectClips(input: DetectClipsInput): Promise<DetectClipsResult> {
    const options = { preferredDuration: input.preferredDuration, requestedClipCount: input.requestedClipCount, videoDuration: input.videoDuration };
    if (this.client) {
      try {
        const clips = normalizeClips(await this.askGemini(input), input.transcript, options);
        if (clips.length > 0) return { clips, provider: 'gemini' };
        this.onWarning('Gemini returned no usable clips; using transcript heuristic');
      } catch (error) {
        this.onWarning('Gemini clip detection failed; using transcript heuristic', error);
      }
    }
    const clips = normalizeClips(heuristicCandidates(input.transcript, options), input.transcript, options);
    if (clips.length === 0) throw new AppError('NO_CLIPS_FOUND', 'No suitable clip moments were found in this video.', 422);
    return { clips, provider: 'heuristic' };
  }
}
