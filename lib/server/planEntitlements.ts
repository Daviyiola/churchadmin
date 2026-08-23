import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizePlanKey, type PlanKey } from "@/lib/plans";

export type OrganizationEntitlements = {
  plan: PlanKey;
  emailMonthlyLimit: number;
  formCountLimit: number | null;
  nikkyMonthlyBudgetCents: number | null;
  nikkyBudgetSource: "plan" | "enterprise_custom" | "missing_enterprise_custom";
};

export async function getOrganizationEntitlements(
  organizationId: string,
): Promise<OrganizationEntitlements> {
  const { data: planRow, error: planError } = await supabaseAdmin
    .from("org_plans")
    .select("plan")
    .eq("organization_id", organizationId)
    .maybeSingle<{ plan: string | null }>();
  if (planError) throw new Error(planError.message);

  // Growth is a legacy alias for Pro. Any other unknown or missing value is
  // intentionally treated as Basic instead of receiving elevated access.
  const plan = normalizePlanKey(planRow?.plan);
  const { data: entitlement, error: entitlementError } = await supabaseAdmin
    .from("plan_entitlements")
    .select("email_monthly_limit,form_count_limit,nikky_monthly_budget_cents")
    .eq("plan_key", plan)
    .single<{
      email_monthly_limit: number;
      form_count_limit: number | null;
      nikky_monthly_budget_cents: number | null;
    }>();
  if (entitlementError) throw new Error(entitlementError.message);

  if (plan !== "enterprise") {
    return {
      plan,
      emailMonthlyLimit: Number(entitlement.email_monthly_limit),
      formCountLimit: entitlement.form_count_limit === null
        ? null
        : Number(entitlement.form_count_limit),
      nikkyMonthlyBudgetCents: Number(entitlement.nikky_monthly_budget_cents),
      nikkyBudgetSource: "plan",
    };
  }

  const { data: settings, error: settingsError } = await supabaseAdmin
    .from("organization_settings")
    .select("nikky_monthly_budget_cents")
    .eq("organization_id", organizationId)
    .maybeSingle<{ nikky_monthly_budget_cents: number | null }>();
  if (settingsError) throw new Error(settingsError.message);
  const custom = Number(settings?.nikky_monthly_budget_cents ?? 0);
  return {
    plan,
    emailMonthlyLimit: Number(entitlement.email_monthly_limit),
    formCountLimit: entitlement.form_count_limit === null
      ? null
      : Number(entitlement.form_count_limit),
    nikkyMonthlyBudgetCents: custom > 0 ? custom : null,
    nikkyBudgetSource: custom > 0 ? "enterprise_custom" : "missing_enterprise_custom",
  };
}
