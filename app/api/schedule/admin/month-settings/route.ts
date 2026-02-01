import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireActorId } from "@/lib/server/authUser";
import { cleanStr, isYYYYMM } from "@/lib/schedule/util";
import { ensureScheduleMonth } from "@/lib/schedule/admin";
import { requireOrgOperator } from "@/lib/schedule/admin_auth";
import type { AdminMonthSettingsPatchBody } from "@/lib/schedule/types";

type ErrorJson = { error: string };

function isBool(v: unknown): v is boolean {
  return v === true || v === false;
}

export async function PATCH(req: Request) {
  try {
    const actorId = await requireActorId(req);

    const bodyUnknown: unknown = await req.json().catch(() => null);
    if (!bodyUnknown || typeof bodyUnknown !== "object") {
      return NextResponse.json<ErrorJson>({ error: "Invalid payload" }, { status: 400 });
    }
    const body = bodyUnknown as Record<string, unknown>;

    const orgId = cleanStr(body.org_id);
    const month = cleanStr(body.month);

    if (!orgId) return NextResponse.json<ErrorJson>({ error: "Missing org_id" }, { status: 400 });
    if (!month || !isYYYYMM(month))
      return NextResponse.json<ErrorJson>({ error: "Invalid month" }, { status: 400 });

    const perm = await requireOrgOperator(actorId, orgId);
    if (!perm.ok) return NextResponse.json<ErrorJson>({ error: perm.error }, { status: perm.status });

    // Ensure month exists
   const ensured = await ensureScheduleMonth(orgId, month, actorId);

    if (!ensured.ok) return NextResponse.json<ErrorJson>({ error: ensured.error }, { status: 400 });

    const patch: Partial<Pick<AdminMonthSettingsPatchBody, "draft_open" | "is_public_visible">> = {};

    if (Object.prototype.hasOwnProperty.call(body, "draft_open")) {
      if (!isBool(body.draft_open)) {
        return NextResponse.json<ErrorJson>({ error: "draft_open must be boolean" }, { status: 400 });
      }
      patch.draft_open = body.draft_open;
    }

    if (Object.prototype.hasOwnProperty.call(body, "is_public_visible")) {
      if (!isBool(body.is_public_visible)) {
        return NextResponse.json<ErrorJson>({ error: "is_public_visible must be boolean" }, { status: 400 });
      }
      patch.is_public_visible = body.is_public_visible;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json<ErrorJson>({ error: "No changes provided" }, { status: 400 });
    }

    const { data: updated, error: uErr } = await supabaseAdmin
      .from("schedule_months")
      .update(patch)
      .eq("id", ensured.monthRow.id)
      .select("id,month,draft_open,is_public_visible")
      .single();

    if (uErr) return NextResponse.json<ErrorJson>({ error: uErr.message }, { status: 400 });

    return NextResponse.json({
      ok: true,
      month: {
        id: String(updated.id),
        month: String(updated.month),
        draft_open: Boolean(updated.draft_open),
        is_public_visible: Boolean(updated.is_public_visible),
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
