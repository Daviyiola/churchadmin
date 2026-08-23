import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  enforceIntakeRateLimit,
  IntakeRateLimitError,
  isHoneypotFilled,
} from "@/lib/server/intake/security";
import { parsePublicFormAnswers } from "@/lib/server/forms/publicSubmission";

function publicError(message: string) {
  if (message.includes("FORM_NOT_ACTIVE")) {
    return NextResponse.json({ error: "This form is no longer accepting responses." }, { status: 410 });
  }
  if (message.includes("FORM_NOT_FOUND")) {
    return NextResponse.json({ error: "This form is unavailable." }, { status: 404 });
  }
  if (message.includes("FORM_REQUIRED_FIELD")) {
    return NextResponse.json({ error: "Please complete every required question." }, { status: 400 });
  }
  if (message.includes("FORM_FIRST_TIMER_INVALID") || message.includes("FORM_INVALID")) {
    return NextResponse.json({ error: "Please review the submitted answers." }, { status: 400 });
  }
  return NextResponse.json({ error: "We could not submit the form. Please try again." }, { status: 400 });
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  const { data: form, error: formError } = await supabaseAdmin
    .from("forms")
    .select("id,org_id,title,description,status,form_kind,revision,slug")
    .eq("slug", slug)
    .maybeSingle();
  if (formError) return NextResponse.json({ error: "Unable to load this form." }, { status: 400 });
  if (!form || form.status === "draft") {
    return NextResponse.json({ error: "This form is unavailable." }, { status: 404 });
  }
  if (form.status !== "open") {
    return NextResponse.json({ error: "This form is no longer accepting responses." }, { status: 410 });
  }

  const [fieldsResult, organizationResult, settingsResult] = await Promise.all([
    supabaseAdmin
      .from("form_fields")
      .select("field_key,field_type,label,help_text,placeholder,is_required,options,layout_width,position")
      .eq("form_id", form.id)
      .eq("org_id", form.org_id)
      .order("position", { ascending: true }),
    supabaseAdmin.from("organizations").select("name").eq("id", form.org_id).maybeSingle(),
    supabaseAdmin
      .from("organization_settings")
      .select("logo_path,use_default_logo")
      .eq("organization_id", form.org_id)
      .maybeSingle(),
  ]);
  if (fieldsResult.error || organizationResult.error || settingsResult.error) {
    return NextResponse.json({ error: "Unable to load this form." }, { status: 400 });
  }

  return NextResponse.json({
    form: {
      title: form.title,
      description: form.description,
      revision: form.revision,
      kind: form.form_kind,
    },
    fields: fieldsResult.data ?? [],
    organization: { name: organizationResult.data?.name ?? "" },
    settings: {
      logo_path: settingsResult.data?.logo_path ?? null,
      use_default_logo: settingsResult.data?.use_default_logo ?? true,
    },
  });
}

export async function POST(
  req: Request,
  context: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await context.params;
    const bodyUnknown: unknown = await req.json().catch(() => null);
    if (!bodyUnknown || typeof bodyUnknown !== "object" || Array.isArray(bodyUnknown)) {
      throw new Error("Invalid submission.");
    }
    const body = bodyUnknown as Record<string, unknown>;
    const allowed = new Set(["request_id", "answers", "website"]);
    if (Object.keys(body).some((key) => !allowed.has(key))) throw new Error("Invalid submission.");
    if (isHoneypotFilled(body)) return NextResponse.json({ ok: true });

    const requestId = String(body.request_id ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(requestId)) throw new Error("Invalid submission request.");
    const answers = parsePublicFormAnswers(body.answers);

    await Promise.all([
      enforceIntakeRateLimit(req, `public-form:${slug}`, 5, 600),
      enforceIntakeRateLimit(req, "public-forms-global", 30, 3600),
    ]);

    const { data, error } = await supabaseAdmin.rpc("submit_public_form", {
      p_slug: slug,
      p_request_id: requestId,
      p_answers: answers,
    });
    if (error) return publicError(error.message);
    return NextResponse.json({ ok: true, ...data });
  } catch (error) {
    if (error instanceof IntakeRateLimitError) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to submit the form.",
    }, { status: 400 });
  }
}
