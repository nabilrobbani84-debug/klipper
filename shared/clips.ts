import type { ClipCandidate, TranscriptDocument, TranscriptSegment } from './types.js';

export interface RawCandidate {
  start: number;
  end: number;
  score: number;
  title: string;
  hook: string;
  reason: string;
}

export interface NormalizeOptions {
  preferredDuration: number;
  requestedClipCount: number;
  videoDuration?: number;
  minDuration?: number;
  maxDuration?: number;
}

const MAX_OVERLAP_RATIO = 0.3;

function segmentsBetween(segments: TranscriptSegment[], start: number, end: number) {
  return segments.filter((segment) => segment.end > start && segment.start < end);
}

export function transcriptText(transcript: TranscriptDocument, start: number, end: number): string {
  return segmentsBetween(transcript.segments, start, end).map((segment) => segment.text).join(' ').replace(/\s+/g, ' ').trim();
}

function overlapRatio(a: { start: number; end: number }, b: { start: number; end: number }): number {
  const overlap = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  return overlap / Math.max(1e-6, Math.min(a.end - a.start, b.end - b.start));
}

/**
 * Turns model output into safe, renderable clips: snaps to sentence boundaries (so clips never start
 * mid-sentence), enforces duration bounds, clamps to the video, drops duplicates/overlaps and limits count.
 */
export function normalizeClips(raw: RawCandidate[], transcript: TranscriptDocument, options: NormalizeOptions): ClipCandidate[] {
  const segments = [...transcript.segments].sort((a, b) => a.start - b.start);
  if (segments.length === 0) return [];
  const videoEnd = options.videoDuration ?? segments[segments.length - 1].end;
  const minDuration = options.minDuration ?? Math.min(15, Math.max(5, options.preferredDuration * 0.4));
  const maxDuration = options.maxDuration ?? Math.max(options.preferredDuration * 1.8, 60);

  const snapped = raw
    .filter((candidate) => Number.isFinite(candidate.start) && Number.isFinite(candidate.end) && candidate.end > candidate.start)
    .map((candidate) => {
      const startSegmentIndex = Math.max(0, segments.findIndex((segment) => segment.end > candidate.start));
      let endSegmentIndex = segments.findIndex((segment) => segment.end >= candidate.end);
      if (endSegmentIndex < 0) endSegmentIndex = segments.length - 1;
      endSegmentIndex = Math.max(endSegmentIndex, startSegmentIndex);

      // Extend forward until the minimum duration is met.
      while (segments[endSegmentIndex].end - segments[startSegmentIndex].start < minDuration && endSegmentIndex < segments.length - 1) endSegmentIndex += 1;
      // Trim from the end until the maximum duration is respected (keeping at least one segment).
      while (segments[endSegmentIndex].end - segments[startSegmentIndex].start > maxDuration && endSegmentIndex > startSegmentIndex) endSegmentIndex -= 1;

      const start = Math.max(0, segments[startSegmentIndex].start);
      const end = Math.min(videoEnd, Math.min(segments[endSegmentIndex].end, start + maxDuration));
      return { ...candidate, start: Number(start.toFixed(3)), end: Number(end.toFixed(3)), score: Math.round(Math.min(100, Math.max(0, candidate.score))) };
    })
    .filter((candidate) => candidate.end - candidate.start >= Math.min(minDuration, 3))
    .sort((a, b) => b.score - a.score);

  const selected: typeof snapped = [];
  for (const candidate of snapped) {
    if (selected.some((existing) => overlapRatio(existing, candidate) > MAX_OVERLAP_RATIO)) continue;
    selected.push(candidate);
    if (selected.length >= options.requestedClipCount) break;
  }

  return selected
    .sort((a, b) => a.start - b.start)
    .map((candidate) => ({
      id: `clip-${globalThis.crypto.randomUUID()}`,
      start: candidate.start,
      end: candidate.end,
      duration: Number((candidate.end - candidate.start).toFixed(3)),
      score: candidate.score,
      title: candidate.title.trim().slice(0, 140) || 'Untitled clip',
      hook: candidate.hook.trim().slice(0, 500),
      reason: candidate.reason.trim().slice(0, 1000),
      transcript: transcriptText(transcript, candidate.start, candidate.end),
    }));
}

const HOOK_PATTERNS = [/\?/, /\b(why|how|what|secret|mistake|never|always|truth|nobody|most people|biggest|best|worst)\b/i, /!/, /\b(\d+)\b/];

/**
 * Deterministic transcript-based selection used when no AI provider is configured or the provider fails.
 * Scores sliding windows by speech density and hook-like phrasing. Results are labelled as heuristic.
 */
export function heuristicCandidates(transcript: TranscriptDocument, options: NormalizeOptions): RawCandidate[] {
  const segments = transcript.segments;
  const candidates: RawCandidate[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    const first = segments[i];
    let j = i;
    while (j < segments.length - 1 && segments[j + 1].end - first.start <= options.preferredDuration) j += 1;
    const windowSegments = segments.slice(i, j + 1);
    const duration = windowSegments[windowSegments.length - 1].end - first.start;
    if (duration <= 0) continue;
    const words = windowSegments.reduce((sum, segment) => sum + segment.text.split(/\s+/).filter(Boolean).length, 0);
    const density = Math.min(1, words / duration / 3);
    const hookBonus = HOOK_PATTERNS.reduce((sum, pattern) => sum + (pattern.test(first.text) ? 1 : 0), 0) / HOOK_PATTERNS.length;
    const fit = 1 - Math.min(1, Math.abs(duration - options.preferredDuration) / options.preferredDuration);
    const score = Math.round(40 + density * 25 + hookBonus * 25 + fit * 10);
    const title = first.text.split(/[.!?]/)[0].slice(0, 80) || `Moment at ${Math.round(first.start)}s`;
    candidates.push({ start: first.start, end: first.start + duration, score, title, hook: first.text.slice(0, 200), reason: 'Heuristic selection based on speech density and hook phrasing (AI provider not used).' });
  }
  return candidates;
}
