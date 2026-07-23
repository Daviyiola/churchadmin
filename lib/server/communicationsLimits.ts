import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  ORG_BURST_PER_MINUTE,
} from "@/lib/serverLimits";
import type { PlanKey } from "@/lib/plans";
import { getOrganizationEntitlements } from "@/lib/server/planEntitlements";

/* ---------------- helpers ---------------- */

function monthBucketUTC(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10); // YYYY-MM-DD
}

function minuteBucketUTC(d = new Date()) {
  const x = new Date(d);
  x.setUTCSeconds(0, 0);
  return x.toISOString();
}

/* ---------------- plan ---------------- */

export async function getOrgPlan(
  organization_id: string,
): Promise<PlanKey> {
  return (await getOrganizationEntitlements(organization_id)).plan;
}

/* ---------------- monthly quota ---------------- */

export async function assertMonthlyQuota(
  organization_id: string,
  incrementBy: number,
) {
  const entitlements = await getOrganizationEntitlements(organization_id);
  const plan = entitlements.plan;
  const limit = entitlements.emailMonthlyLimit;
  const month = monthBucketUTC();

  const { data, error } = await supabaseAdmin
    .from("org_email_usage_month")
    .select("used")
    .eq("organization_id", organization_id)
    .eq("month_bucket", month)
    .maybeSingle<{ used: number }>();

  if (error) throw new Error(error.message);

  const used = data?.used ?? 0;
  if (used + incrementBy > limit) {
    return {
      ok: false as const,
      error: `Monthly email limit exceeded (${used}/${limit})`,
      plan,
      used,
      limit,
    };
  }

  return { ok: true as const };
}

export async function consumeMonthlyQuota(
  organization_id: string,
  incrementBy: number,
) {
  const month = monthBucketUTC();

  const { error } = await supabaseAdmin.rpc(
    "increment_org_month_usage",
    {
      p_organization_id: organization_id,
      p_month_bucket: month,
      p_increment: incrementBy,
    },
  );

  if (error) throw new Error(error.message);
}

/* ---------------- burst ---------------- */

export async function assertBurstLimit(
  organization_id: string,
  incrementBy: number,
) {
  const minute = minuteBucketUTC();

  const { data, error } = await supabaseAdmin
    .from("org_burst_usage_minute")
    .select("used")
    .eq("organization_id", organization_id)
    .eq("minute_bucket", minute)
    .maybeSingle<{ used: number }>();

  if (error) throw new Error(error.message);

  const used = data?.used ?? 0;
  if (used + incrementBy > ORG_BURST_PER_MINUTE) {
    return {
      ok: false as const,
      error: "Rate limit exceeded. Try again in a minute.",
    };
  }

  return { ok: true as const };
}

export async function consumeBurst(
  organization_id: string,
  incrementBy: number,
) {
  const minute = minuteBucketUTC();

  const { error } = await supabaseAdmin.rpc(
    "increment_org_burst_minute",
    {
      p_organization_id: organization_id,
      p_minute_bucket: minute,
      p_increment: incrementBy,
    },
  );

  if (error) throw new Error(error.message);
}
