import crypto from 'node:crypto';
import crypto from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { AppError } from '../errors.js';
import type { ClipCandidate, TranscriptDocument } from '../types.js';

const candidateSchema = z.object({
  start: z.coerce.number().nonnegative(), end: z.coerce.number().positive(), score: z.coerce.number().min(0).max(100),
  title: z.string().min(1).max(140), hook: z.string().min(1).max(500), reason: z.string().min(1).max(1000), transcript: z.string().max(5000).default(''),
});

export interface AIProvider {
  detectClips(input: { transcript: TranscriptDocument; title: string; preferredDuration: number; requestedClipCount: number }): Promise<ClipCandidate[]>;
}

export class GeminiAIProvider implements AIProvider {
  private readonly ai: GoogleGenAI | null;
  constructor(config: AppConfig) {
    this.ai = config.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: config.GEMINI_API_KEY }) : null;
  }

  async detectClips(input: { transcript: TranscriptDocument; title: string; preferredDuration: number; requestedClipCount: number }) {
    if (!this.ai) throw new AppError('AI_NOT_CONFIGURED', 'GEMINI_API_KEY is not configured on the worker.', 503);
    const transcript = input.transcript.segments.map((segment) => `[${segment.start.toFixed(2)}-${segment.end.toFixed(2)}] ${segment.text}`).join('\n');
    const prompt = `You are an editorial analysis service, not a virality guarantee. Analyze this timestamped transcript from "${input.title}" and return exactly ${input.requestedClipCount} non-overlapping candidate moments. Prefer a complete hook, useful or surprising information, and a clear payoff. Target about ${input.preferredDuration} seconds. Never invent timestamps outside the transcript. Return ONLY a JSON array with objects: start, end, score (internal relevance 0-100), title, hook, reason, transcript.\n\n${transcript}`;
    try {
      const response = await this.ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
      const text = (response.text ?? '').replace(/```json|```/g, '').trim();
      const parsed = z.array(candidateSchema).parse(JSON.parse(text));
      return parsed.slice(0, input.requestedClipCount).map((candidate) => {
        const start = Math.max(0, candidate.start);
        const end = Math.max(start + 1, candidate.end);
        return {
          ...candidate,
          id: `clip-${crypto.randomUUID()}`,
          start,
          end,
          duration: end - start,
          captions: { preset: 'podcast', fontFamily: 'Arial', fontSize: 18, textColor: '#FFFFFF', highlightColor: '#FACC15', outlineColor: '#000000', position: 'bottom', maxWordsPerLine: 5, activeWord: true },
          reframing: { mode: 'center', x: 50, y: 50, zoom: 1 },
        };
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('AI_ANALYSIS_FAILED', 'AI clip analysis failed. Please retry the job.', 422);
    }
  }
}
