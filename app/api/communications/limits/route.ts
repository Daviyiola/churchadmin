import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireUser, requireOrgOwnerOrAdmin } from "@/lib/serverAuthz";
import {
  PLAN_MONTHLY_LIMIT,
  type PlanKey,
} from "@/lib/serverLimits";

export const runtime = "nodejs";

type ErrorJson = { error: string };

function monthBucketUtc(d = new Date()) {
  // store first day of month in UTC as YYYY-MM-DD
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  return dt.toISOString().slice(0, 10);
}

function isPlanKey(v: string): v is PlanKey {
  return v === "free" || v === "basic" || v === "growth" || v === "enterprise";
}

export async function GET(req: Request) {
  try {
    const u = await requireUser(req);
    if (!u.ok)
      return NextResponse.json<ErrorJson>({ error: u.error }, { status: u.status });

    const url = new URL(req.url);
    const organization_id = String(url.searchParams.get("organization_id") ?? "").trim();
    if (!organization_id)
      return NextResponse.json<ErrorJson>({ error: "organization_id required" }, { status: 400 });

    const authz = await requireOrgOwnerOrAdmin(organization_id, u.userId);
    if (!authz.ok)
      return NextResponse.json<ErrorJson>({ error: authz.error }, { status: authz.status });

    // plan
    const { data: planRow, error: planErr } = await supabaseAdmin
      .from("org_plans")
      .select("plan")
      .eq("organization_id", organization_id)
      .maybeSingle<{ plan: string | null }>();

    if (planErr) throw new Error(planErr.message);

    const planRaw = String(planRow?.plan ?? "basic").toLowerCase();
    const plan: PlanKey = isPlanKey(planRaw) ? planRaw : "basic";
    const month_limit = PLAN_MONTHLY_LIMIT[plan];

    // usage
    const mb = monthBucketUtc();
    const { data: usageRow, error: usageErr } = await supabaseAdmin
      .from("org_email_usage_month")
      .select("used")
      .eq("organization_id", organization_id)
      .eq("month_bucket", mb)
      .maybeSingle<{ used: number }>();

    if (usageErr) throw new Error(usageErr.message);

    const month_used = Number(usageRow?.used ?? 0);
    const month_left = Math.max(0, month_limit - month_used);

    return NextResponse.json({
      ok: true,
      plan,
      month_bucket: mb,
      month_limit,
      month_used,
      month_left,
    });
  } catch (e) {
    return NextResponse.json<ErrorJson>(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 400 },
    );
  }
}
