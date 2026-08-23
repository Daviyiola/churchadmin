import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type ContextPayload = {
  org_id: string;
  member_id: string;
  form_id: string;
  initial_answers: Record<string, string | string[]>;
  readonly_field_keys: string[];
};

function lookupError(message: string) {
  if (message.includes("INTAKE_USED")) return NextResponse.json({ error: "This link has already been used." }, { status: 410 });
  if (message.includes("INTAKE_EXPIRED")) return NextResponse.json({ error: "This link has expired." }, { status: 410 });
  if (message.includes("FORM_NOT_ACTIVE")) return NextResponse.json({ error: "This form is no longer accepting responses." }, { status: 410 });
  return NextResponse.json({ error: "Invalid link" }, { status: 404 });
}

export async function GET(req: Request) {
  const token = String(new URL(req.url).searchParams.get("token") ?? "").trim();
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  const { data, error } = await supabaseAdmin.rpc("get_personal_first_timer_form_context", { p_token: token });
  if (error) return lookupError(error.message);
  const context = data as ContextPayload;

  const [formResult, fieldsResult, organizationResult, settingsResult] = await Promise.all([
    supabaseAdmin.from("forms").select("title,description,status,revision").eq("id", context.form_id).eq("org_id", context.org_id).maybeSingle(),
    supabaseAdmin.from("form_fields").select("field_key,field_type,label,help_text,placeholder,is_required,options,layout_width,position").eq("form_id", context.form_id).eq("org_id", context.org_id).order("position", { ascending: true }),
    supabaseAdmin.from("organizations").select("name").eq("id", context.org_id).maybeSingle(),
    supabaseAdmin.from("organization_settings").select("logo_path,use_default_logo").eq("organization_id", context.org_id).maybeSingle(),
  ]);
  if (formResult.error || fieldsResult.error || organizationResult.error || settingsResult.error || !formResult.data) {
    return NextResponse.json({ error: "Unable to load this form." }, { status: 400 });
  }

  return NextResponse.json({
    form: { title: formResult.data.title, description: formResult.data.description, revision: formResult.data.revision },
    fields: fieldsResult.data ?? [],
    organization: { name: organizationResult.data?.name ?? "" },
    settings: {
      logo_path: settingsResult.data?.logo_path ?? null,
      use_default_logo: settingsResult.data?.use_default_logo ?? true,
    },
    source: { type: "personal", label: "Personal invitation" },
    initial_answers: context.initial_answers ?? {},
    readonly_field_keys: context.readonly_field_keys ?? [],
  });
}
