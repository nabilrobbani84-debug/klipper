import type { OutputResolution } from './types.js';

export type PlanCode = 'FREE' | 'CREATOR' | 'PRO';

export interface PlanEntitlements {
  code: PlanCode;
  monthlyCredits: number;
  maxVideoDurationSeconds: number;
  maxOutputResolution: OutputResolution;
  maxClipsPerJob: number;
  storageLimitBytes: number;
  concurrentJobs: number;
  watermark: boolean;
  priority: number;
}

export const PLAN_ENTITLEMENTS: Record<PlanCode, PlanEntitlements> = {
  FREE: { code: 'FREE', monthlyCredits: 3, maxVideoDurationSeconds: 1800, maxOutputResolution: '720p', maxClipsPerJob: 3, storageLimitBytes: 2_000_000_000, concurrentJobs: 1, watermark: true, priority: 10 },
  CREATOR: { code: 'CREATOR', monthlyCredits: 50, maxVideoDurationSeconds: 3 * 3600, maxOutputResolution: '1080p', maxClipsPerJob: 10, storageLimitBytes: 25_000_000_000, concurrentJobs: 2, watermark: false, priority: 5 },
  PRO: { code: 'PRO', monthlyCredits: 300, maxVideoDurationSeconds: 4 * 3600, maxOutputResolution: '4K', maxClipsPerJob: 10, storageLimitBytes: 100_000_000_000, concurrentJobs: 4, watermark: false, priority: 1 },
};

export const PLAN_CODES = Object.keys(PLAN_ENTITLEMENTS) as PlanCode[];

export function isPlanCode(value: unknown): value is PlanCode {
  return typeof value === 'string' && value in PLAN_ENTITLEMENTS;
}

export function getPlanEntitlements(plan: string | null | undefined): PlanEntitlements {
  return PLAN_ENTITLEMENTS[isPlanCode(plan) ? plan : 'FREE'];
}

const RESOLUTION_ORDER: OutputResolution[] = ['720p', '1080p', '1440p', '4K'];

/** Returns the requested resolution, capped to what the plan allows. */
export function capResolution(requested: OutputResolution, plan: PlanEntitlements): OutputResolution {
  const max = RESOLUTION_ORDER.indexOf(plan.maxOutputResolution);
  const wanted = RESOLUTION_ORDER.indexOf(requested);
  return RESOLUTION_ORDER[Math.min(max, wanted)];
}
