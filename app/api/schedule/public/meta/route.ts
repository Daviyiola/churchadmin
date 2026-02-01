// app/api/schedule/public/meta/route.ts
import { NextResponse } from "next/server";
import { resolveOrgByToken, loadOrgBranding } from "@/lib/schedule/public";
import { getPublicAllowedMonth } from "@/lib/schedule/public_rules";
import { ensureScheduleMonth } from "@/lib/schedule/admin";
import type { PublicMetaResponse } from "@/lib/schedule/types";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type ErrorJson = { error: string };

function addMonths(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = String(searchParams.get("token") ?? "").trim();
  if (!token) {
    return NextResponse.json<ErrorJson>({ error: "Missing token" }, { status: 400 });
  }

  const resolved = await resolveOrgByToken(token);
  if (!resolved.ok) {
    return NextResponse.json<ErrorJson>({ error: resolved.error }, { status: resolved.status });
  }

  const branding = await loadOrgBranding(resolved.org_id);
  if (!branding.ok) {
    return NextResponse.json<ErrorJson>({ error: branding.error }, { status: branding.status });
  }

  // 1) Determine current public month (rule-driven)
  const currentMonth = getPublicAllowedMonth();

  // 2) Ensure current month exists (safe auto-create)
  const ensured = await ensureScheduleMonth(resolved.org_id, currentMonth);
  if (!ensured.ok) {
    return NextResponse.json<ErrorJson>({ error: ensured.error }, { status: 400 });
  }

  // 3) Allowed window: current + next 2 months
  const allowedMonths = [
    currentMonth,
    addMonths(currentMonth, 1),
    addMonths(currentMonth, 2),
  ];

  // 4) Fetch only public-visible months within window
  const { data: months, error: mErr } = await supabaseAdmin
    .from("schedule_months")
    .select("month,draft_open,is_public_visible")
    .eq("org_id", resolved.org_id)
    .eq("is_public_visible", true)
    .in("month", allowedMonths)
    .order("month", { ascending: true });

  if (mErr) {
    return NextResponse.json<ErrorJson>({ error: mErr.message }, { status: 400 });
  }

  const out: PublicMetaResponse = {
    ok: true,
    org: branding.org,
    token: { is_active: resolved.is_active },
    months: (months ?? []).map((m) => ({
      month: String(m.month),
      draft_open: Boolean(m.draft_open),
      is_public_visible: Boolean(m.is_public_visible),
    })),
    defaultMonth: currentMonth,
  };

  return NextResponse.json(out);
}
