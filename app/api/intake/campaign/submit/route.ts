import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { parsePublicFormAnswers } from "@/lib/server/forms/publicSubmission";
import { enforceIntakeRateLimit, IntakeRateLimitError, isHoneypotFilled } from "@/lib/server/intake/security";

function submissionError(message: string) {
  if (message.includes("INTAKE_EXPIRED")) return NextResponse.json({ error: "This campaign link has expired." }, { status: 410 });
  if (message.includes("INTAKE_INACTIVE")) return NextResponse.json({ error: "This campaign link is inactive." }, { status: 410 });
  if (message.includes("FORM_NOT_ACTIVE")) return NextResponse.json({ error: "This form is no longer accepting responses." }, { status: 410 });
  if (message.includes("FORM_REQUIRED_FIELD")) return NextResponse.json({ error: "Please complete every required question." }, { status: 400 });
  if (message.includes("FORM_FIRST_TIMER_INVALID") || message.includes("FORM_INVALID")) return NextResponse.json({ error: "Please review the submitted answers." }, { status: 400 });
  if (message.includes("INTAKE_INVALID") || message.includes("FORM_NOT_FOUND")) return NextResponse.json({ error: "Invalid or expired link." }, { status: 404 });
  return NextResponse.json({ error: "We could not submit the form. Please try again." }, { status: 400 });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || Array.isArray(body)) throw new Error("Invalid submission.");
    if (Object.keys(body).some((key) => !["slug", "request_id", "answers", "website"].includes(key))) throw new Error("Invalid submission.");
    if (isHoneypotFilled(body)) return NextResponse.json({ ok: true });
    const slug = String(body.slug ?? "").trim();
    const requestId = String(body.request_id ?? "").trim();
    if (!slug || !/^[0-9a-f-]{36}$/i.test(requestId)) throw new Error("Invalid submission request.");
    const answers = parsePublicFormAnswers(body.answers);
    await Promise.all([
      enforceIntakeRateLimit(req, `campaign:${slug}`, 5, 600),
      enforceIntakeRateLimit(req, "campaign-intake-global", 20, 3600),
    ]);
    const { data, error } = await supabaseAdmin.rpc("submit_campaign_first_timer_form", {
      p_slug: slug, p_request_id: requestId, p_answers: answers,
    });
    if (error) return submissionError(error.message);
    return NextResponse.json({ ok: true, ...data });
  } catch (error) {
    if (error instanceof IntakeRateLimitError) return NextResponse.json({ error: error.message }, { status: 429 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to submit the form." }, { status: 400 });
  }
}
