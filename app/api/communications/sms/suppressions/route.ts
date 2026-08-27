import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizeUsSmsPhone } from "@/lib/sms/phone";
import { requireSmsOperator, smsRouteError } from "@/lib/server/sms/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    const orgId = String(body?.organization_id ?? "").trim();
    const phone = normalizeUsSmsPhone(body?.phone);
    if (!orgId || !phone.ok) throw new Error("Choose a valid US phone number to suppress.");
    const actor = await requireSmsOperator(req, orgId);
    const row = {
      org_id: orgId, phone_e164: phone.e164, source: "staff",
      reason: String(body?.reason ?? "Blocked during SMS audience review").trim().slice(0, 500),
      suppressed_by: actor.userId, suppressed_at: new Date().toISOString(), released_at: null, released_by: null,
    };
    const { data: existing, error: lookupError } = await supabaseAdmin.from("sms_suppressions").select("id")
      .eq("org_id", orgId).eq("phone_e164", phone.e164).is("released_at", null).maybeSingle<{ id: string }>();
    if (lookupError) throw new Error(lookupError.message);
    const operation = existing
      ? supabaseAdmin.from("sms_suppressions").update(row).eq("id", existing.id)
      : supabaseAdmin.from("sms_suppressions").insert(row);
    const { data, error } = await operation.select("id,phone_e164,suppressed_at").single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ suppression: data });
  } catch (error) {
    const result = smsRouteError(error);
    return NextResponse.json({ error: result.message }, { status: result.status });
  }
}
