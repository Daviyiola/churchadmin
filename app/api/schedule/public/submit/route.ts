// app/api/schedule/public/submit/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveOrgByToken } from "@/lib/schedule/public";
import { cleanStr, isRole, isYYYYMM, isYYYYMMDD } from "@/lib/schedule/util";
import {
  assertPublicMonthAllowed,
  getPublicAllowedMonth,
} from "@/lib/schedule/public_rules";
import { ensureScheduleMonth } from "@/lib/schedule/admin";
import type { ScheduleRole } from "@/lib/schedule/types";

type ErrorJson = { error: string };

function isInMonth(date: string, month: string) {
  return date.startsWith(`${month}-`);
}

export async function POST(req: Request) {
  const bodyUnknown: unknown = await req.json().catch(() => null);
  if (!bodyUnknown || typeof bodyUnknown !== "object") {
    return NextResponse.json<ErrorJson>(
      { error: "Invalid payload" },
      { status: 400 },
    );
  }
  const body = bodyUnknown as Record<string, unknown>;

  const token = cleanStr(body.token);
  const monthRaw = cleanStr(body.month);
  const date = cleanStr(body.date);
  const name = cleanStr(body.name);
  const notes = cleanStr(body.notes);
  const roleRaw = body.role;

  const service_category_id = cleanStr(body.service_category_id);
  const department_category_id = cleanStr(body.department_category_id);

  // ✅ new: optional month edit code
  const monthCode = cleanStr(body.month_code);

  if (!token)
    return NextResponse.json<ErrorJson>(
      { error: "Missing token" },
      { status: 400 },
    );

  const month =
    monthRaw && isYYYYMM(monthRaw) ? monthRaw : getPublicAllowedMonth();
  if (!assertPublicMonthAllowed(month)) {
    return NextResponse.json<ErrorJson>(
      { error: "Month not available." },
      { status: 403 },
    );
  }

  if (!date || !isYYYYMMDD(date) || !isInMonth(date, month))
    return NextResponse.json<ErrorJson>(
      { error: "Invalid date" },
      { status: 400 },
    );

  if (!isRole(roleRaw))
    return NextResponse.json<ErrorJson>(
      { error: "Invalid role" },
      { status: 400 },
    );
  const role: ScheduleRole = roleRaw;

  if (!name)
    return NextResponse.json<ErrorJson>(
      { error: "Name is required." },
      { status: 400 },
    );

  const resolved = await resolveOrgByToken(token);
  if (!resolved.ok)
    return NextResponse.json<ErrorJson>(
      { error: resolved.error },
      { status: resolved.status },
    );

  const ensured = await ensureScheduleMonth(resolved.org_id, month);
  if (!ensured.ok)
    return NextResponse.json<ErrorJson>(
      { error: ensured.error },
      { status: 400 },
    );

  if (!ensured.monthRow.draft_open) {
    return NextResponse.json<ErrorJson>(
      { error: "Sign-ups are closed for this month." },
      { status: 409 },
    );
  }

  if (!ensured.monthRow.is_public_visible) {
    return NextResponse.json<ErrorJson>(
      { error: "Month not available." },
      { status: 404 },
    );
  }

  // ✅ Decide pending vs approved based on edits_open + correct code
  const editsOpen = Boolean(
    (ensured.monthRow as { edits_open?: unknown }).edits_open,
  );

  let codeOk = false;

  if (editsOpen && monthCode) {
    const { data: ok, error: vErr } = await supabaseAdmin.rpc(
      "schedule_verify_month_code",
      {
        p_org_id: resolved.org_id,
        p_month: month,
        p_code: monthCode,
      },
    );
// console.log("[public-submit] verify rpc", { ok, vErr: vErr?.message ?? null });

    if (!vErr) codeOk = Boolean(ok);
  }

//   console.log("[public-submit]", {
//   org: resolved.org_id,
//   month,
//   date,
//   draft_open: ensured.monthRow.draft_open,
//   edits_open: (ensured.monthRow as { edits_open?: unknown }).edits_open,
//   got_code: Boolean(monthCode),
//   code_len: monthCode?.length ?? 0,
// });


  const status: "pending" | "approved" =
    ensured.monthRow.draft_open && editsOpen && codeOk ? "approved" : "pending";
    // console.log("[public-submit] status", { status });

    
  const { error: insErr } = await supabaseAdmin
    .from("schedule_entries")
    .insert({
      org_id: resolved.org_id,
      month_id: ensured.monthRow.id,
      date,
      role,
      name,
      notes: notes ? notes : null,
      service_category_id: service_category_id ? service_category_id : null,
      department_category_id: department_category_id
        ? department_category_id
        : null,
      status, 
      created_by: null,
    });

  if (insErr)
    return NextResponse.json<ErrorJson>(
      { error: insErr.message },
      { status: 400 },
    );

  return NextResponse.json({ ok: true });
}
