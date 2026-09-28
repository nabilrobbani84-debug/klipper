export type PlanCode = 'FREE' | 'CREATOR' | 'PRO';

export interface PlanEntitlements {
  code: PlanCode;
  monthlyCredits: number;
  maxVideoDurationSeconds: number;
  maxOutputResolution: '720p' | '1080p' | '4K';
  maxClipsPerJob: number;
  storageLimitBytes: number;
  concurrentJobs: number;
  watermark: boolean;
  priority: number;
}

export const PLAN_ENTITLEMENTS: Record<PlanCode, PlanEntitlements> = {
  FREE: { code: 'FREE', monthlyCredits: 3, maxVideoDurationSeconds: 900, maxOutputResolution: '720p', maxClipsPerJob: 3, storageLimitBytes: 2_000_000_000, concurrentJobs: 1, watermark: true, priority: 1 },
  CREATOR: { code: 'CREATOR', monthlyCredits: 50, maxVideoDurationSeconds: 3600, maxOutputResolution: '1080p', maxClipsPerJob: 10, storageLimitBytes: 25_000_000_000, concurrentJobs: 2, watermark: false, priority: 5 },
  PRO: { code: 'PRO', monthlyCredits: 500, maxVideoDurationSeconds: 14_400, maxOutputResolution: '4K', maxClipsPerJob: 10, storageLimitBytes: 100_000_000_000, concurrentJobs: 4, watermark: false, priority: 10 },
};

export function getPlanEntitlements(plan: string | null | undefined): PlanEntitlements {
  return PLAN_ENTITLEMENTS[(plan as PlanCode) in PLAN_ENTITLEMENTS ? plan as PlanCode : 'FREE'];
}
