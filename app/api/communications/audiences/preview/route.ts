import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireOrgFinanceOrAbove, requireUser } from "@/lib/serverAuthz";
import { resolveAudience } from "@/lib/server/communications/audienceResolver";

export const runtime = "nodejs";
const DISPLAY_LIMIT = 1000;

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    if (!user.ok) return NextResponse.json({ error: user.error }, { status: user.status });
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || Object.keys(body).some((key) => !["organization_id", "criteria"].includes(key))) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    const orgId = String(body.organization_id ?? "").trim();
    if (!orgId) return NextResponse.json({ error: "organization_id required" }, { status: 400 });
    const authz = await requireOrgFinanceOrAbove(orgId, user.userId);
    if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

    const resolved = await resolveAudience(orgId, body.criteria);
    if (!resolved.recipients.length) {
      return NextResponse.json({ error: "No valid email recipients were found." }, { status: 400 });
    }

    await supabaseAdmin
      .from("communication_audience_snapshots")
      .delete()
      .eq("org_id", orgId)
      .eq("created_by", user.userId)
      .lt("expires_at", new Date().toISOString());

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const { data: snapshot, error: snapshotError } = await supabaseAdmin
      .from("communication_audience_snapshots")
      .insert({
        org_id: orgId,
        created_by: user.userId,
        criteria: resolved.criteria,
        source_counts: resolved.source_counts,
        total_recipients: resolved.recipients.length,
        invalid_count: resolved.invalid_count,
        duplicate_count: resolved.duplicate_count,
        unsubscribed_count: resolved.unsubscribed_count,
        suppressed_count: resolved.suppressed_count,
        expires_at: expiresAt,
      })
      .select("id")
      .single<{ id: string }>();
    if (snapshotError) throw new Error(snapshotError.message);

    const inserted: Array<{ id: string; email: string; member_id: string | null; display_name: string | null; source_types: string[]; source_labels: string[] }> = [];
    for (let offset = 0; offset < resolved.recipients.length; offset += 500) {
      const rows = resolved.recipients.slice(offset, offset + 500).map((recipient) => ({
        snapshot_id: snapshot.id,
        org_id: orgId,
        ...recipient,
      }));
      const { data, error } = await supabaseAdmin.from("communication_audience_snapshot_recipients")
        .insert(rows).select("id,email,member_id,display_name,source_types,source_labels");
      if (error) {
        await supabaseAdmin.from("communication_audience_snapshots").delete().eq("id", snapshot.id);
        throw new Error(error.message);
      }
      inserted.push(...((data ?? []) as typeof inserted));
    }

    return NextResponse.json({
      snapshot_id: snapshot.id,
      expires_at: expiresAt,
      total_recipients: resolved.recipients.length,
      invalid_count: resolved.invalid_count,
      duplicate_count: resolved.duplicate_count,
      unsubscribed_count: resolved.unsubscribed_count,
      suppressed_count: resolved.suppressed_count,
      source_counts: resolved.source_counts,
      recipients: inserted.slice(0, DISPLAY_LIMIT),
      recipients_truncated: inserted.length > DISPLAY_LIMIT,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to preview recipients." }, { status: 400 });
  }
}
