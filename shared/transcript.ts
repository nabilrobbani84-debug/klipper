import type { TranscriptDocument, TranscriptSegment, TranscriptWord } from './types.js';

/** Shape returned by Workers AI `@cf/openai/whisper-large-v3-turbo` (and openai-whisper JSON). */
export interface WhisperOutput {
  text?: string;
  transcription_info?: { language?: string; duration?: number };
  language?: string;
  segments?: Array<{
    start?: number;
    end?: number;
    text?: string;
    no_speech_prob?: number;
    words?: Array<{ word?: string; start?: number; end?: number; probability?: number }>;
  }>;
}

/**
 * Converts a Whisper response for one audio chunk into transcript segments, shifting every timestamp
 * by `offset` seconds so chunks line up on the source-video timeline.
 */
export function parseWhisperOutput(raw: WhisperOutput, offset = 0, idPrefix = 'segment'): TranscriptDocument {
  const segments: TranscriptSegment[] = (raw.segments ?? [])
    .filter((segment) => (segment.no_speech_prob ?? 0) < 0.9)
    .map((segment, index) => {
      const words: TranscriptWord[] = (segment.words ?? [])
        .map((word) => {
          const result: TranscriptWord = {
            word: String(word.word ?? '').trim(),
            start: Number(word.start ?? 0) + offset,
            end: Number(word.end ?? 0) + offset,
          };
          if (typeof word.probability === 'number') result.confidence = word.probability;
          return result;
        })
        .filter((word) => word.word.length > 0 && word.end >= word.start);
      return {
        id: `${idPrefix}-${index + 1}`,
        text: String(segment.text ?? '').trim(),
        start: Number(segment.start ?? 0) + offset,
        end: Number(segment.end ?? 0) + offset,
        words,
      };
    })
    .filter((segment) => segment.text.length > 0 && segment.end > segment.start);
  return { language: raw.transcription_info?.language ?? raw.language ?? 'unknown', segments };
}

/** Joins per-chunk transcripts in timeline order and renumbers segment ids. */
export function mergeTranscripts(parts: TranscriptDocument[]): TranscriptDocument {
  const languages = parts.map((part) => part.language).filter((lang) => lang && lang !== 'unknown');
  const segments = parts
    .flatMap((part) => part.segments)
    .sort((a, b) => a.start - b.start)
    .map((segment, index) => ({ ...segment, id: `segment-${index + 1}` }));
  return { language: languages[0] ?? 'unknown', segments };
}

/** Segments overlapping a time window (used to send only relevant transcript to the UI / renderer). */
export function segmentsInWindow(transcript: TranscriptDocument, start: number, end: number): TranscriptSegment[] {
  return transcript.segments.filter((segment) => segment.end > start && segment.start < end);
}
