import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireSmsOperator, smsRouteError } from "@/lib/server/sms/auth";
import { estimateSmsSegments } from "@/lib/sms/segments";
import { SMS_PURPOSES } from "@/lib/sms/types";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const orgId = new URL(req.url).searchParams.get("organization_id")?.trim() ?? "";
    if (!orgId) throw new Error("organization_id required");
    await requireSmsOperator(req, orgId);
    const { data, error } = await supabaseAdmin.from("sms_campaigns").select("*").eq("org_id", orgId).order("updated_at", { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    return NextResponse.json({ campaigns: data ?? [] });
  } catch (error) { const result = smsRouteError(error); return NextResponse.json({ error: result.message }, { status: result.status }); }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    const orgId = String(body?.organization_id ?? "").trim();
    if (!orgId) throw new Error("organization_id required");
    const actor = await requireSmsOperator(req, orgId);
    const text = String(body?.body_text ?? "").slice(0, 1600);
    const purpose = SMS_PURPOSES.includes(body?.purpose as never) ? body?.purpose : "announcement";
    const estimate = estimateSmsSegments(text);
    const { data, error } = await supabaseAdmin.from("sms_campaigns").insert({
      org_id: orgId, title: String(body?.title ?? "Untitled SMS campaign").trim().slice(0, 120) || "Untitled SMS campaign",
      body_text: text, purpose, message_encoding: estimate.encoding, character_count: estimate.characters,
      segments_per_recipient: estimate.segments, created_by: actor.userId, updated_by: actor.userId,
    }).select("*").single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ campaign: data }, { status: 201 });
  } catch (error) { const result = smsRouteError(error); return NextResponse.json({ error: result.message }, { status: result.status }); }
}
