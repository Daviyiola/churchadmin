import { CHURCH_EMAIL_TOPICS, consumePreferenceRateLimit, hashPreferenceRequest, setEmailPreferences, verifyEmailPreferenceToken } from "@/lib/server/email";

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const payload = verifyEmailPreferenceToken(token, "one_click");
    if (!payload?.t || !CHURCH_EMAIL_TOPICS.includes(payload.t)) return new Response(null, { status: 400 });
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
    const requestHash = hashPreferenceRequest(`${ip}:${request.headers.get("user-agent") || "one-click"}`);
    await consumePreferenceRateLimit(requestHash);
    await setEmailPreferences({ contactId: payload.c, topics: [payload.t], subscribed: false, source: "one_click", requestHash });
    return new Response(null, { status: 200 });
  } catch {
    return new Response(null, { status: 400 });
  }
}

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  return Response.redirect(new URL(`/email/preferences?token=${encodeURIComponent(token)}`, request.url), 303);
}
