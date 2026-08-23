import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireActorId } from "@/lib/server/authUser";

export async function GET(req: Request) {
  try {
    const actorId = await requireActorId(req);
    const { searchParams } = new URL(req.url);
    const memberId = String(searchParams.get("member_id") ?? "").trim();
    if (!memberId) {
      return NextResponse.json({ error: "Missing member_id" }, { status: 400 });
    }

    const { data: member, error: memberError } = await supabaseAdmin
      .from("members")
      .select("id,org_id,status")
      .eq("id", memberId)
      .maybeSingle();

    if (memberError) {
      return NextResponse.json({ error: memberError.message }, { status: 400 });
    }
    if (!member || member.status === "merged") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { data: membership, error: membershipError } = await supabaseAdmin
      .from("user_organizations")
      .select("role")
      .eq("user_id", actorId)
      .eq("organization_id", member.org_id)
      .maybeSingle();

    if (membershipError) {
      return NextResponse.json({ error: membershipError.message }, { status: 400 });
    }
    if (!membership || !["owner", "admin", "finance"].includes(String(membership.role))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: tok, error } = await supabaseAdmin
      .from("intake_tokens")
      .select("token,expires_at,used_at")
      .eq("member_id", memberId)
      .eq("org_id", member.org_id)
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!tok) return NextResponse.json({ ok: true, intakeUrl: null });

    const base = process.env.NEXT_PUBLIC_APP_URL!.replace(/\/$/, "");
    return NextResponse.json({
      ok: true,
      intakeUrl: `${base}/intake/${tok.token}`,
      expires_at: tok.expires_at,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
