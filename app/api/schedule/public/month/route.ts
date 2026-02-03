// app/api/schedule/public/month/route.ts
import { NextResponse } from "next/server";
import { resolveOrgByToken } from "@/lib/schedule/public";
import { cleanStr, isYYYYMM } from "@/lib/schedule/util";
import {
  assertPublicMonthAllowed,
  getPublicAllowedMonth,
} from "@/lib/schedule/public_rules";

import { ensureScheduleMonth } from "@/lib/schedule/admin";
import type { PublicMonthResponse } from "@/lib/schedule/types";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type ErrorJson = { error: string };

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = cleanStr(searchParams.get("token"));
  const monthRaw = cleanStr(searchParams.get("month"));

  if (!token)
    return NextResponse.json<ErrorJson>(
      { error: "Missing token" },
      { status: 400 },
    );

  const month =
    monthRaw && isYYYYMM(monthRaw) ? monthRaw : getPublicAllowedMonth();

  // Public cannot view other months
  if (!assertPublicMonthAllowed(month)) {
    return NextResponse.json<ErrorJson>(
      { error: "Month not available." },
      { status: 403 },
    );
  }

  const resolved = await resolveOrgByToken(token);
  if (!resolved.ok)
    return NextResponse.json<ErrorJson>(
      { error: resolved.error },
      { status: resolved.status },
    );

  // Ensure current month exists
  const ensured = await ensureScheduleMonth(resolved.org_id, month);
  if (!ensured.ok)
    return NextResponse.json<ErrorJson>(
      { error: ensured.error },
      { status: 400 },
    );

  if (!ensured.monthRow.is_public_visible) {
    return NextResponse.json<ErrorJson>(
      { error: "Month not available." },
      { status: 404 },
    );
  }

  const monthId = ensured.monthRow.id;

  const [{ data: approved, error: aErr }, { data: pendingRows, error: pErr }] =
    await Promise.all([
      supabaseAdmin
        .from("schedule_entries")
        .select(
          "id,date,service_category_id,department_category_id,role,name,notes",
        )
        .eq("org_id", resolved.org_id)
        .eq("month_id", monthId)
        .eq("status", "approved")
        .order("date", { ascending: true }),

      supabaseAdmin
        .from("schedule_entries")
        .select("date")
        .eq("org_id", resolved.org_id)
        .eq("month_id", monthId)
        .eq("status", "pending"),
    ]);

  if (aErr)
    return NextResponse.json<ErrorJson>(
      { error: aErr.message },
      { status: 400 },
    );
  if (pErr)
    return NextResponse.json<ErrorJson>(
      { error: pErr.message },
      { status: 400 },
    );

  const counts = new Map<string, number>();
  for (const r of pendingRows ?? []) {
    const d = String(r.date);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }

  const out: PublicMonthResponse = {
    ok: true,
    month: {
      month: ensured.monthRow.month,
      draft_open: ensured.monthRow.draft_open,
      is_public_visible: ensured.monthRow.is_public_visible,
      edits_open: Boolean((ensured.monthRow as { edits_open?: unknown }).edits_open),
    },
    approved: (approved ?? []).map((r) => ({
      id: String(r.id),
      date: String(r.date),
      service_category_id: r.service_category_id
        ? String(r.service_category_id)
        : null,
      department_category_id: r.department_category_id
        ? String(r.department_category_id)
        : null,
      role: r.role,
      name: String(r.name),
      notes: r.notes ? String(r.notes) : null,
    })),
    pending_counts: Array.from(counts.entries()).map(([date, count]) => ({
      date,
      count,
    })),
  };

  return NextResponse.json(out);
}
