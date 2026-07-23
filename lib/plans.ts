export type PlanKey = "free" | "basic" | "pro" | "enterprise";

export function normalizePlanKey(value: unknown): PlanKey {
  const plan = String(value ?? "").trim().toLowerCase();
  if (plan === "free" || plan === "basic" || plan === "enterprise") return plan;
  if (plan === "pro" || plan === "growth") return "pro";
  return "basic";
}
