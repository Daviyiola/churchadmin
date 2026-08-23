import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  const slug = String(new URL(req.url).searchParams.get("slug") ?? "").trim();
  if (!slug) return NextResponse.json({ error: "Missing slug" }, { status: 400 });

  const { data: campaign, error: campaignError } = await supabaseAdmin
    .from("intake_campaigns")
    .select("id,org_id,name,slug,is_active,expires_at")
    .eq("slug", slug)
    .maybeSingle();
  if (campaignError) return NextResponse.json({ error: "Unable to load this link." }, { status: 400 });
  if (!campaign) return NextResponse.json({ error: "Invalid or expired link." }, { status: 404 });
  if (!campaign.is_active) return NextResponse.json({ error: "This campaign link is inactive." }, { status: 410 });
  if (campaign.expires_at && new Date(campaign.expires_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: "This campaign link has expired." }, { status: 410 });
  }

  const [formResult, organizationResult, settingsResult] = await Promise.all([
    supabaseAdmin.from("forms")
      .select("id,title,description,status,revision")
      .eq("org_id", campaign.org_id).eq("form_kind", "first_timer").eq("is_system", true).maybeSingle(),
    supabaseAdmin.from("organizations").select("name").eq("id", campaign.org_id).maybeSingle(),
    supabaseAdmin.from("organization_settings").select("logo_path,use_default_logo").eq("organization_id", campaign.org_id).maybeSingle(),
  ]);
  if (formResult.error || organizationResult.error || settingsResult.error) {
    return NextResponse.json({ error: "Unable to load this form." }, { status: 400 });
  }
  const form = formResult.data;
  if (!form) return NextResponse.json({ error: "This form is unavailable." }, { status: 404 });
  if (form.status !== "open") return NextResponse.json({ error: "This form is no longer accepting responses." }, { status: 410 });

  const { data: fields, error: fieldsError } = await supabaseAdmin.from("form_fields")
    .select("field_key,field_type,label,help_text,placeholder,is_required,options,layout_width,position")
    .eq("form_id", form.id).eq("org_id", campaign.org_id).order("position", { ascending: true });
  if (fieldsError) return NextResponse.json({ error: "Unable to load this form." }, { status: 400 });

  return NextResponse.json({
    form: { title: form.title, description: form.description, revision: form.revision },
    fields: fields ?? [],
    organization: { name: organizationResult.data?.name ?? "" },
    settings: {
      logo_path: settingsResult.data?.logo_path ?? null,
      use_default_logo: settingsResult.data?.use_default_logo ?? true,
    },
    source: { type: "campaign", label: campaign.name },
  });
}
