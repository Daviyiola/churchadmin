import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { PlanKey } from "@/lib/plans";

export type BillingInterval = "none" | "monthly" | "annual";
export type PublicPlan = {
  key: PlanKey;
  name: string;
  description: string;
  monthlyPriceCents: number | null;
  annualPriceCents: number | null;
  recommended: boolean;
  memberLimit: number | null;
  firstTimerLimit: number | null;
  managementSeatLimit: number | null;
  emailLimit: number;
  formLimit: number | null;
  nikkyBudgetCents: number | null;
};

export async function getPublicPlans(): Promise<PublicPlan[]> {
  const { data, error } = await supabaseAdmin.from("billing_plan_catalog")
    .select("plan_key,display_name,description,monthly_price_cents,annual_price_cents,recommended,sort_order,plan_entitlements(member_count_limit,first_timer_count_limit,management_seat_limit,email_monthly_limit,form_count_limit,nikky_monthly_budget_cents)")
    .eq("public_available", true).order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const ent = Array.isArray(row.plan_entitlements) ? row.plan_entitlements[0] : row.plan_entitlements;
    return {
      key: row.plan_key as PlanKey, name: row.display_name, description: row.description,
      monthlyPriceCents: row.monthly_price_cents, annualPriceCents: row.annual_price_cents,
      recommended: row.recommended, memberLimit: ent?.member_count_limit ?? null,
      firstTimerLimit: ent?.first_timer_count_limit ?? null, managementSeatLimit: ent?.management_seat_limit ?? null,
      emailLimit: ent?.email_monthly_limit ?? 0, formLimit: ent?.form_count_limit ?? null,
      nikkyBudgetCents: ent?.nikky_monthly_budget_cents ?? null,
    };
  });
}

export async function getStripePrice(plan: PlanKey, interval: Exclude<BillingInterval,"none">) {
  const column = interval === "monthly" ? "stripe_monthly_price_id" : "stripe_annual_price_id";
  const { data, error } = await supabaseAdmin.from("billing_plan_catalog").select(column)
    .eq("plan_key", plan).eq("public_available", true).maybeSingle();
  if (error) throw new Error(error.message);
  const value = data?.[column as keyof typeof data];
  if (typeof value !== "string" || !value) throw new Error("Stripe pricing is not configured for this plan.");
  return value;
}
