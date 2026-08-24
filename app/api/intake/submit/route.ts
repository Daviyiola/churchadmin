import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { parsePublicFormAnswers } from "@/lib/server/forms/publicSubmission";
import { enforceIntakeRateLimit, IntakeRateLimitError, isHoneypotFilled } from "@/lib/server/intake/security";
import { TurnstileVerificationError, verifyPublicFormTurnstile } from "@/lib/server/forms/turnstile";

function submissionError(message: string) {
  if (message.includes("INTAKE_USED")) return NextResponse.json({ error: "This link has already been used." }, { status: 410 });
  if (message.includes("INTAKE_EXPIRED")) return NextResponse.json({ error: "This link has expired." }, { status: 410 });
  if (message.includes("FORM_NOT_ACTIVE")) return NextResponse.json({ error: "This form is no longer accepting responses." }, { status: 410 });
  if (message.includes("FORM_REQUIRED_FIELD")) return NextResponse.json({ error: "Please complete every required question." }, { status: 400 });
  if (message.includes("FORM_INVALID") || message.includes("INTAKE_INVALID_FIELDS")) return NextResponse.json({ error: "Please review the submitted answers." }, { status: 400 });
  return NextResponse.json({ error: "Invalid link" }, { status: 404 });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || Array.isArray(body)) throw new Error("Invalid submission.");
    if (Object.keys(body).some((key) => !["token", "request_id", "answers", "website", "turnstile_token"].includes(key))) throw new Error("Invalid submission.");
    if (isHoneypotFilled(body)) return NextResponse.json({ ok: true });
    const token = String(body.token ?? "").trim();
    const requestId = String(body.request_id ?? "").trim();
    if (!token || !/^[0-9a-f-]{36}$/i.test(requestId)) throw new Error("Invalid submission request.");
    const answers = parsePublicFormAnswers(body.answers);
    await enforceIntakeRateLimit(req, "personal-intake-submit", 10, 600);
    await verifyPublicFormTurnstile(req, body.turnstile_token, requestId);
    const { data, error } = await supabaseAdmin.rpc("submit_personal_first_timer_form", {
      p_token: token, p_request_id: requestId, p_answers: answers,
    });
    if (error) return submissionError(error.message);
    return NextResponse.json({ ok: true, ...data });
  } catch (error) {
    if (error instanceof IntakeRateLimitError) return NextResponse.json({ error: error.message }, { status: 429 });
    if (error instanceof TurnstileVerificationError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to submit the form." }, { status: 400 });
  }
}
