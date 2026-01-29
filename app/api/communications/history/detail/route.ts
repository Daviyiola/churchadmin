import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireUser, requireOrgOwnerOrAdmin } from "@/lib/serverAuthz";

export const runtime = "nodejs";

type ErrorJson = { error: string };

export async function GET(req: Request) {
  try {
    const u = await requireUser(req);
    if (!u.ok)
      return NextResponse.json<ErrorJson>({ error: u.error }, { status: u.status });

    const url = new URL(req.url);
    const organization_id = String(url.searchParams.get("organization_id") ?? "").trim();
    const campaign_id = String(url.searchParams.get("campaign_id") ?? "").trim();

    if (!organization_id)
      return NextResponse.json<ErrorJson>({ error: "organization_id required" }, { status: 400 });
    if (!campaign_id)
      return NextResponse.json<ErrorJson>({ error: "campaign_id required" }, { status: 400 });

    const authz = await requireOrgOwnerOrAdmin(organization_id, u.userId);
    if (!authz.ok)
      return NextResponse.json<ErrorJson>({ error: authz.error }, { status: authz.status });

    const { data: camp, error: campErr } = await supabaseAdmin
      .from("communication_campaigns")
      .select("id, subject, total_recipients, total_success, total_failure")
      .eq("id", campaign_id)
      .eq("organization_id", organization_id)
      .maybeSingle();

    if (campErr) throw new Error(campErr.message);
    if (!camp)
      return NextResponse.json<ErrorJson>({ error: "Campaign not found" }, { status: 404 });

    const { data: recips, error: rErr } = await supabaseAdmin
      .from("communication_campaign_recipients")
      .select("to_email, success, error, created_at")
      .eq("campaign_id", campaign_id)
      .order("created_at", { ascending: false });

    if (rErr) throw new Error(rErr.message);

    return NextResponse.json({
      subject: camp.subject,
      total_recipients: camp.total_recipients ?? 0,
      total_success: camp.total_success ?? 0,
      total_failure: camp.total_failure ?? 0,
      recipients: (recips ?? []).map((r) => ({
        email: r.to_email,
        success: !!r.success,
      })),
      errors: (recips ?? [])
        .map((r) => r.error)
        .filter(Boolean)
        .slice(0, 20),
    });
  } catch (e) {
    return NextResponse.json<ErrorJson>(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 400 },
    );
  }
}
