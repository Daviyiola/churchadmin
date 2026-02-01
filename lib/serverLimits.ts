// lib/serverLimits.ts

export type PlanKey = "free" | "basic" | "growth" | "enterprise";

export const PLAN_MONTHLY_LIMIT: Record<PlanKey, number> = {
  free: 100,
  basic: 1000,
  growth: 3000,
  enterprise: 10000,
};

export const ORG_BURST_PER_MINUTE = 30; // per org (shared by all admins)