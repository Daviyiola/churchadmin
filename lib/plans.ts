export type PlanKey = "free" | "basic" | "growth" | "pro" | "enterprise";

export function normalizePlanKey(value: unknown): PlanKey {
  const plan = String(value ?? "").trim().toLowerCase();
  if (["free", "basic", "growth", "pro", "enterprise"].includes(plan)) return plan as PlanKey;
  return "basic";
}
