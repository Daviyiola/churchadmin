"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { getAccessToken, getActiveOrgId } from "@/lib/auth";
import { supabase } from "@/lib/supabaseClient";
import { friendlyTimezoneName, timezoneOptions } from "@/lib/timezones";
import { hasMailingAddress, MAILING_FIELDS, type MailingField } from "@/lib/onboarding";
import { setUnsaved } from "@/lib/unsaved";

const fieldClass = "mt-2 w-full rounded-2xl border bg-white px-4 py-3 text-sm";
const addressLabels: Record<MailingField, string> = { mailing_address_line1: "Street address or PO box", mailing_address_line2: "Address line 2 (optional)", mailing_city: "City", mailing_state: "State / province / region", mailing_postal_code: "Postal code", mailing_country: "Country" };
const zones = timezoneOptions();
export default function SetupPage() {
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("");
  const [address, setAddress] = useState<Record<string, string>>({});
  const [skipAddress, setSkipAddress] = useState(false);
  const [logo, setLogo] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [inviteUrl, setInviteUrl] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");

  async function api(path: string, body?: Record<string, unknown>, method = "POST") {
    const token = await getAccessToken();
    if (!token) throw new Error("Your session expired. Sign in again to continue setup.");
    const response = await fetch(path, { method: body ? method : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Unable to continue. Please try again.");
    return data;
  }
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const orgId = getActiveOrgId();
      if (!orgId) throw new Error("Select an organization by signing in again.");
      const data = await api(`/api/org/setup?organization_id=${encodeURIComponent(orgId)}`);
      const settings = data.settings ?? {};
      setName(data.organization.name);
      setTimezone(settings.timezone_name || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
      setAddress(Object.fromEntries(MAILING_FIELDS.map(key => [key, settings[key] ?? ""])));
      setSkipAddress(false);
      setLogo(settings.use_default_logo ? null : settings.logo_path ?? null);
      setLoaded(true);
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to load setup."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setUnsaved(dirty); return () => setUnsaved(false); }, [dirty]);
  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, [step]);
  useEffect(() => { if (error) document.getElementById("setup-error")?.scrollIntoView({ behavior: "smooth", block: "center" }); }, [error]);
  function change() { setDirty(true); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const orgId = getActiveOrgId();
      if (!orgId) throw new Error("Sign in again to continue.");
      let path = logo;
      if (file) {
        const extension = file.type === "image/png" ? "png" : file.type === "image/svg+xml" ? "svg" : "jpg";
        path = `org/${orgId}/logo-${crypto.randomUUID()}.${extension}`;
        const { error } = await supabase.storage.from("org-logos").upload(path, file, { contentType: file.type, cacheControl: "3600" });
        if (error) throw new Error(`Logo upload failed: ${error.message}. You can remove the logo and add it later.`);
        setLogo(path); setFile(null);
      }
      await api("/api/org/setup", { organization_id: orgId, name, timezone_name: timezone, logo_path: path, ...Object.fromEntries(MAILING_FIELDS.map(key => [key, skipAddress ? null : address[key] || null])) }, "PATCH");
      setDirty(false); setUnsaved(false);
      window.dispatchEvent(new Event("org-settings-updated"));
      setStep(2);
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to save setup."); }
    finally { setBusy(false); }
  }
  async function invite(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const data = await api("/api/invites/create", { organization_id: getActiveOrgId(), invited_email: email, role });
      setInviteUrl(data.inviteUrl);
      setInviteMessage(data.emailed ? "Invitation emailed. The link expires in 7 days." : "Invitation created, but the email could not be sent. Copy and share the link below. It expires in 7 days.");
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to invite. You can try again or do this later."); }
    finally { setBusy(false); }
  }
  const logoUrl = preview || (logo ? supabase.storage.from("org-logos").getPublicUrl(logo).data.publicUrl : null);
  return <div className="mx-auto max-w-3xl px-4 py-6 sm:p-8">
    <p className="text-sm text-slate-500">Account verified · Step {step} of 2</p>
    <h1 className="mt-2 text-3xl font-semibold">{step === 1 ? "Make this workspace yours" : "Your workspace is ready"}</h1>
    <p className="mt-3 text-sm text-slate-600">{step === 1 ? "Review your organization details. Your logo and mailing address are optional, and everything here can be changed later in Settings." : "Invite someone to help, or head to your dashboard. You can invite more people in Settings → Manage users."}</p>
    {error && <div id="setup-error" role="alert" className="my-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
    {loading ? <p role="status" className="py-8">Loading your organization…</p> : !loaded ? <div className="mt-5 flex gap-4"><button onClick={load} className="rounded-2xl border px-4 py-3">Try again</button><Link href="/signin" className="rounded-2xl border px-4 py-3">Sign in</Link></div> : step === 1 ? <form onSubmit={save} className="mt-6 space-y-5">
      <fieldset disabled={busy} className="space-y-5 disabled:opacity-60">
        <section className="rounded-3xl border bg-white p-5 sm:p-6">
          <h2 className="text-lg font-semibold">Organization & branding</h2>
          <label htmlFor="setup-name" className="mt-5 block text-sm font-medium">Organization name</label><input id="setup-name" required minLength={2} maxLength={120} autoComplete="organization" className={fieldClass} value={name} onChange={e => { setName(e.target.value); change(); }} />
          <label htmlFor="setup-logo" className="mt-5 block text-sm font-medium">Logo (optional)</label>
          <p className="mt-1 text-xs text-slate-500">PNG, JPG, or SVG, up to 2 MB. We’ll use the Church Admin logo if you skip this.</p>
          {logoUrl && <Image unoptimized src={logoUrl} alt="Organization logo preview" width={160} height={96} className="mt-4 h-24 w-40 rounded-xl border object-contain p-2" />}
          <input id="setup-logo" type="file" accept="image/png,image/jpeg,image/svg+xml" className={fieldClass} onChange={e => {
            const selected = e.target.files?.[0]; if (!selected) return;
            if (!["image/png", "image/jpeg", "image/svg+xml"].includes(selected.type) || selected.size > 2000 * 1024) { setError("Choose a PNG, JPG, or SVG logo up to 2 MB."); e.target.value = ""; return; }
            setFile(selected); setError(""); change();
          }} />
          {(file || logo) && <button type="button" onClick={() => { setFile(null); setLogo(null); change(); }} className="mt-3 text-sm underline">Use default logo</button>}
          <label htmlFor="setup-timezone" className="mt-5 block text-sm font-medium">Organization timezone</label><select id="setup-timezone" required className={fieldClass} value={timezone} onChange={e => { setTimezone(e.target.value); change(); }}>{[...new Set([timezone, ...zones])].filter(Boolean).map(zone => <option key={zone} value={zone}>{friendlyTimezoneName(zone)} — {zone}</option>)}</select>
          <p className="mt-2 text-xs text-slate-500">Check the suggested timezone. This controls dates and scheduled activity for your organization.</p>
        </section>
        <section className="rounded-3xl border bg-white p-5 sm:p-6">
          <h2 className="text-lg font-semibold">Mailing address & email</h2>
          <p className="mt-2 text-sm text-slate-600">Church emails need a complete physical mailing address for the email footer. If you skip it, church email sending stays disabled until you add one in Settings. Account verification and team invitations still work.</p>
          <label className="mt-4 flex items-start gap-3 rounded-2xl bg-slate-50 p-4 text-sm"><input type="checkbox" checked={skipAddress} onChange={e => { setSkipAddress(e.target.checked); change(); }} className="mt-1" /><span>Add the address later. I understand church emails will be disabled.</span></label>
          {!skipAddress && <div className="mt-4 grid gap-4 sm:grid-cols-2">{MAILING_FIELDS.map(key => <div key={key} className={key.startsWith("mailing_address") ? "sm:col-span-2" : ""}><label htmlFor={key} className="text-sm font-medium">{addressLabels[key]}</label><input id={key} required={key !== "mailing_address_line2"} maxLength={200} className={fieldClass} value={address[key] ?? ""} onChange={e => { setAddress(value => ({ ...value, [key]: e.target.value })); change(); }} /></div>)}</div>}
        </section>
      </fieldset>
      <div className="flex flex-wrap items-center gap-4"><button disabled={busy} className="rounded-2xl bg-primary px-5 py-3 font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save and continue"}</button><Link href="/app" className="text-sm underline">Finish later</Link></div>
    </form> : <div className="mt-6 space-y-5">
      <div className="rounded-2xl bg-slate-50 p-4 text-sm">{skipAddress || !hasMailingAddress(address) ? "Church emails are disabled until you add a complete mailing address in Organization settings." : "Mailing address saved. Church emails can be sent within your plan’s allowance."}</div>
      <form onSubmit={invite} className="rounded-3xl border bg-white p-5 sm:p-6">
        <h2 className="text-lg font-semibold">Invite a team member (optional)</h2>
        <p className="mt-2 text-sm text-slate-600">Admin and Finance invitations use management seats, including pending invitations. If your plan is full, you can invite a Member or upgrade later.</p>
        <label htmlFor="team-email" className="mt-5 block text-sm font-medium">Team member’s email</label><input id="team-email" required type="email" disabled={busy || !!inviteUrl} value={email} onChange={e => setEmail(e.target.value)} className={fieldClass} />
        <label htmlFor="team-role" className="mt-4 block text-sm font-medium">Role</label><select id="team-role" value={role} disabled={busy || !!inviteUrl} onChange={e => setRole(e.target.value)} className={fieldClass}><option value="member">Member</option><option value="finance">Finance</option><option value="admin">Admin</option></select>
        <p className="mt-2 text-xs text-slate-500">{role === "admin" ? "Admins help manage the organization and users. Only owners manage billing." : role === "finance" ? "Finance users can work with financial records and reports." : "Members have basic workspace access without organization administration."}</p>
        {!inviteUrl && <button disabled={busy} className="mt-5 rounded-2xl border px-4 py-3 text-sm font-semibold disabled:opacity-50">{busy ? "Creating invitation…" : "Send invitation"}</button>}
        {inviteUrl && <div className="mt-4 rounded-2xl bg-slate-50 p-4"><p role="status" className="text-sm">{inviteMessage}</p><label htmlFor="invite-link" className="mt-3 block text-sm">Invitation link</label><input id="invite-link" readOnly value={inviteUrl} className={fieldClass} /><button type="button" className="mt-3 text-sm underline" onClick={async () => { try { await navigator.clipboard.writeText(inviteUrl); setInviteMessage("Link copied."); } catch { setInviteMessage("Select and copy the link above."); } }}>Copy link</button></div>}
      </form>
      <div className="flex flex-wrap items-center gap-4"><Link href="/app" className="rounded-2xl bg-primary px-5 py-3 font-semibold text-white">{inviteUrl ? "Go to dashboard" : "Skip invitation and open dashboard"}</Link><button disabled={busy} onClick={() => { setStep(1); setError(""); }} className="text-sm underline">Back to organization details</button></div>
      <p className="text-sm text-slate-500">Next steps: <Link href="/app/settings/org" className="underline">colors & report branding</Link>, <Link href="/app/categories" className="underline">service categories</Link>, and <Link href="/app/settings/billing" className="underline">plan & usage</Link>.</p>
    </div>}
  </div>;
}
