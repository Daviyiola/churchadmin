import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveOrgByToken } from "@/lib/schedule/public";
import { cleanStr, isYYYYMM, isYYYYMMDD } from "@/lib/schedule/util";
import { assertPublicMonthAllowed, getPublicAllowedMonth } from "@/lib/schedule/public_rules";
import { ensureScheduleMonth } from "@/lib/schedule/admin";

type ErrorJson = { error: string };

function isInMonth(date: string, month: string) {
  return date.startsWith(`${month}-`);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const token = cleanStr(searchParams.get("token"));
  const monthRaw = cleanStr(searchParams.get("month"));
  const date = cleanStr(searchParams.get("date"));

  if (!token) return NextResponse.json<ErrorJson>({ error: "Missing token" }, { status: 400 });

  const month = monthRaw && isYYYYMM(monthRaw) ? monthRaw : getPublicAllowedMonth();
  if (!assertPublicMonthAllowed(month)) {
    return NextResponse.json<ErrorJson>({ error: "Month not available." }, { status: 403 });
  }

  if (!date || !isYYYYMMDD(date) || !isInMonth(date, month)) {
    return NextResponse.json<ErrorJson>({ error: "Invalid date" }, { status: 400 });
  }

  const resolved = await resolveOrgByToken(token);
  if (!resolved.ok) {
    return NextResponse.json<ErrorJson>({ error: resolved.error }, { status: resolved.status });
  }

  const ensured = await ensureScheduleMonth(resolved.org_id, month);
  if (!ensured.ok) return NextResponse.json<ErrorJson>({ error: ensured.error }, { status: 400 });

  if (!ensured.monthRow.is_public_visible) {
    return NextResponse.json<ErrorJson>({ error: "Month not available." }, { status: 404 });
  }

  const monthId = ensured.monthRow.id;

  const { data: rows, error } = await supabaseAdmin
    .from("schedule_entries")
    .select("id,date,service_category_id,department_category_id,role,name,notes,status,created_at")
    .eq("org_id", resolved.org_id)
    .eq("month_id", monthId)
    .eq("date", date)
    .in("status", ["approved", "pending", "rejected"])
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json<ErrorJson>({ error: error.message }, { status: 400 });

  const approved = (rows ?? []).filter((r) => r.status === "approved");
  const pending = (rows ?? []).filter((r) => r.status === "pending");
  const rejected = (rows ?? []).filter((r) => r.status === "rejected");

  return NextResponse.json({
    ok: true,
    month: {
      month: ensured.monthRow.month,
      draft_open: Boolean(ensured.monthRow.draft_open),
      edits_open: Boolean(ensured.monthRow.edits_open),
      is_public_visible: Boolean(ensured.monthRow.is_public_visible),
    },
    approved: approved.map((r) => ({
      id: String(r.id),
      date: String(r.date),
      service_category_id: r.service_category_id ? String(r.service_category_id) : null,
      department_category_id: r.department_category_id ? String(r.department_category_id) : null,
      role: r.role,
      name: String(r.name),
      notes: r.notes ? String(r.notes) : null,
      created_at: String(r.created_at),
    })),
    pending: pending.map((r) => ({
      id: String(r.id),
      date: String(r.date),
      service_category_id: r.service_category_id ? String(r.service_category_id) : null,
      department_category_id: r.department_category_id ? String(r.department_category_id) : null,
      role: r.role,
      name: String(r.name),
      notes: r.notes ? String(r.notes) : null,
      created_at: String(r.created_at),
    })),
    rejected: rejected.map((r) => ({
      id: String(r.id),
      date: String(r.date),
      service_category_id: r.service_category_id ? String(r.service_category_id) : null,
      department_category_id: r.department_category_id ? String(r.department_category_id) : null,
      role: r.role,
      name: String(r.name),
      notes: r.notes ? String(r.notes) : null,
      created_at: String(r.created_at),
    })),
  });
}
