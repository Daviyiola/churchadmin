import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireActorId } from "@/lib/server/authUser";
import { requireOrgOperator } from "@/lib/schedule/admin_auth";
import { ensureScheduleMonth } from "@/lib/schedule/admin";
import {
  cleanStr,
  isRole,
  isStatus,
  isYYYYMM,
  isYYYYMMDD,
} from "@/lib/schedule/util";
import type {
  AdminEntryPatchBody,
  ScheduleRole,
  ScheduleStatus,
} from "@/lib/schedule/types";

type ErrorJson = { error: string };

function isInMonth(date: string, month: string) {
  return date.startsWith(`${month}-`);
}

function monthFromDate(date: string) {
  return date.slice(0, 7); // YYYY-MM
}

/** =========================
 *  POST /api/schedule/admin/entry
 *  Insert an entry directly (default approved)
 *  ========================= */

type AdminEntryCreateBody = {
  org_id: string;
  month: string; // YYYY-MM
  date: string; // YYYY-MM-DD
  service_category_id: string | null;
  department_category_id: string | null;
  role: ScheduleRole;
  name: string;
  notes: string | null;
  status?: ScheduleStatus; // optional override; default approved
};

export async function POST(req: Request) {
  try {
    const actorId = await requireActorId(req);

    const bodyUnknown: unknown = await req.json().catch(() => null);
    if (!bodyUnknown || typeof bodyUnknown !== "object") {
      return NextResponse.json<ErrorJson>({ error: "Invalid payload" }, { status: 400 });
    }
    const body = bodyUnknown as Record<string, unknown>;

    const orgId = cleanStr(body.org_id);
    const month = cleanStr(body.month);
    const date = cleanStr(body.date);

    const name = cleanStr(body.name);
    const notesRaw = cleanStr(body.notes);

    const serviceId = cleanStr(body.service_category_id);
    const deptId = cleanStr(body.department_category_id);

    const roleRaw = body.role;
    const statusRaw = body.status;

    if (!orgId) return NextResponse.json<ErrorJson>({ error: "Missing org_id" }, { status: 400 });
    if (!month || !isYYYYMM(month)) {
      return NextResponse.json<ErrorJson>({ error: "Invalid month" }, { status: 400 });
    }

    if (!date || !isYYYYMMDD(date) || !isInMonth(date, month)) {
      return NextResponse.json<ErrorJson>({ error: "Invalid date" }, { status: 400 });
    }

    if (!isRole(roleRaw)) {
      return NextResponse.json<ErrorJson>({ error: "Invalid role" }, { status: 400 });
    }
    const role: ScheduleRole = roleRaw;

    if (!name) {
      return NextResponse.json<ErrorJson>({ error: "Name is required." }, { status: 400 });
    }

    const status: ScheduleStatus =
      typeof statusRaw === "undefined"
        ? "approved"
        : isStatus(statusRaw)
          ? statusRaw
          : "approved";

    const perm = await requireOrgOperator(actorId, orgId);
    if (!perm.ok) {
      return NextResponse.json<ErrorJson>({ error: perm.error }, { status: perm.status });
    }

    // Ensure month exists so admin month navigation never breaks
    const ensured = await ensureScheduleMonth(orgId, month, actorId);

    if (!ensured.ok) {
      return NextResponse.json<ErrorJson>({ error: ensured.error }, { status: 400 });
    }

    const insertPayload: AdminEntryCreateBody = {
      org_id: orgId,
      month: ensured.monthRow.month,
      date,
      service_category_id: serviceId ? serviceId : null,
      department_category_id: deptId ? deptId : null,
      role,
      name,
      notes: notesRaw ? notesRaw : null,
      status,
    };

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("schedule_entries")
      .insert({
        org_id: insertPayload.org_id,
        month_id: ensured.monthRow.id,
        date: insertPayload.date,
        service_category_id: insertPayload.service_category_id,
        department_category_id: insertPayload.department_category_id,
        role: insertPayload.role,
        name: insertPayload.name,
        notes: insertPayload.notes,
        status: insertPayload.status ?? "approved",
        created_by: actorId,
      })
      .select("id,date,service_category_id,department_category_id,role,name,notes,status,created_at")
      .single();

    if (insErr) return NextResponse.json<ErrorJson>({ error: insErr.message }, { status: 400 });

    return NextResponse.json({
      ok: true,
      entry: {
        id: String(inserted.id),
        date: String(inserted.date),
        service_category_id: inserted.service_category_id ? String(inserted.service_category_id) : null,
        department_category_id: inserted.department_category_id ? String(inserted.department_category_id) : null,
        role: inserted.role,
        name: String(inserted.name),
        notes: inserted.notes ? String(inserted.notes) : null,
        status: inserted.status,
        created_at: String(inserted.created_at),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    if (msg === "UNAUTHORIZED") {
      return NextResponse.json<ErrorJson>({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json<ErrorJson>({ error: msg }, { status: 400 });
  }
}

/** =========================
 *  PATCH /api/schedule/admin/entry
 *  Patch an existing entry
 *  Updates month_id when date changes
 *  ========================= */

export async function PATCH(req: Request) {
  try {
    const actorId = await requireActorId(req);

    const bodyUnknown: unknown = await req.json().catch(() => null);
    if (!bodyUnknown || typeof bodyUnknown !== "object") {
      return NextResponse.json<ErrorJson>({ error: "Invalid payload" }, { status: 400 });
    }
    const body = bodyUnknown as Record<string, unknown>;

    const orgId = cleanStr(body.org_id);
    const entryId = cleanStr(body.entry_id);

    if (!orgId) return NextResponse.json<ErrorJson>({ error: "Missing org_id" }, { status: 400 });
    if (!entryId) return NextResponse.json<ErrorJson>({ error: "Missing entry_id" }, { status: 400 });

    const perm = await requireOrgOperator(actorId, orgId);
    if (!perm.ok) return NextResponse.json<ErrorJson>({ error: perm.error }, { status: perm.status });

    const patch: Partial<AdminEntryPatchBody> = { org_id: orgId, entry_id: entryId };
    const patchExtra: Record<string, unknown> = {}; // for fields not in AdminEntryPatchBody (e.g. month_id)

    if (Object.prototype.hasOwnProperty.call(body, "status")) {
      if (!isStatus(body.status)) {
        return NextResponse.json<ErrorJson>({ error: "Invalid status" }, { status: 400 });
      }
      patch.status = body.status as ScheduleStatus;
    }

    if (Object.prototype.hasOwnProperty.call(body, "role")) {
      if (!isRole(body.role)) {
        return NextResponse.json<ErrorJson>({ error: "Invalid role" }, { status: 400 });
      }
      patch.role = body.role as ScheduleRole;
    }

    if (Object.prototype.hasOwnProperty.call(body, "name")) {
      const nm = cleanStr(body.name);
      if (!nm) return NextResponse.json<ErrorJson>({ error: "Name cannot be empty" }, { status: 400 });
      patch.name = nm;
    }

    if (Object.prototype.hasOwnProperty.call(body, "notes")) {
      const n = cleanStr(body.notes);
      patch.notes = n ? n : null;
    }

    if (Object.prototype.hasOwnProperty.call(body, "date")) {
      const d = cleanStr(body.date);
      if (!d || !isYYYYMMDD(d)) {
        return NextResponse.json<ErrorJson>({ error: "Invalid date" }, { status: 400 });
      }

      const newMonth = monthFromDate(d);
      if (!isYYYYMM(newMonth)) {
        return NextResponse.json<ErrorJson>({ error: "Invalid month derived from date" }, { status: 400 });
      }

      // Ensure month exists & update month_id to match the new date
     const ensured = await ensureScheduleMonth(orgId, newMonth, actorId);

      if (!ensured.ok) {
        return NextResponse.json<ErrorJson>({ error: ensured.error }, { status: 400 });
      }

      patch.date = d;
      patchExtra.month_id = ensured.monthRow.id;
    }

    if (Object.prototype.hasOwnProperty.call(body, "service_category_id")) {
      const v = cleanStr(body.service_category_id);
      patch.service_category_id = v ? v : null;
    }

    if (Object.prototype.hasOwnProperty.call(body, "department_category_id")) {
      const v = cleanStr(body.department_category_id);
      patch.department_category_id = v ? v : null;
    }

    // Build update payload: patch (typed) + patchExtra (untyped extras like month_id)
    const updatePayload: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(patch)) {
      if (k === "org_id" || k === "entry_id") continue;
      if (typeof v === "undefined") continue;
      updatePayload[k] = v;
    }

    for (const [k, v] of Object.entries(patchExtra)) {
      if (typeof v === "undefined") continue;
      updatePayload[k] = v;
    }

    if (Object.keys(updatePayload).length === 0) {
      return NextResponse.json<ErrorJson>({ error: "No changes provided" }, { status: 400 });
    }

    // Only update within the org boundary
    const { data: updated, error: uErr } = await supabaseAdmin
      .from("schedule_entries")
      .update(updatePayload)
      .eq("id", entryId)
      .eq("org_id", orgId)
      .select("id,date,service_category_id,department_category_id,role,name,notes,status,created_at")
      .single();

    if (uErr) return NextResponse.json<ErrorJson>({ error: uErr.message }, { status: 400 });

    return NextResponse.json({
      ok: true,
      entry: {
        id: String(updated.id),
        date: String(updated.date),
        service_category_id: updated.service_category_id ? String(updated.service_category_id) : null,
        department_category_id: updated.department_category_id ? String(updated.department_category_id) : null,
        role: updated.role,
        name: String(updated.name),
        notes: updated.notes ? String(updated.notes) : null,
        status: updated.status,
        created_at: String(updated.created_at),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    if (msg === "UNAUTHORIZED") {
      return NextResponse.json<ErrorJson>({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json<ErrorJson>({ error: msg }, { status: 400 });
  }
}
