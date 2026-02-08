import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveOrgByToken } from "@/lib/schedule/public";
import { cleanStr, isRole, isYYYYMM } from "@/lib/schedule/util";
import { ensureScheduleMonth } from "@/lib/schedule/admin";
import type { ScheduleRole } from "@/lib/schedule/types";

type ErrorJson = { error: string };
type Status = "pending" | "approved" | "rejected";

function isStatus(v: unknown): v is Status {
  return v === "pending" || v === "approved" || v === "rejected";
}

export async function PATCH(req: Request) {
  const bodyUnknown: unknown = await req.json().catch(() => null);
  if (!bodyUnknown || typeof bodyUnknown !== "object") {
    return NextResponse.json<ErrorJson>({ error: "Invalid payload" }, { status: 400 });
  }
  const body = bodyUnknown as Record<string, unknown>;

  const token = cleanStr(body.token);
  const month = cleanStr(body.month);
  const entryId = cleanStr(body.entry_id);
  const monthCode = cleanStr(body.month_code);

  const nextStatus = body.status;
  const patch = body.patch;

  if (!token) return NextResponse.json<ErrorJson>({ error: "Missing token" }, { status: 400 });
  if (!month || !isYYYYMM(month)) return NextResponse.json<ErrorJson>({ error: "Invalid month" }, { status: 400 });
  if (!entryId) return NextResponse.json<ErrorJson>({ error: "Missing entry_id" }, { status: 400 });
  if (!monthCode) return NextResponse.json<ErrorJson>({ error: "Missing month_code" }, { status: 400 });

  const resolved = await resolveOrgByToken(token);
  if (!resolved.ok) return NextResponse.json<ErrorJson>({ error: resolved.error }, { status: resolved.status });

  const ensured = await ensureScheduleMonth(resolved.org_id, month);
  if (!ensured.ok) return NextResponse.json<ErrorJson>({ error: ensured.error }, { status: 400 });

  if (!ensured.monthRow.edits_open) {
    return NextResponse.json<ErrorJson>({ error: "Edits are not enabled for this month." }, { status: 409 });
  }

  // verify code
  const { data: ok, error: vErr } = await supabaseAdmin.rpc("schedule_verify_month_code", {
    p_org_id: resolved.org_id,
    p_month: month,
    p_code: monthCode,
  });
  if (vErr) return NextResponse.json<ErrorJson>({ error: vErr.message }, { status: 400 });
  if (!ok) return NextResponse.json<ErrorJson>({ error: "Invalid code." }, { status: 403 });

  // Build update payload (status + optional edits)
  const update: Record<string, unknown> = {};

  if (Object.prototype.hasOwnProperty.call(body, "status")) {
    if (!isStatus(nextStatus)) {
      return NextResponse.json<ErrorJson>({ error: "Invalid status" }, { status: 400 });
    }
    update.status = nextStatus;
  }

  if (patch && typeof patch === "object") {
    const p = patch as Record<string, unknown>;

    if (Object.prototype.hasOwnProperty.call(p, "name")) {
      const name = cleanStr(p.name);
      if (!name) return NextResponse.json<ErrorJson>({ error: "name cannot be empty" }, { status: 400 });
      update.name = name;
    }
    if (Object.prototype.hasOwnProperty.call(p, "notes")) {
      const notes = cleanStr(p.notes);
      update.notes = notes ? notes : null;
    }
    if (Object.prototype.hasOwnProperty.call(p, "role")) {
      if (!isRole(p.role)) return NextResponse.json<ErrorJson>({ error: "Invalid role" }, { status: 400 });
      update.role = p.role as ScheduleRole;
    }
    if (Object.prototype.hasOwnProperty.call(p, "service_category_id")) {
      const v = cleanStr(p.service_category_id);
      update.service_category_id = v ? v : null;
    }
    if (Object.prototype.hasOwnProperty.call(p, "department_category_id")) {
      const v = cleanStr(p.department_category_id);
      update.department_category_id = v ? v : null;
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json<ErrorJson>({ error: "No changes provided" }, { status: 400 });
  }

  const { data: updated, error: uErr } = await supabaseAdmin
    .from("schedule_entries")
    .update(update)
    .eq("org_id", resolved.org_id)
    .eq("id", entryId)
    .select("id,status,date,role,name,notes,service_category_id,department_category_id")
    .single();

  if (uErr) return NextResponse.json<ErrorJson>({ error: uErr.message }, { status: 400 });

  return NextResponse.json({
    ok: true,
    entry: {
      id: String(updated.id),
      status: String(updated.status),
      date: String(updated.date),
      role: updated.role,
      name: String(updated.name),
      notes: updated.notes ? String(updated.notes) : null,
      service_category_id: updated.service_category_id ? String(updated.service_category_id) : null,
      department_category_id: updated.department_category_id ? String(updated.department_category_id) : null,
    },
  });
}
