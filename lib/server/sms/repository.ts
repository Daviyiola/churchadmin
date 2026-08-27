import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { SMS_ATTESTATION_STATEMENT, SMS_ATTESTATION_VERSION } from "@/lib/sms/attestation";

export async function ensureSmsSettings(orgId: string, userId: string) {
  const { error } = await supabaseAdmin.from("sms_organization_settings").upsert(
    { org_id: orgId, updated_by: userId },
    { onConflict: "org_id", ignoreDuplicates: true },
  );
  if (error) throw new Error(error.message);
}

export async function getSmsState(orgId: string) {
  const [{ data: settings, error: settingsError }, { data: draft, error: draftError }, { data: attestation, error: attestationError }] = await Promise.all([
    supabaseAdmin.from("sms_organization_settings").select("*").eq("org_id", orgId).maybeSingle(),
    supabaseAdmin.from("sms_onboarding_drafts").select("*").eq("org_id", orgId).maybeSingle(),
    supabaseAdmin.from("sms_consent_attestations").select("id,version,statement_version,attested_at,attested_by,role_snapshot,ongoing_policy").eq("org_id", orgId).is("revoked_at", null).maybeSingle(),
  ]);
  if (settingsError) throw new Error(settingsError.message);
  if (draftError) throw new Error(draftError.message);
  if (attestationError) throw new Error(attestationError.message);
  return { settings, onboarding: draft, attestation };
}

export async function saveSmsOnboarding(orgId: string, userId: string, value: Record<string, unknown>) {
  const allowed = new Set([
    "current_step", "organization_type", "representative_name", "representative_title",
    "representative_email", "representative_phone", "has_ein", "has_identity_documents",
    "has_payment_method", "has_website", "website_url", "messaging_purposes",
    "estimated_monthly_segments", "consent_methods", "sample_announcement", "sample_reminder",
    "sample_follow_up", "sample_help_reply", "sample_stop_reply", "area_code_preference",
    "number_preference", "completed_steps",
  ]);
  const clean = Object.fromEntries(Object.entries(value).filter(([key]) => allowed.has(key)));
  const { data, error } = await supabaseAdmin.from("sms_onboarding_drafts").upsert({
    org_id: orgId,
    ...clean,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "org_id" }).select("*").single();
  if (error) throw new Error(error.message);
  await ensureSmsSettings(orgId, userId);
  await supabaseAdmin.from("sms_organization_settings").update({ onboarding_status: "draft", updated_by: userId, updated_at: new Date().toISOString() })
    .eq("org_id", orgId).eq("onboarding_status", "not_started");
  return data;
}

export async function completeSmsOnboarding(orgId: string, userId: string, role: string) {
  const { data, error } = await supabaseAdmin.rpc("complete_sms_onboarding", {
    p_org_id: orgId,
    p_actor_id: userId,
    p_role: role,
    p_statement_version: SMS_ATTESTATION_VERSION,
    p_statement_text: SMS_ATTESTATION_STATEMENT,
  });
  if (error) throw new Error(error.message.includes("SMS_SETUP_INCOMPLETE") ? "Complete every required setup section before attesting." : error.message);
  return Array.isArray(data) ? data[0] : data;
}
