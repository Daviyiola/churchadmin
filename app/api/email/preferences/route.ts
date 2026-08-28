import { NextResponse } from "next/server";
import { CHURCH_EMAIL_TOPICS, consumePreferenceRateLimit, getEmailPreferenceContact, hashPreferenceRequest, setEmailPreferences, verifyEmailPreferenceToken, type ChurchEmailTopic } from "@/lib/server/email";

function requestFingerprint(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  return hashPreferenceRequest(`${ip}:${request.headers.get("user-agent") || "unknown"}`);
}

export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token") || "";
    const payload = verifyEmailPreferenceToken(token);
    if (!payload) return NextResponse.json({ error: "This preference link is invalid." }, { status: 400 });
    const contact = await getEmailPreferenceContact(payload.c);
    if (!contact) return NextResponse.json({ error: "This preference link is unavailable." }, { status: 404 });
    return NextResponse.json({
      organization_name: contact.organizationName,
      email_masked: contact.email.replace(/^(.{1,2}).*(@.*)$/, "$1•••$2"),
      preferences: contact.preferences,
      link_topic: payload.t || null,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load preferences." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as { token?: unknown; preferences?: unknown; unsubscribe_all?: unknown } | null;
    const token = typeof body?.token === "string" ? body.token : "";
    const payload = verifyEmailPreferenceToken(token);
    if (!payload) return NextResponse.json({ error: "This preference link is invalid." }, { status: 400 });
    const requestHash = requestFingerprint(request);
    await consumePreferenceRateLimit(requestHash);

    if (body?.unsubscribe_all === true) {
      if (payload.p !== "manage") return NextResponse.json({ error: "This link can only update its email category." }, { status: 400 });
      const contact = await setEmailPreferences({ contactId: payload.c, topics: [...CHURCH_EMAIL_TOPICS], subscribed: false, source: "recipient", requestHash });
      return NextResponse.json({ ok: true, preferences: contact?.preferences });
    }

    const raw = body?.preferences && typeof body.preferences === "object" ? body.preferences as Record<string, unknown> : {};
    if (payload.p === "one_click") {
      if (!payload.t || typeof raw[payload.t] !== "boolean") return NextResponse.json({ error: "This link can only update its email category." }, { status: 400 });
      const suppliedOtherTopic = CHURCH_EMAIL_TOPICS.some((topic) => topic !== payload.t && Object.hasOwn(raw, topic));
      if (suppliedOtherTopic) return NextResponse.json({ error: "This link cannot update another email category." }, { status: 400 });
      const contact = await setEmailPreferences({ contactId: payload.c, topics: [payload.t], subscribed: Boolean(raw[payload.t]), source: "recipient", requestHash });
      return NextResponse.json({ ok: true, preferences: contact?.preferences });
    }
    for (const topic of CHURCH_EMAIL_TOPICS) {
      if (typeof raw[topic] !== "boolean") continue;
      await setEmailPreferences({ contactId: payload.c, topics: [topic as ChurchEmailTopic], subscribed: Boolean(raw[topic]), source: "recipient", requestHash });
    }
    const contact = await getEmailPreferenceContact(payload.c);
    return NextResponse.json({ ok: true, preferences: contact?.preferences });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save preferences.";
    return NextResponse.json({ error: message }, { status: message.startsWith("Too many") ? 429 : 400 });
  }
}
