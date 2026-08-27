"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getAccessToken } from "@/lib/auth";
import { SMS_ATTESTATION_STATEMENT, SMS_ATTESTATION_VERSION } from "@/lib/sms/attestation";

type Draft = Record<string, unknown> & { current_step?: number; completed_steps?: number[]; messaging_purposes?: string[]; consent_methods?: string[] };
const steps = ["Readiness", "Organization", "Representative", "Messaging", "Consent", "Samples", "Phone preference", "Review"];
const purposeOptions = [["announcement", "Announcements"], ["reminder", "Reminders"], ["follow_up", "Follow-ups"], ["event", "Events"], ["fundraising", "Fundraising"], ["other", "Other"]];
const consentOptions = [["paper_form", "Paper forms"], ["online_form", "Online forms"], ["verbal", "Verbal permission"], ["membership_process", "Membership process"], ["event_registration", "Event registration"], ["other", "Other"]];

async function callApi(url: string, init?: RequestInit) {
  const token = await getAccessToken();
  if (!token) throw new Error("Please sign in again.");
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error ?? "Unable to save SMS setup.");
  return payload;
}

export function SmsSetupWizard({ orgId }: { orgId: string }) {
  const [draft, setDraft] = useState<Draft>({ current_step: 1, messaging_purposes: [], consent_methods: [], completed_steps: [] });
  const [status, setStatus] = useState("not_started");
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [accessBlocked, setAccessBlocked] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    callApi(`/api/communications/sms/settings?organization_id=${encodeURIComponent(orgId)}`)
      .then((payload) => {
        if (payload.onboarding) { setDraft(payload.onboarding); setStep(Number(payload.onboarding.current_step ?? 1)); }
        setStatus(payload.settings?.onboarding_status ?? "not_started");
      }).catch((cause) => { setError(cause instanceof Error ? cause.message : "Unable to load setup."); setAccessBlocked(true); })
      .finally(() => setLoading(false));
  }, [orgId]);

  const save = useCallback(async (next: Draft) => {
    setSaving(true); setError("");
    try {
      const payload = await callApi("/api/communications/sms/onboarding", { method: "PATCH", body: JSON.stringify({ organization_id: orgId, draft: next }) });
      setDraft(payload.onboarding);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save setup."); throw cause; }
    finally { setSaving(false); }
  }, [orgId]);

  const patch = (key: string, value: unknown) => setDraft((current) => ({ ...current, [key]: value }));
  const toggle = (key: "messaging_purposes" | "consent_methods", value: string) => {
    const current = (draft[key] ?? []) as string[];
    patch(key, current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  };
  const validation = useMemo(() => {
    if (step === 2 && !draft.organization_type) return "Choose an organization type.";
    if (step === 3 && (!String(draft.representative_name ?? "").trim() || !String(draft.representative_title ?? "").trim() || !String(draft.representative_email ?? "").includes("@"))) return "Add the representative's name, title, and email.";
    if (step === 4 && (!(draft.messaging_purposes as string[] | undefined)?.length || Number(draft.estimated_monthly_segments ?? -1) < 0)) return "Choose at least one purpose and estimate monthly message segments.";
    if (step === 5 && !(draft.consent_methods as string[] | undefined)?.length) return "Choose at least one way your church obtains permission.";
    if (step === 6 && (!String(draft.sample_announcement ?? "").trim() || !String(draft.sample_help_reply ?? "").trim() || !String(draft.sample_stop_reply ?? "").trim())) return "Add an announcement, HELP reply, and STOP reply sample.";
    if (step === 7 && !draft.number_preference) return "Choose a phone-number preference.";
    return "";
  }, [draft, step]);

  async function move(nextStep: number) {
    if (nextStep > step && validation) { setError(validation); return; }
    const completed = nextStep > step ? [...new Set([...(draft.completed_steps ?? []), step])] : (draft.completed_steps ?? []);
    const next = { ...draft, current_step: nextStep, completed_steps: completed };
    await save(next); setStep(nextStep);
  }

  async function complete() {
    if (!confirmed) { setError("Confirm the organization consent attestation first."); return; }
    setSaving(true); setError("");
    try {
      await save({ ...draft, current_step: 8, completed_steps: [1,2,3,4,5,6,7,8] });
      await callApi("/api/communications/sms/onboarding/complete", { method: "POST", body: JSON.stringify({ organization_id: orgId, confirmed: true, statement_version: SMS_ATTESTATION_VERSION }) });
      setStatus("ready_for_provider");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to complete setup."); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="rounded-3xl border bg-white p-10 text-center text-sm text-slate-600">Loading your SMS setup...</div>;
  if (accessBlocked) return <div className="rounded-3xl border bg-white p-8"><div className="text-lg font-semibold">SMS setup access unavailable</div><p className="mt-2 text-sm text-slate-600">Only finance, admin, and owner roles can manage SMS setup for the selected organization.</p></div>;
  if (status === "ready_for_provider" || status === "provider_pending" || status === "approved") return <div className="rounded-3xl border bg-white p-6">
    <div className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Setup complete</div>
    <h2 className="mt-3 text-xl font-semibold">Ready for a provider connection</h2>
    <p className="mt-2 max-w-2xl text-sm text-slate-600">Your organization profile and ongoing consent attestation are saved. No text messages can be sent until Church Admin connects and activates an approved provider.</p>
    <div className="mt-5 flex flex-wrap gap-3"><Link href="/app/communications/sms" className="rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-white">Go to SMS workspace</Link><button type="button" onClick={() => { setStatus("draft"); setStep(2); }} className="rounded-2xl border px-5 py-2.5 text-sm font-semibold hover:bg-slate-50">Review setup details</button></div>
  </div>;

  return <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
    <aside className="rounded-3xl border bg-white p-3 lg:self-start">{steps.map((label, index) => { const number = index + 1; return <button key={label} type="button" onClick={() => move(number)} className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm ${step === number ? "bg-primary text-white" : "hover:bg-slate-50"}`}><span className={`grid h-7 w-7 place-items-center rounded-full border text-xs font-semibold ${step === number ? "border-white/40" : "border-slate-300"}`}>{number}</span><span>{label}</span></button>; })}</aside>
    <section className="overflow-hidden rounded-3xl border bg-white">
      <div className="border-b px-5 py-5 sm:px-7"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Step {step} of {steps.length}</div><h2 className="mt-1 text-xl font-semibold">{steps[step - 1]}</h2><div className="mt-1 text-sm text-slate-600">Your progress is saved whenever you continue.</div></div>
      <div className="min-h-[360px] space-y-5 px-5 py-6 sm:px-7">
        {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
        {step === 1 ? <><div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><strong>No sending yet.</strong> This setup prepares Church Admin for a future approved SMS provider. It does not transmit a text or start carrier registration.</div><div className="grid gap-3 sm:grid-cols-2">{[["EIN or registration details available", "has_ein"], ["Representative identity documents available", "has_identity_documents"], ["Payment method available", "has_payment_method"], ["Organization website available", "has_website"]].map(([label,key]) => <label key={key} className="flex items-center gap-3 rounded-2xl border p-4 text-sm"><input type="checkbox" checked={draft[key] === true} onChange={(event) => patch(key, event.target.checked)} />{label}</label>)}</div><p className="text-xs text-slate-500">Church Admin does not collect EIN values, identity documents, payment credentials, or provider secrets in this wizard.</p></> : null}
        {step === 2 ? <div className="space-y-4"><label className="block text-sm font-semibold">Organization type<select value={String(draft.organization_type ?? "")} onChange={(event) => patch("organization_type", event.target.value)} className="mt-2 w-full rounded-2xl border bg-white px-4 py-3 font-normal"><option value="">Choose one</option><option value="nonprofit_church">Registered church or nonprofit</option><option value="unincorporated_fellowship">Unincorporated fellowship or ministry</option><option value="other">Other faith organization</option></select></label>{draft.has_website ? <label className="block text-sm font-semibold">Website (optional)<input value={String(draft.website_url ?? "")} onChange={(event) => patch("website_url", event.target.value)} className="mt-2 w-full rounded-2xl border px-4 py-3 font-normal" placeholder="https://example.org" /></label> : null}</div> : null}
        {step === 3 ? <div className="grid gap-4 sm:grid-cols-2">{[["Representative name","representative_name","Jordan Smith"],["Role or title","representative_title","Pastor, administrator, or treasurer"],["Business email","representative_email","name@church.org"],["Phone (optional)","representative_phone","(555) 555-5555"]].map(([label,key,placeholder]) => <label key={key} className="text-sm font-semibold">{label}<input value={String(draft[key] ?? "")} onChange={(event) => patch(key, event.target.value)} placeholder={placeholder} className="mt-2 w-full rounded-2xl border px-4 py-3 font-normal" /></label>)}</div> : null}
        {step === 4 ? <><div><div className="text-sm font-semibold">Messaging purposes</div><div className="mt-3 grid gap-3 sm:grid-cols-2">{purposeOptions.map(([value,label]) => <label key={value} className="flex items-center gap-3 rounded-2xl border p-4 text-sm"><input type="checkbox" checked={(draft.messaging_purposes ?? []).includes(value)} onChange={() => toggle("messaging_purposes", value)} />{label}</label>)}</div></div><label className="block text-sm font-semibold">Estimated monthly message segments<input type="number" min="0" value={String(draft.estimated_monthly_segments ?? "")} onChange={(event) => patch("estimated_monthly_segments", Number(event.target.value))} className="mt-2 w-full rounded-2xl border px-4 py-3 font-normal" placeholder="1000" /></label></> : null}
        {step === 5 ? <><div className="text-sm font-semibold">How does your organization obtain permission to text people?</div><div className="grid gap-3 sm:grid-cols-2">{consentOptions.map(([value,label]) => <label key={value} className="flex items-center gap-3 rounded-2xl border p-4 text-sm"><input type="checkbox" checked={(draft.consent_methods ?? []).includes(value)} onChange={() => toggle("consent_methods", value)} />{label}</label>)}</div><div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">STOP requests and staff suppressions will always override the organization attestation and every audience source.</div></> : null}
        {step === 6 ? <div className="space-y-4">{[["Announcement sample","sample_announcement","Grace Church: Sunday service begins at 10 AM. Reply STOP to opt out."],["Reminder sample (optional)","sample_reminder","Reminder: your small group meets tomorrow at 7 PM."],["Follow-up sample (optional)","sample_follow_up","Thank you for visiting. We would love to welcome you again."],["HELP reply","sample_help_reply","Grace Church: Reply STOP to opt out. Contact the church office for help."],["STOP reply","sample_stop_reply","You have been unsubscribed and will receive no further texts from Grace Church."]].map(([label,key,placeholder]) => <label key={key} className="block text-sm font-semibold">{label}<textarea value={String(draft[key] ?? "")} onChange={(event) => patch(key, event.target.value)} placeholder={placeholder} className="mt-2 min-h-20 w-full rounded-2xl border px-4 py-3 font-normal" /></label>)}</div> : null}
        {step === 7 ? <div className="space-y-4"><label className="block text-sm font-semibold">Phone-number preference<select value={String(draft.number_preference ?? "")} onChange={(event) => patch("number_preference", event.target.value)} className="mt-2 w-full rounded-2xl border bg-white px-4 py-3 font-normal"><option value="">Choose one</option><option value="new_number">Get a new local number</option><option value="port_existing">Explore moving an existing number</option><option value="undecided">Not sure yet</option></select></label><label className="block text-sm font-semibold">Preferred US area code (optional)<input inputMode="numeric" maxLength={3} value={String(draft.area_code_preference ?? "")} onChange={(event) => patch("area_code_preference", event.target.value.replace(/\D/g, "").slice(0,3))} className="mt-2 w-full rounded-2xl border px-4 py-3 font-normal" placeholder="615" /></label><p className="text-xs text-slate-500">This is only a preference. Number availability cannot be guaranteed.</p></div> : null}
        {step === 8 ? <><div className="grid gap-3 sm:grid-cols-2">{[["Organization",draft.organization_type],["Representative",draft.representative_name],["Purposes",(draft.messaging_purposes ?? []).join(", ")],["Monthly estimate",draft.estimated_monthly_segments],["Consent practices",(draft.consent_methods ?? []).join(", ")],["Number preference",draft.number_preference]].map(([label,value]) => <div key={String(label)} className="rounded-2xl border p-4"><div className="text-xs font-semibold uppercase text-slate-500">{String(label)}</div><div className="mt-1 text-sm">{String(value ?? "Not supplied")}</div></div>)}</div><label className="flex items-start gap-3 rounded-2xl border border-primary/25 bg-primary/5 p-4 text-sm"><input className="mt-1" type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span><span className="font-semibold">Organization consent attestation</span><span className="mt-1 block text-slate-700">{SMS_ATTESTATION_STATEMENT}</span><span className="mt-2 block text-xs text-slate-500">Version {SMS_ATTESTATION_VERSION}. Your user, role, exact statement, and timestamp will be permanently recorded.</span></span></label><div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Completing setup changes the status to <strong>Ready for provider</strong>. It does not activate SMS or send any message.</div></> : null}
      </div>
      <div className="flex items-center justify-between gap-3 border-t px-5 py-4 sm:px-7"><button type="button" disabled={step === 1 || saving} onClick={() => move(step - 1)} className="rounded-2xl border px-5 py-2.5 text-sm font-semibold hover:bg-slate-50 disabled:opacity-40">Back</button><div className="text-xs text-slate-500">{saving ? "Saving..." : "Progress saved"}</div>{step < 8 ? <button type="button" disabled={saving} onClick={() => move(step + 1)} className="rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Continue</button> : <button type="button" disabled={saving || !confirmed} onClick={complete} className="rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Complete setup</button>}</div>
    </section>
  </div>;
}
