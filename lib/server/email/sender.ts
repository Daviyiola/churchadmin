import { Resend, type CreateEmailOptions, type WebhookEventPayload } from "resend";
import { createEmailPreferenceToken } from "./tokens";
import { normalizeEmail, resolveEmailEligibility } from "./repository";
import type { ManagedEmailInput, ManagedEmailResult } from "./types";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const resend = new Resend(process.env.RESEND_API_KEY!);

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function appBaseUrl() {
  return String(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

function appendFooter(html: string, values: { orgName: string; address: string | null; manageUrl: string; unsubscribeUrl: string }) {
  const footer = `<div style="margin:28px auto 0;max-width:600px;border-top:1px solid #e2e8f0;padding:18px 12px 0;text-align:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;font-size:12px;line-height:1.6;color:#64748b;">Sent by <strong>${escapeHtml(values.orgName)}</strong> through Church Admin.${values.address ? `<br>${escapeHtml(values.address)}` : ""}<br><a href="${values.manageUrl}" style="color:#475569;text-decoration:underline;">Manage email preferences</a> · <a href="${values.unsubscribeUrl}" style="color:#475569;text-decoration:underline;">Unsubscribe from these emails</a></div>`;
  return html.includes("</body>") ? html.replace("</body>", `${footer}</body>`) : `${html}${footer}`;
}

export async function sendManagedEmail(input: ManagedEmailInput): Promise<ManagedEmailResult> {
  const email = normalizeEmail(input.to);
  let contactId: string | null = null;
  let html = input.html;
  const headers: Record<string, string> = {};
  if (input.kind === "optional") {
    if (!input.organizationId || !input.topic) throw new Error("Optional email requires organization and topic.");
    const eligibility = await resolveEmailEligibility(input.organizationId, email, input.topic, input.memberId);
    contactId = eligibility.contactId;
    if (!eligibility.eligible) return { sent: false, skipped: true, reason: eligibility.reason as "unsubscribed" | "suppressed", contactId };
    if (input.requireMailingAddress && !eligibility.mailingAddress) return { sent: false, skipped: true, reason: "missing_mailing_address", contactId };
    const manageToken = createEmailPreferenceToken(contactId!, "manage");
    const oneClickToken = createEmailPreferenceToken(contactId!, "one_click", input.topic);
    const manageUrl = `${appBaseUrl()}/email/preferences?token=${encodeURIComponent(manageToken)}`;
    const unsubscribeUrl = `${appBaseUrl()}/email/preferences?token=${encodeURIComponent(oneClickToken)}`;
    const oneClickUrl = `${appBaseUrl()}/api/email/unsubscribe/${encodeURIComponent(oneClickToken)}`;
    html = appendFooter(html, {
      orgName: eligibility.organizationName || "Your church",
      address: eligibility.mailingAddress,
      manageUrl,
      unsubscribeUrl,
    });
    if (input.topic === "broadcast") {
      headers["List-Unsubscribe"] = `<${oneClickUrl}>`;
      headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    }
  } else {
    const { data: suppression } = await supabaseAdmin.from("email_global_suppressions")
      .select("id").eq("email_norm", email).is("released_at", null).maybeSingle();
    if (suppression) return { sent: false, skipped: true, reason: "suppressed", contactId: null };
  }

  const payload: CreateEmailOptions = {
    from: input.from,
    to: email,
    subject: input.subject,
    html,
    ...(input.text ? { text: input.text } : {}),
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    ...(Object.keys(headers).length ? { headers } : {}),
    ...(input.tags?.length ? { tags: input.tags } : {}),
  };
  const result = await resend.emails.send(payload);
  if (result.error) return { sent: false, skipped: false, error: result.error.message, contactId };
  return { sent: true, providerId: result.data?.id ?? null, contactId };
}

export function verifyResendWebhook(payload: string, headers: Headers): WebhookEventPayload {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  if (!webhookSecret) throw new Error("Resend webhook is not configured.");
  return resend.webhooks.verify({
    payload,
    webhookSecret,
    headers: {
      id: headers.get("svix-id") || "",
      timestamp: headers.get("svix-timestamp") || "",
      signature: headers.get("svix-signature") || "",
    },
  });
}
