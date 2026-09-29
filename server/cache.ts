import crypto from 'crypto';
import { ClipCandidate, TranscriptSentence } from '../src/types';

export interface AnalysisCacheEntry {
  videoId: string;
  cacheKey: string;
  clips: ClipCandidate[];
  transcription: {
    language: 'id' | 'en';
    sentences: TranscriptSentence[];
  };
  createdAt: number;
}

export class AnalysisCache {
  private static instance: AnalysisCache;
  private cache = new Map<string, AnalysisCacheEntry>();
  private ttlMs = 24 * 60 * 60 * 1000; // 24 hours

  private constructor() {}

  public static getInstance(): AnalysisCache {
    if (!AnalysisCache.instance) {
      AnalysisCache.instance = new AnalysisCache();
    }
    return AnalysisCache.instance;
  }

  public generateKey(videoId: string, contentGoal: string, hookType: string, duration: number, language: string): string {
    const raw = `${videoId}:${contentGoal}:${hookType}:${duration}:${language}`;
    return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 24);
  }

  public get(key: string): AnalysisCacheEntry | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    return entry;
  }

  public set(key: string, entry: Omit<AnalysisCacheEntry, 'cacheKey' | 'createdAt'>) {
    this.cache.set(key, {
      ...entry,
      cacheKey: key,
      createdAt: Date.now(),
    });
  }

  public clear() {
    this.cache.clear();
  }
}

export const analysisCache = AnalysisCache.getInstance();
