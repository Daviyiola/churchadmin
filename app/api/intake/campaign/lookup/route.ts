import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type ErrorJson = { error: string };

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const slug = String(searchParams.get("slug") ?? "").trim();

  if (!slug) {
    return NextResponse.json<ErrorJson>({ error: "Missing slug" }, { status: 400 });
  }

  const { data: camp, error: campErr } = await supabaseAdmin
    .from("intake_campaigns")
    .select("id,org_id,name,slug,is_active,expires_at")
    .eq("slug", slug)
    .maybeSingle();

  if (campErr) return NextResponse.json<ErrorJson>({ error: campErr.message }, { status: 400 });
  if (!camp) return NextResponse.json<ErrorJson>({ error: "Invalid or expired link." }, { status: 404 });

  if (!camp.is_active) {
    return NextResponse.json<ErrorJson>({ error: "This campaign link is inactive." }, { status: 410 });
  }

  if (camp.expires_at && new Date(camp.expires_at).getTime() < Date.now()) {
    return NextResponse.json<ErrorJson>({ error: "This campaign link has expired." }, { status: 410 });
  }

  const [{ data: org, error: orgErr }, { data: settings, error: setErr }] =
    await Promise.all([
      supabaseAdmin
        .from("organizations")
        .select("id,name")
        .eq("id", camp.org_id)
        .maybeSingle(),
      supabaseAdmin
        .from("organization_settings")
        .select("logo_path,use_default_logo")
        .eq("organization_id", camp.org_id)
        .maybeSingle(),
    ]);

  if (orgErr) return NextResponse.json<ErrorJson>({ error: orgErr.message }, { status: 400 });

  // settings row is optional
  if (setErr && setErr.code !== "PGRST116") {
    return NextResponse.json<ErrorJson>({ error: setErr.message }, { status: 400 });
  }

  if (!org) return NextResponse.json<ErrorJson>({ error: "Invalid or expired link." }, { status: 404 });

  return NextResponse.json({
    ok: true,
    org: { id: org.id, name: org.name },
    campaign: { id: camp.id, name: camp.name, slug: camp.slug },
    settings: {
      logo_path: settings?.logo_path ?? null,
      use_default_logo: settings?.use_default_logo ?? true,
    },
  });
}
