import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireUser } from "@/lib/serverAuthz";

export const runtime = "nodejs";

type ErrorJson = { error: string };

export async function GET(req: Request) {
  try {
    const u = await requireUser(req);
    if (!u.ok) return NextResponse.json<ErrorJson>({ error: u.error }, { status: u.status });

    const url = new URL(req.url);
    const organization_id = String(url.searchParams.get("organization_id") ?? "").trim();
    if (!organization_id) return NextResponse.json<ErrorJson>({ error: "organization_id required" }, { status: 400 });

    const { data: link, error: linkErr } = await supabaseAdmin
      .from("user_organizations")
      .select("id")
      .eq("organization_id", organization_id)
      .eq("user_id", u.userId)
      .maybeSingle<{ id: string }>();

    if (linkErr) throw new Error(linkErr.message);
    if (!link) return NextResponse.json<ErrorJson>({ error: "Forbidden" }, { status: 403 });

    const { data, error } = await supabaseAdmin
      .from("communication_campaigns")
      .select("id, created_at, subject, total_recipients, total_success, total_failure, total_skipped")
      .eq("organization_id", organization_id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, rows: data ?? [] });
  } catch (e) {
    return NextResponse.json<ErrorJson>(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 400 },
    );
  }
}
