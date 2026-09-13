import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizeUsSmsPhone } from "@/lib/sms/phone";
import { parsePermissionInput } from "@/lib/sms/permissions";
import { getSmsPermissionEvents } from "@/lib/server/sms/permissions";
import { requireSmsOperator, smsRouteError } from "@/lib/server/sms/auth";

export const runtime = "nodejs";
function failure(error: unknown) {
  const result = smsRouteError(error);
  return NextResponse.json({ error: result.message }, { status: result.status });
}
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const orgId = url.searchParams.get("organization_id") ?? "";
    if (!orgId) throw new Error("Choose an organization.");
    await requireSmsOperator(req, orgId);
    const phone = normalizeUsSmsPhone(url.searchParams.get("phone"));
    if (!phone.ok) throw new Error("Choose a valid phone number.");
    const [events, suppression] = await Promise.all([
      getSmsPermissionEvents(orgId, phone.e164),
      supabaseAdmin.from("sms_suppressions").select("id,source,suppressed_at").eq("org_id", orgId).eq("phone_e164", phone.e164).is("released_at", null).maybeSingle(),
    ]);
    if (suppression.error) throw new Error(suppression.error.message);
    return NextResponse.json({ events, suppression: suppression.data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
export async function POST(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const orgId = String(body?.organization_id ?? "").trim();
    if (!orgId) throw new Error("Choose an organization.");
    const actor = await requireSmsOperator(req, orgId);
    const input = parsePermissionInput(body);
    const { data, error } = await supabaseAdmin.from("sms_permission_events")
      .insert({ ...input, org_id: orgId, recorded_by: actor.userId }).select("id").single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ event: data });
  } catch (error) { return failure(error); }
}
