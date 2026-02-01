import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireActorId } from "@/lib/server/authUser";

type ErrorJson = { error: string };

function makeToken(len = 24) {
  return crypto.randomBytes(len).toString("hex");
}

export async function GET(req: Request) {
  try {
    const actorId = await requireActorId(req);

    const { searchParams } = new URL(req.url);
    const orgId = String(searchParams.get("org_id") ?? "").trim();
    if (!orgId) {
      return NextResponse.json<ErrorJson>({ error: "Missing org_id" }, { status: 400 });
    }

    // Permission check
    const { data: link, error: linkErr } = await supabaseAdmin
      .from("user_organizations")
      .select("role")
      .eq("user_id", actorId)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (linkErr) return NextResponse.json<ErrorJson>({ error: linkErr.message }, { status: 400 });
    if (!link || !["owner", "admin", "finance"].includes(String(link.role))) {
      return NextResponse.json<ErrorJson>({ error: "Forbidden" }, { status: 403 });
    }

    // Check existing token
    const { data: existing, error: selErr } = await supabaseAdmin
      .from("schedule_public_tokens")
      .select("token,is_active")
      .eq("org_id", orgId)
      .maybeSingle();

    if (selErr) return NextResponse.json<ErrorJson>({ error: selErr.message }, { status: 400 });

    let token = existing?.token;

    // Create if missing
    if (!token) {
      token = makeToken(16);

      const { error: insErr } = await supabaseAdmin
        .from("schedule_public_tokens")
        .insert({
          org_id: orgId,
          token,
          created_by: actorId,
        });

      if (insErr) return NextResponse.json<ErrorJson>({ error: insErr.message }, { status: 400 });
    }

    const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
    const publicUrl = `${base}/schedule/${token}`;

    return NextResponse.json({
      ok: true,
      token,
      publicUrl,
      is_active: existing?.is_active ?? true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    if (msg === "UNAUTHORIZED") {
      return NextResponse.json<ErrorJson>({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json<ErrorJson>({ error: msg }, { status: 400 });
  }
}
