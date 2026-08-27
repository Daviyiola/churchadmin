import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireSmsOperator, smsRouteError } from "@/lib/server/sms/auth";
import { resolveSmsAudience } from "@/lib/server/sms/audienceResolver";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    const orgId = String(body?.organization_id ?? "").trim();
    const campaignId = String(body?.campaign_id ?? "").trim();
    const message = String(body?.message ?? "");
    if (!orgId || !campaignId || !message.trim()) throw new Error("Organization, campaign, and message are required.");
    const actor = await requireSmsOperator(req, orgId);
    const { data: campaign, error: campaignError } = await supabaseAdmin.from("sms_campaigns").select("id").eq("id", campaignId).eq("org_id", orgId).neq("status", "archived").maybeSingle();
    if (campaignError) throw new Error(campaignError.message);
    if (!campaign) throw Object.assign(new Error("SMS campaign not found."), { status: 404 });
    const resolved = await resolveSmsAudience(orgId, body?.criteria, message);
    if (!resolved.recipients.length) throw new Error("No eligible SMS recipients were found.");
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const { data: snapshot, error: snapshotError } = await supabaseAdmin.from("sms_audience_snapshots").insert({
      org_id: orgId, campaign_id: campaignId, created_by: actor.userId, criteria: resolved.criteria,
      source_counts: resolved.source_counts, eligible_count: resolved.eligible_count,
      invalid_count: resolved.invalid_count, missing_count: resolved.missing_count,
      suppressed_count: resolved.suppressed_count, duplicate_count: resolved.duplicate_count,
      body_hash: resolved.body_hash, character_count: resolved.character_count,
      message_encoding: resolved.message_encoding, max_segments_per_recipient: resolved.max_segments_per_recipient,
      estimated_total_segments: resolved.estimated_total_segments, expires_at: expiresAt,
    }).select("id").single<{ id: string }>();
    if (snapshotError) throw new Error(snapshotError.message);
    try {
      for (let offset = 0; offset < resolved.recipients.length; offset += 500) {
        const { error } = await supabaseAdmin.from("sms_audience_snapshot_recipients").insert(resolved.recipients.slice(offset, offset + 500).map((recipient) => ({ snapshot_id: snapshot.id, org_id: orgId, ...recipient })));
        if (error) throw new Error(error.message);
      }
      const { error: updateError } = await supabaseAdmin.from("sms_campaigns").update({
        latest_snapshot_id: snapshot.id, audience_criteria: resolved.criteria,
        message_encoding: resolved.message_encoding, character_count: resolved.character_count,
        segments_per_recipient: resolved.max_segments_per_recipient,
        estimated_total_segments: resolved.estimated_total_segments,
        updated_by: actor.userId, updated_at: new Date().toISOString(),
      }).eq("id", campaignId).eq("org_id", orgId);
      if (updateError) throw new Error(updateError.message);
      const { error: usageError } = await supabaseAdmin.from("sms_usage_ledger").insert({
        org_id: orgId, campaign_id: campaignId, event_type: "estimated",
        segments: resolved.estimated_total_segments,
        metadata: { snapshot_id: snapshot.id, eligible_count: resolved.eligible_count, encoding: resolved.message_encoding },
      });
      if (usageError) throw new Error(usageError.message);
    } catch (error) {
      await supabaseAdmin.from("sms_audience_snapshots").delete().eq("id", snapshot.id);
      throw error;
    }
    return NextResponse.json({ snapshot_id: snapshot.id, expires_at: expiresAt, ...resolved, recipients: resolved.recipients.slice(0, 250), recipients_truncated: resolved.recipients.length > 250 });
  } catch (error) {
    const result = smsRouteError(error);
    return NextResponse.json({ error: result.message }, { status: result.status });
  }
}
