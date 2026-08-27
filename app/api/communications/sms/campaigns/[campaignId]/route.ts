import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireSmsOperator, smsRouteError } from "@/lib/server/sms/auth";
import { estimateSmsSegments } from "@/lib/sms/segments";
import { SMS_PURPOSES } from "@/lib/sms/types";

export const runtime = "nodejs";
type Context = { params: Promise<{ campaignId: string }> };

export async function GET(req: Request, context: Context) {
  try {
    const orgId = new URL(req.url).searchParams.get("organization_id")?.trim() ?? "";
    const { campaignId } = await context.params;
    if (!orgId) throw new Error("organization_id required");
    await requireSmsOperator(req, orgId);
    const { data, error } = await supabaseAdmin.from("sms_campaigns").select("*").eq("org_id", orgId).eq("id", campaignId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw Object.assign(new Error("SMS campaign not found."), { status: 404 });
    return NextResponse.json({ campaign: data });
  } catch (error) { const result = smsRouteError(error); return NextResponse.json({ error: result.message }, { status: result.status }); }
}

export async function PATCH(req: Request, context: Context) {
  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    const orgId = String(body?.organization_id ?? "").trim();
    const { campaignId } = await context.params;
    if (!orgId || !body) throw new Error("Invalid campaign request.");
    const actor = await requireSmsOperator(req, orgId);
    const update: Record<string, unknown> = { updated_by: actor.userId, updated_at: new Date().toISOString() };
    if ("title" in body) update.title = String(body.title ?? "").trim().slice(0, 120) || "Untitled SMS campaign";
    if ("body_text" in body) {
      const text = String(body.body_text ?? "");
      if (Array.from(text).length > 1600) throw new Error("SMS messages are limited to 1,600 characters.");
      const estimate = estimateSmsSegments(text);
      Object.assign(update, { body_text: text, message_encoding: estimate.encoding, character_count: estimate.characters, segments_per_recipient: estimate.segments, latest_snapshot_id: null });
    }
    if ("purpose" in body) {
      if (!SMS_PURPOSES.includes(body.purpose as never)) throw new Error("Choose a valid campaign purpose.");
      update.purpose = body.purpose;
    }
    if ("audience_criteria" in body && body.audience_criteria && typeof body.audience_criteria === "object") { update.audience_criteria = body.audience_criteria; update.latest_snapshot_id = null; }
    if ("scheduled_for" in body) {
      update.scheduled_for = body.scheduled_for ? String(body.scheduled_for) : null;
      update.status = body.scheduled_for ? "schedule_intent" : "draft";
      update.timezone_name = body.timezone_name ? String(body.timezone_name) : null;
    }
    const { data, error } = await supabaseAdmin.from("sms_campaigns").update(update).eq("org_id", orgId).eq("id", campaignId).neq("status", "archived").select("*").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw Object.assign(new Error("SMS campaign not found."), { status: 404 });
    return NextResponse.json({ campaign: data, sending_enabled: false });
  } catch (error) { const result = smsRouteError(error); return NextResponse.json({ error: result.message }, { status: result.status }); }
}

export async function DELETE(req: Request, context: Context) {
  try {
    const orgId = new URL(req.url).searchParams.get("organization_id")?.trim() ?? "";
    const { campaignId } = await context.params;
    if (!orgId) throw new Error("organization_id required");
    const actor = await requireSmsOperator(req, orgId);
    const { error } = await supabaseAdmin.from("sms_campaigns").update({ status: "archived", archived_at: new Date().toISOString(), updated_at: new Date().toISOString(), updated_by: actor.userId }).eq("org_id", orgId).eq("id", campaignId);
    if (error) throw new Error(error.message);
    return NextResponse.json({ archived: true });
  } catch (error) { const result = smsRouteError(error); return NextResponse.json({ error: result.message }, { status: result.status }); }
}
