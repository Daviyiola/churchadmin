import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { enforceIntakeRateLimit, IntakeRateLimitError, isHoneypotFilled } from "@/lib/server/intake/security";
import { TurnstileVerificationError, verifyPublicFormTurnstile } from "@/lib/server/forms/turnstile";
import { ATTEMPT_COOKIE, CHECKIN_COOKIE, deviceTokenHash, exactMemberMatches, nameHash, newDeviceToken, publicCheckinContext, readCookie, routeError, secureCookie, signAttempt, signConfirmation, verifyAttempt } from "@/lib/server/attendance/checkin";

export async function POST(req: Request, context: { params: Promise<{ signedCode: string }> }) {
  try {
    const { signedCode } = await context.params;
    const ctx = await publicCheckinContext(signedCode);
    if (!ctx.open || !ctx.window) return Response.json({ error: "Check-in is not open right now." }, { status: 410 });
    const body = await req.json() as Record<string, unknown>;
    const allowed = new Set(["request_id","first_name","last_name","phone","email","remember","website","turnstile_token"]);
    if (Object.keys(body).some((key) => !allowed.has(key)) || isHoneypotFilled(body)) return Response.json({ ok: true });
    const requestId = String(body.request_id ?? "");
    const first = String(body.first_name ?? "").trim();
    const last = String(body.last_name ?? "").trim();
    const phone = String(body.phone ?? "").trim();
    const email = String(body.email ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(requestId) || !first || !last || first.length > 100 || last.length > 100) return Response.json({ error: "Enter a valid first and last name." }, { status: 400 });
    await Promise.all([
      enforceIntakeRateLimit(req, `attendance-code:${ctx.code.id}`, 300, 600),
      enforceIntakeRateLimit(req, `attendance-name:${nameHash(first,last)}`, 6, 600),
    ]);
    const attempt = readCookie(req, ATTEMPT_COOKIE);
    if (!verifyAttempt(attempt, ctx.code.id)) await verifyPublicFormTurnstile(req, body.turnstile_token, requestId, "attendance_checkin");
    const matches = await exactMemberMatches(ctx.code.org_id, first, last, phone, email);
    if (matches.length > 1 && !phone && !email) {
      const response = NextResponse.json({ needs_identifier: true, message: "We found more than one person with that name. Add your phone number or email so we can check safely." });
      response.cookies.set(ATTEMPT_COOKIE, signAttempt(ctx.code.id), { httpOnly:true,secure:secureCookie,sameSite:"lax",path:"/",maxAge:900 });
      return response;
    }
    const state = matches.length === 1 ? "awaiting_confirmation" : "unresolved";
    let deviceToken = readCookie(req, CHECKIN_COOKIE);
    const remember = body.remember === true;
    if (remember && !deviceToken) deviceToken = newDeviceToken();
    const { data, error } = await supabaseAdmin.rpc("record_public_attendance_checkin", {
      p_code_id: ctx.code.id,p_window_id: ctx.window.id,p_request_id: requestId,p_first_name:first,p_last_name:last,
      p_phone:phone || null,p_email:email || null,p_name_hash:nameHash(first,last),p_state:state,p_candidate_person_id:matches[0]?.id ?? null,
      p_remember_requested:remember,p_device_token_hash:remember && deviceToken ? deviceTokenHash(deviceToken) : null,
    });
    if (error) throw error;
    const response = NextResponse.json(state === "awaiting_confirmation"
      ? { state, confirmation_handle: signConfirmation(String(data.checkin_id)), submitted_name: `${first} ${last}` }
      : { state, message: "Thanks. Church staff will review your check-in." });
    response.cookies.set(ATTEMPT_COOKIE, signAttempt(ctx.code.id), { httpOnly:true,secure:secureCookie,sameSite:"lax",path:"/",maxAge:900 });
    if (remember && deviceToken) response.cookies.set(CHECKIN_COOKIE, deviceToken, { httpOnly:true,secure:secureCookie,sameSite:"lax",path:"/",maxAge:60*60*24*365*5 });
    return response;
  } catch (error) {
    if (error instanceof IntakeRateLimitError || error instanceof TurnstileVerificationError) return Response.json({ error:error.message }, { status: error instanceof IntakeRateLimitError ? 429 : error.status });
    return routeError(error);
  }
}
