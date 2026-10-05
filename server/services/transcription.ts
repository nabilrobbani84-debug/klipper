import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config.js';
import { AppError } from '../errors.js';
import type { TranscriptDocument, TranscriptSegment, TranscriptWord } from '../types.js';
import { ExecError, run } from './exec.js';

export interface TranscriptionProvider {
  transcribe(audioPath: string, outputDir: string, signal?: AbortSignal): Promise<TranscriptDocument>;
}

/** Converts openai-whisper JSON output into the structured transcript used by every downstream stage. */
export function parseWhisperJson(raw: { language?: string; segments?: Array<Record<string, unknown>> }): TranscriptDocument {
  const segments: TranscriptSegment[] = (raw.segments ?? [])
    .map((segment, index) => {
      const words: TranscriptWord[] = Array.isArray(segment.words)
        ? segment.words
          .map((word) => {
            const item = word as Record<string, unknown>;
            const result: TranscriptWord = { word: String(item.word ?? '').trim(), start: Number(item.start ?? 0), end: Number(item.end ?? 0) };
            if (typeof item.probability === 'number') result.confidence = item.probability;
            return result;
          })
          .filter((word) => word.word.length > 0 && word.end >= word.start)
        : [];
      return {
        id: `segment-${index + 1}`,
        text: String(segment.text ?? '').trim(),
        start: Number(segment.start ?? 0),
        end: Number(segment.end ?? 0),
        words,
      };
    })
    .filter((segment) => segment.text.length > 0 && segment.end > segment.start);
  return { language: raw.language ?? 'unknown', segments };
}

export class WhisperCliTranscriptionProvider implements TranscriptionProvider {
  constructor(private readonly config: AppConfig) {}

  async transcribe(audioPath: string, outputDir: string, signal?: AbortSignal): Promise<TranscriptDocument> {
    await fs.mkdir(outputDir, { recursive: true });
    const args = [
      audioPath,
      '--model', this.config.WHISPER_MODEL,
      '--output_format', 'json',
      '--output_dir', outputDir,
      '--word_timestamps', 'True',
      '--fp16', 'False',
      '--threads', String(this.config.WHISPER_THREADS),
      '--verbose', 'False',
    ];
    if (this.config.WHISPER_LANGUAGE) args.push('--language', this.config.WHISPER_LANGUAGE);
    try {
      await run(this.config.WHISPER_BIN, args, { timeoutMs: 4 * 60 * 60_000, signal });
      const fileName = `${path.basename(audioPath).replace(/\.[^.]+$/, '')}.json`;
      const transcript = parseWhisperJson(JSON.parse(await fs.readFile(path.join(outputDir, fileName), 'utf8')));
      if (transcript.segments.length === 0) throw new AppError('NO_SPEECH', 'No speech was detected in this video, so clips could not be generated.', 422);
      return transcript;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof ExecError && error.aborted) throw new AppError('JOB_CANCELLED', 'Processing was cancelled.', 409);
      throw new AppError('TRANSCRIPTION_FAILED', 'Speech-to-text processing failed. Please retry the job.', 422);
    }
  }
}
