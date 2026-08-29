import { NextResponse } from "next/server";
import { normalizeEmail, verifyResendWebhook } from "@/lib/server/email";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const raw = await request.text();
  let event;
  try {
    event = verifyResendWebhook(raw, request.headers);
  } catch {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 400 });
  }
  const eventType = String(event.type);
  const eventData = event.data as unknown as Record<string, unknown>;
  const eventId = request.headers.get("svix-id") || "";
  if (!eventId) return NextResponse.json({ error: "Missing event ID." }, { status: 400 });
  const email = "to" in event.data && event.data.to?.[0]
    ? normalizeEmail(event.data.to[0])
    : typeof eventData.email === "string"
      ? normalizeEmail(eventData.email)
      : null;
  const providerEmailId = "email_id" in event.data ? event.data.email_id : null;
  const { data: existing } = await supabaseAdmin.from("email_provider_events").select("outcome")
    .eq("provider_event_id", eventId).maybeSingle();
  if (existing?.outcome === "processed" || existing?.outcome === "ignored") return NextResponse.json({ ok: true });
  const { error: eventError } = await supabaseAdmin.from("email_provider_events").upsert({
    provider: "resend",
    provider_event_id: eventId,
    event_type: eventType,
    email_norm: email,
    provider_email_id: providerEmailId,
    outcome: "received",
    error: null,
  }, { onConflict: "provider_event_id" });
  if (eventError) return NextResponse.json({ error: "Unable to record webhook." }, { status: 500 });

  try {
    let reason: "hard_bounce" | "complaint" | "provider_suppressed" | null = null;
    let details: string | null = null;
    if (event.type === "email.complained") reason = "complaint";
    if (event.type === "email.suppressed") {
      reason = "provider_suppressed";
      details = event.data.suppressed.message.slice(0, 500);
    }
    if (event.type === "email.bounced" && event.data.bounce.type.toLowerCase() === "permanent") {
      reason = "hard_bounce";
      details = event.data.bounce.message.slice(0, 500);
    }
    if (eventType === "suppression.added") {
      const origin = typeof eventData.origin === "string" ? eventData.origin : "unknown";
      reason = origin === "complaint"
        ? "complaint"
        : origin === "bounce"
          ? "hard_bounce"
          : "provider_suppressed";
      details = `Resend suppression added (${origin}).`;
    }
    if (eventType === "suppression.removed" && email) {
      const { error } = await supabaseAdmin.from("email_global_suppressions").update({
        released_at: new Date().toISOString(),
        released_by: null,
        details: "Released after Resend removed the address from its suppression list.",
      }).eq("email_norm", email).is("released_at", null);
      if (error) throw new Error(error.message);
      await supabaseAdmin.from("email_provider_events").update({
        outcome: "processed",
        processed_at: new Date().toISOString(),
      }).eq("provider_event_id", eventId);
      return NextResponse.json({ ok: true });
    }
    if (reason && email) {
      const { error } = await supabaseAdmin.from("email_global_suppressions").upsert({
        email,
        email_norm: email,
        reason,
        provider_event_id: eventId,
        details,
        suppressed_at: new Date().toISOString(),
        released_at: null,
        released_by: null,
      }, { onConflict: "email_norm" });
      if (error) throw new Error(error.message);

      if (providerEmailId && ["email.bounced", "email.complained", "email.suppressed"].includes(eventType)) {
        const { error: historyError } = await supabaseAdmin.rpc("reclassify_campaign_recipient_failure", {
          p_provider_id: providerEmailId,
          p_error: details ?? `Resend reported ${eventType}.`,
        });
        if (historyError) throw new Error(historyError.message);
      }
    }
    await supabaseAdmin.from("email_provider_events").update({
      outcome: reason ? "processed" : "ignored",
      processed_at: new Date().toISOString(),
    }).eq("provider_event_id", eventId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    await supabaseAdmin.from("email_provider_events").update({
      outcome: "failed",
      error: error instanceof Error ? error.message.slice(0, 500) : "Webhook processing failed.",
    }).eq("provider_event_id", eventId);
    return NextResponse.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}
