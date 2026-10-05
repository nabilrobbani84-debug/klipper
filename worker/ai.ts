import { z } from 'zod';
import { AppError } from '../shared/errors.js';
import { heuristicCandidates, normalizeClips, type RawCandidate } from '../shared/clips.js';
import type { ClipCandidate, TranscriptDocument } from '../shared/types.js';
import type { Env } from './env.js';

const candidateSchema = z.object({
  start: z.coerce.number().nonnegative(),
  end: z.coerce.number().positive(),
  score: z.coerce.number().min(0).max(100),
  title: z.string().min(1).max(200),
  hook: z.string().max(600).default(''),
  reason: z.string().max(1500).default(''),
});
const candidatesSchema = z.array(candidateSchema);

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
  provider: 'gemini' | 'workers-ai' | 'heuristic';
}

/** Keeps the prompt inside the model's context budget for very long videos. */
export function compactTranscript(transcript: TranscriptDocument, maxChars: number): string {
  const lines = transcript.segments.map((segment) => `[${segment.start.toFixed(1)}-${segment.end.toFixed(1)}] ${segment.text}`);
  const text = lines.join('\n');
  if (text.length <= maxChars) return text;
  const step = Math.ceil(text.length / maxChars);
  return lines.filter((_, index) => index % step === 0).join('\n').slice(0, maxChars);
}

function buildPrompt(input: DetectClipsInput, maxChars: number): string {
  return [
    'You are an editorial assistant that selects standalone short-form video moments from a timestamped transcript.',
    `Video title: "${input.title.replace(/"/g, "'")}"`,
    `Return ${Math.min(input.requestedClipCount * 2, 20)} candidate moments, each about ${input.preferredDuration} seconds long.`,
    input.contentGoal ? `Content goal: ${input.contentGoal}.` : '',
    input.hookType ? `Preferred hook style: ${input.hookType}.` : '',
    'Each moment must start at the beginning of a sentence with a strong hook, be understandable on its own, and end on a complete thought or payoff.',
    'Prefer surprising statements, useful insights, emotional or funny moments, storytelling and clear conclusions. Avoid silence, intros/outros, sponsor reads and duplicate topics.',
    '"score" is an internal 0-100 relevance score, not a guarantee of virality. Only use timestamps that exist in the transcript.',
    'Reply with JSON: {"clips": [{"start": number, "end": number, "score": number, "title": string, "hook": string, "reason": string}]}.',
    '',
    'TRANSCRIPT:',
    compactTranscript(input.transcript, maxChars),
  ].filter(Boolean).join('\n');
}

/** Accepts `[...]`, `{"clips": [...]}` or a JSON string of either. */
export function parseCandidates(value: unknown): RawCandidate[] {
  let data = value;
  if (typeof data === 'string') data = JSON.parse(data.replace(/```json|```/g, '').trim());
  if (data && typeof data === 'object' && !Array.isArray(data) && 'clips' in data) data = (data as { clips: unknown }).clips;
  return candidatesSchema.parse(data);
}

async function askGemini(env: Env, input: DetectClipsInput): Promise<RawCandidate[]> {
  const model = env.GEMINI_MODEL || 'gemini-2.5-flash';
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY ?? '' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: buildPrompt(input, 400_000) }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
    }),
  });
  if (!response.ok) throw new Error(`Gemini HTTP ${response.status}`);
  const body = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
  return parseCandidates(text);
}

const CLIP_JSON_SCHEMA = {
  type: 'object',
  properties: {
    clips: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          start: { type: 'number' }, end: { type: 'number' }, score: { type: 'number' },
          title: { type: 'string' }, hook: { type: 'string' }, reason: { type: 'string' },
        },
        required: ['start', 'end', 'score', 'title', 'hook', 'reason'],
      },
    },
  },
  required: ['clips'],
};

async function askWorkersAi(env: Env, input: DetectClipsInput): Promise<RawCandidate[]> {
  if (!env.AI) throw new Error('Workers AI binding missing');
  const result = (await env.AI.run(env.TEXT_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
    messages: [
      { role: 'system', content: 'You select the best short-form clips from transcripts and always answer with valid JSON.' },
      // ~60k characters keeps us well inside the 24k-token context window.
      { role: 'user', content: buildPrompt(input, 60_000) },
    ],
    response_format: { type: 'json_schema', json_schema: CLIP_JSON_SCHEMA },
    max_tokens: 3000,
    temperature: 0.4,
  })) as { response?: unknown };
  return parseCandidates(result.response);
}

/**
 * Picks clip moments. Order: Gemini (if GEMINI_API_KEY) → Workers AI LLM → deterministic transcript heuristic.
 * Every result is normalised (sentence-aligned, de-duplicated, length-bounded) before saving.
 */
export async function detectClips(env: Env, input: DetectClipsInput, warn: (message: string, error?: unknown) => void): Promise<DetectClipsResult> {
  const options = { preferredDuration: input.preferredDuration, requestedClipCount: input.requestedClipCount, videoDuration: input.videoDuration };
  const providers: Array<['gemini' | 'workers-ai', () => Promise<RawCandidate[]>]> = [];
  if (env.GEMINI_API_KEY) providers.push(['gemini', () => askGemini(env, input)]);
  if (env.AI) providers.push(['workers-ai', () => askWorkersAi(env, input)]);
  for (const [provider, ask] of providers) {
    try {
      const clips = normalizeClips(await ask(), input.transcript, options);
      if (clips.length > 0) return { clips, provider };
      warn(`${provider} returned no usable clips`);
    } catch (error) {
      warn(`${provider} clip detection failed`, error);
    }
  }
  const clips = normalizeClips(heuristicCandidates(input.transcript, options), input.transcript, options);
  if (clips.length === 0) throw new AppError('NO_CLIPS_FOUND', 'No suitable clip moments were found in this video.', 422);
  return { clips, provider: 'heuristic' };
}
