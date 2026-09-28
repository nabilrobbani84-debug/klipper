import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { promisify } from 'node:util';
import type { AppConfig } from '../config.js';
import { AppError } from '../errors.js';
import type { TranscriptDocument, TranscriptSegment, TranscriptWord } from '../types.js';

const execFileAsync = promisify(execFile);

export interface TranscriptionProvider {
  transcribe(audioPath: string, outputDir: string): Promise<TranscriptDocument>;
}

export class WhisperCliTranscriptionProvider implements TranscriptionProvider {
  constructor(private readonly config: AppConfig) {}

  async transcribe(audioPath: string, outputDir: string): Promise<TranscriptDocument> {
    await fs.mkdir(outputDir, { recursive: true });
    try {
      await execFileAsync(this.config.WHISPER_BIN, [audioPath, '--output_format', 'json', '--output_dir', outputDir, '--word_timestamps', 'True'], {
        timeout: 20 * 60_000, maxBuffer: 4 * 1024 * 1024,
      });
      const fileName = `${audioPath.split('/').pop()?.replace(/\.[^.]+$/, '')}.json`;
      const raw = JSON.parse(await fs.readFile(`${outputDir}/${fileName}`, 'utf8')) as { language?: string; segments?: Array<Record<string, unknown>> };
      const segments: TranscriptSegment[] = (raw.segments ?? []).map((segment, index) => ({
        id: `segment-${index + 1}`, text: String(segment.text ?? '').trim(), start: Number(segment.start ?? 0), end: Number(segment.end ?? 0),
        words: Array.isArray(segment.words) ? segment.words.map((word) => {
          const item = word as Record<string, unknown>;
          const result: TranscriptWord = { word: String(item.word ?? '').trim(), start: Number(item.start ?? 0), end: Number(item.end ?? 0) };
          if (typeof item.probability === 'number') result.confidence = item.probability;
          return result;
        }) : [],
      })).filter((segment) => segment.text.length > 0 && segment.end > segment.start);
      if (segments.length === 0) throw new Error('Whisper returned no transcript segments');
      return { language: raw.language ?? 'unknown', segments };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('TRANSCRIPTION_FAILED', 'Speech-to-text processing failed. Please retry the job.', 422);
    }
  }
}
