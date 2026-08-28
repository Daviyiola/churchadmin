import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { CHURCH_EMAIL_TOPICS, type ChurchEmailTopic, type EmailEligibility } from "./types";

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function formatMailingAddress(settings: Record<string, unknown> | null) {
  if (!settings) return null;
  const parts = [
    settings.mailing_address_line1,
    settings.mailing_address_line2,
    [settings.mailing_city, settings.mailing_state].filter(Boolean).join(", "),
    settings.mailing_postal_code,
    settings.mailing_country,
  ].map((value) => String(value ?? "").trim()).filter(Boolean);
  return parts.length >= 4 ? parts.join(" · ") : null;
}

export async function ensureEmailContact(orgId: string, emailRaw: string, memberId?: string | null) {
  const email = normalizeEmail(emailRaw);
  const { data: existing, error: lookupError } = await supabaseAdmin.from("email_contacts")
    .select("id,org_id,member_id,email_norm").eq("org_id", orgId).eq("email_norm", email).maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  if (existing) {
    if (memberId && existing.member_id !== memberId) {
      const { data, error } = await supabaseAdmin.from("email_contacts").update({
        member_id: memberId,
        email,
        updated_at: new Date().toISOString(),
      }).eq("id", existing.id).select("id,org_id,member_id,email_norm").single();
      if (error) throw new Error(error.message);
      return data as { id: string; org_id: string; member_id: string | null; email_norm: string };
    }
    return existing as { id: string; org_id: string; member_id: string | null; email_norm: string };
  }
  const { data, error } = await supabaseAdmin.from("email_contacts").insert({
    org_id: orgId,
    member_id: memberId || null,
    email,
    email_norm: email,
  }).select("id,org_id,member_id,email_norm").single();
  if (error) throw new Error(error.message);
  return data as { id: string; org_id: string; member_id: string | null; email_norm: string };
}

export async function resolveEmailEligibility(
  orgId: string,
  emailRaw: string,
  topic: ChurchEmailTopic,
  memberId?: string | null,
): Promise<EmailEligibility> {
  const email = normalizeEmail(emailRaw);
  const contact = await ensureEmailContact(orgId, email, memberId);
  const contactIds = new Set<string>([contact.id]);

  const queries = [
    supabaseAdmin.from("email_contacts").select("id").eq("org_id", orgId).eq("email_norm", email),
    ...(memberId ? [supabaseAdmin.from("email_contacts").select("id").eq("org_id", orgId).eq("member_id", memberId)] : []),
  ];
  const contactResults = await Promise.all(queries);
  for (const result of contactResults) {
    if (result.error) throw new Error(result.error.message);
    for (const row of result.data ?? []) contactIds.add(String(row.id));
  }

  const [{ data: suppression, error: suppressionError }, { data: preferences, error: preferenceError }, { data: org }, { data: settings }] = await Promise.all([
    supabaseAdmin.from("email_global_suppressions").select("id").eq("email_norm", email).is("released_at", null).maybeSingle(),
    supabaseAdmin.from("email_topic_preferences").select("subscribed").in("contact_id", [...contactIds]).eq("topic", topic).eq("subscribed", false).limit(1),
    supabaseAdmin.from("organizations").select("name").eq("id", orgId).maybeSingle(),
    supabaseAdmin.from("organization_settings").select("mailing_address_line1,mailing_address_line2,mailing_city,mailing_state,mailing_postal_code,mailing_country").eq("organization_id", orgId).maybeSingle(),
  ]);
  if (suppressionError) throw new Error(suppressionError.message);
  if (preferenceError) throw new Error(preferenceError.message);
  const common = {
    contactId: contact.id,
    mailingAddress: formatMailingAddress(settings as Record<string, unknown> | null),
    organizationName: String(org?.name ?? "").trim() || null,
  };
  if (suppression) return { eligible: false, reason: "suppressed", ...common };
  if ((preferences ?? []).length) return { eligible: false, reason: "unsubscribed", ...common };
  return { eligible: true, reason: "eligible", ...common };
}

export async function getEmailPreferenceContact(contactId: string) {
  const { data, error } = await supabaseAdmin.from("email_contacts")
    .select("id,org_id,member_id,email_norm,organizations(name)").eq("id", contactId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const { data: rows, error: preferencesError } = await supabaseAdmin.from("email_topic_preferences")
    .select("topic,subscribed,changed_at").eq("contact_id", contactId);
  if (preferencesError) throw new Error(preferencesError.message);
  const preferences = Object.fromEntries(CHURCH_EMAIL_TOPICS.map((topic) => [topic, true])) as Record<ChurchEmailTopic, boolean>;
  for (const row of rows ?? []) preferences[row.topic as ChurchEmailTopic] = Boolean(row.subscribed);
  const organization = Array.isArray(data.organizations) ? data.organizations[0] : data.organizations;
  return { id: data.id, orgId: data.org_id, memberId: data.member_id, email: data.email_norm, organizationName: organization?.name ?? "Church", preferences };
}

export async function setEmailPreferences(input: {
  contactId: string;
  topics: ChurchEmailTopic[];
  subscribed: boolean;
  source: "recipient" | "one_click" | "staff" | "system";
  actorId?: string | null;
  reason?: string | null;
  requestHash?: string | null;
}) {
  const contact = await getEmailPreferenceContact(input.contactId);
  if (!contact) throw new Error("Preference link is unavailable.");
  const topics = [...new Set(input.topics)].filter((topic) => CHURCH_EMAIL_TOPICS.includes(topic));
  if (!topics.length) throw new Error("Choose at least one email category.");
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin.from("email_topic_preferences").upsert(topics.map((topic) => ({
    contact_id: input.contactId,
    topic,
    subscribed: input.subscribed,
    source: input.source,
    reason: input.reason || null,
    changed_by: input.actorId || null,
    changed_at: now,
  })), { onConflict: "contact_id,topic" });
  if (error) throw new Error(error.message);
  const { error: auditError } = await supabaseAdmin.from("email_preference_events").insert(topics.map((topic) => ({
    org_id: contact.orgId,
    contact_id: input.contactId,
    topic,
    action: input.subscribed ? "subscribe" : "unsubscribe",
    source: input.source,
    actor_id: input.actorId || null,
    reason: input.reason || null,
    request_hash: input.requestHash || null,
  })));
  if (auditError) throw new Error(auditError.message);

  if (!input.subscribed && topics.includes("followup")) {
    let memberIds = contact.memberId ? [contact.memberId] : [];
    const { data: matchingMembers } = await supabaseAdmin.from("members").select("id")
      .eq("org_id", contact.orgId).eq("email", contact.email);
    memberIds = [...new Set([...memberIds, ...(matchingMembers ?? []).map((row) => String(row.id))])];
    if (memberIds.length) {
      await supabaseAdmin.from("scheduled_followups").update({
        status: "blocked_preference",
        error_message: "Recipient opted out of follow-up emails.",
        updated_at: now,
      }).eq("org_id", contact.orgId).in("member_id", memberIds).eq("status", "pending");
    }
  }
  return getEmailPreferenceContact(input.contactId);
}

export async function consumePreferenceRateLimit(requestHash: string) {
  const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  const { count, error } = await supabaseAdmin.from("email_preference_rate_events")
    .select("id", { count: "exact", head: true }).eq("request_hash", requestHash).gte("created_at", cutoff);
  if (error) throw new Error(error.message);
  if ((count ?? 0) >= 30) throw new Error("Too many preference requests. Please try again later.");
  await supabaseAdmin.from("email_preference_rate_events").insert({ request_hash: requestHash });
  if (Math.random() < 0.02) await supabaseAdmin.from("email_preference_rate_events").delete().lt("created_at", new Date(Date.now() - 24 * 60 * 60_000).toISOString());
}
