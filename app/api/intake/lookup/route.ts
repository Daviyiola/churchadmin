import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type ErrorJson = { error: string };

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = String(searchParams.get("token") ?? "").trim();

  if (!token) {
    return NextResponse.json<ErrorJson>({ error: "Missing token" }, { status: 400 });
  }

  // 1) Validate token
  const { data: tok, error: tokErr } = await supabaseAdmin
    .from("intake_tokens")
    .select("token,org_id,member_id,expires_at,used_at")
    .eq("token", token)
    .maybeSingle();

  if (tokErr) return NextResponse.json<ErrorJson>({ error: tokErr.message }, { status: 400 });
  if (!tok) return NextResponse.json<ErrorJson>({ error: "Invalid link" }, { status: 404 });

  if (tok.used_at) {
    return NextResponse.json<ErrorJson>(
      { error: "This link has already been used." },
      { status: 410 },
    );
  }

  if (new Date(tok.expires_at).getTime() < Date.now()) {
    return NextResponse.json<ErrorJson>({ error: "This link has expired." }, { status: 410 });
  }

  // 2) Fetch org + member + settings + visitor_details (optional)
  const [
    { data: org, error: orgErr },
    { data: mem, error: memErr },
    { data: settings, error: setErr },
    { data: visitor, error: visErr },
  ] = await Promise.all([
    supabaseAdmin
      .from("organizations")
      .select("id,name")
      .eq("id", tok.org_id)
      .maybeSingle(),

    supabaseAdmin
      .from("members")
      .select("id,org_id,first_name,email")
      .eq("id", tok.member_id)
      .eq("org_id", tok.org_id) // keeps link safe
      .maybeSingle(),

    supabaseAdmin
      .from("organization_settings")
      .select("logo_path,use_default_logo")
      .eq("organization_id", tok.org_id)
      .maybeSingle(),

    supabaseAdmin
      .from("visitor_details")
      .select("prayer_request_tags, how_heard")
      .eq("member_id", tok.member_id)
      .maybeSingle(),
  ]);

  if (orgErr) return NextResponse.json<ErrorJson>({ error: orgErr.message }, { status: 400 });
  if (memErr) return NextResponse.json<ErrorJson>({ error: memErr.message }, { status: 400 });

  // Treat settings/visitor_details as optional rows:
  if (setErr && setErr.code !== "PGRST116") {
    return NextResponse.json<ErrorJson>({ error: setErr.message }, { status: 400 });
  }
  if (visErr && visErr.code !== "PGRST116") {
    return NextResponse.json<ErrorJson>({ error: visErr.message }, { status: 400 });
  }

  if (!org || !mem) {
    return NextResponse.json<ErrorJson>({ error: "Invalid link" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    org: { id: org.id, name: org.name },
    member: { id: mem.id, first_name: mem.first_name, email: mem.email },
    settings: {
      logo_path: settings?.logo_path ?? null,
      use_default_logo: settings?.use_default_logo ?? true,
    },
    visitor_details: {
      prayer_request_tags: visitor?.prayer_request_tags ?? null,
      how_heard: visitor?.how_heard ?? null,
    },
  });
}
