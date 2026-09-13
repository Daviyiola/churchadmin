"use client";

import { useEffect, useState } from "react";
import { normalizeUsSmsPhone } from "@/lib/sms/phone";
import { currentSmsPermissions, permissionKey, type SmsCategory, type SmsPermissionEvent } from "@/lib/sms/permissions";

type RequestApi = (url: string, init?: RequestInit) => Promise<unknown>;
type Props = { orgId: string; people: Array<{ id: string; name: string; phone: string | null }>; request: RequestApi; onChanged: () => void };
function localNow() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function SmsPermissions({ orgId, people, request, onChanged }: Props) {
  const [phone, setPhone] = useState("");
  const [category, setCategory] = useState<SmsCategory>("informational");
  const [status, setStatus] = useState<"granted" | "revoked">("granted");
  const [method, setMethod] = useState("verbal");
  const [obtainedAt, setObtainedAt] = useState(localNow);
  const [disclosure, setDisclosure] = useState("");
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [events, setEvents] = useState<SmsPermissionEvent[]>([]);
  const [blocked, setBlocked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [revision, setRevision] = useState(0);
  const normalized = normalizeUsSmsPhone(phone);
  const e164 = normalized.ok ? normalized.e164 : "";
  useEffect(() => {
    let active = true;
    setEvents([]); setBlocked(false); setError("");
    if (!e164) { setLoading(false); return; }
    setLoading(true);
    request(`/api/communications/sms/permissions?organization_id=${encodeURIComponent(orgId)}&phone=${encodeURIComponent(e164)}`)
      .then((payload) => { const data = payload as { events: SmsPermissionEvent[]; suppression: unknown }; if (active) { setEvents(data.events); setBlocked(!!data.suppression); } })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Unable to load permission history."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [e164, orgId, request, revision]);
  function choosePhone(value: string) {
    setPhone(value); setConfirmed(false); setDisclosure(""); setNote(""); setSuccess(""); setObtainedAt(localNow());
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError(""); setSuccess("");
    try {
      await request("/api/communications/sms/permissions", { method: "POST", body: JSON.stringify({
        organization_id: orgId, phone, category, status, method, confirmed,
        obtained_at: status === "granted" ? new Date(obtainedAt).toISOString() : undefined,
        disclosure, evidence_note: note,
      }) });
      setConfirmed(false); setDisclosure(""); setNote("");
      setSuccess(status === "granted" ? "Permission recorded. Existing blocks still apply." : "Opt-out recorded for this message category.");
      setRevision((value) => value + 1); onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to record permission."); }
    finally { setSaving(false); }
  }
  const current = currentSmsPermissions(events);
  const inputClass = "mt-2 w-full rounded-2xl border bg-white px-4 py-3 font-normal";
  return <div className="space-y-5 p-5 sm:p-6">
    <div><h2 className="text-lg font-semibold">SMS permission</h2><p className="mt-1 text-sm text-slate-600">Record an actual conversation or written permission. The staff member and recording time are saved automatically. This does not send a message.</p></div>
    {error ? <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}
    {success ? <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{success}</div> : null}
    <form onSubmit={submit} className="space-y-5">
      <fieldset disabled={saving} className="space-y-5 disabled:opacity-60">
        <label className="block text-sm font-semibold">Choose a directory contact (optional)
          <select aria-label="Directory contact" value="" onChange={(e) => choosePhone(e.target.value)} className={inputClass}><option value="">Select a person, or enter a number below</option>{people.filter((p) => p.phone).map((person) => <option key={person.id} value={person.phone!}>{person.name} · {person.phone}</option>)}</select>
        </label>
        <label className="block text-sm font-semibold">Phone number<input type="tel" required value={phone} onChange={(e) => choosePhone(e.target.value)} className={inputClass} /></label>
        {e164 ? <div className="rounded-2xl border bg-slate-50 p-4 text-sm" aria-live="polite">
          {loading ? "Loading permission history…" : <><div className="font-semibold">{e164}</div>{(["informational", "promotional"] as const).map((value) => <div key={value} className="mt-1 capitalize">{value}: {current.get(permissionKey(e164, value))?.status === "granted" ? "Permission recorded" : current.get(permissionKey(e164, value))?.status === "revoked" ? "Opted out" : "No permission recorded"}</div>)}</>}
          {blocked ? <p className="mt-3 font-semibold text-amber-800">This number is blocked. Recording permission will not remove the block.</p> : null}
        </div> : null}
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block text-sm font-semibold">Message category<select value={category} onChange={(e) => { const next = e.target.value as SmsCategory; setCategory(next); setMethod(next === "promotional" ? "written" : "verbal"); setConfirmed(false); }} className={inputClass}><option value="informational">Informational church updates</option><option value="promotional">Promotional messages / fundraising</option></select></label>
          <label className="block text-sm font-semibold">Person’s choice<select value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setConfirmed(false); }} className={inputClass}><option value="granted">Gave permission</option><option value="revoked">Opted out of this category</option></select></label>
        </div>
        {status === "granted" ? <div className="grid gap-5 sm:grid-cols-2">
          <label className="block text-sm font-semibold">How permission was received<select value={method} onChange={(e) => { setMethod(e.target.value); setConfirmed(false); }} className={inputClass}>{category === "informational" ? <option value="verbal">Verbal conversation</option> : null}<option value="written">Written permission</option></select></label>
          <label className="block text-sm font-semibold">When permission was received<input required type="datetime-local" max={localNow()} value={obtainedAt} onChange={(e) => { setObtainedAt(e.target.value); setConfirmed(false); }} className={inputClass} /><span className="mt-1 block text-xs font-normal text-slate-500">Your local time. Use the actual conversation or agreement time.</span></label>
        </div> : null}
        <label className="block text-sm font-semibold">{status === "granted" ? "What did the person agree to?" : "What did the person ask to stop?"}<textarea required minLength={20} maxLength={5000} value={disclosure} onChange={(e) => { setDisclosure(e.target.value); setConfirmed(false); }} className={`${inputClass} min-h-28`} placeholder={status === "granted" ? "Record the church name, types of texts, and the explanation given when they agreed." : "Record the person's opt-out request."} /></label>
        {status === "granted" ? <p className="text-sm text-slate-600">Explain who sends the texts, what they cover, expected frequency, possible message/data charges, and how to stop them. Make the church’s SMS terms and privacy policy available. Record what was actually explained; don’t add disclosures to an old conversation that never included them.</p> : null}
        <label className="block text-sm font-semibold">{status === "granted" && method === "written" ? "Where is the written evidence retained?" : "Additional notes (optional)"}<textarea required={status === "granted" && method === "written"} minLength={status === "granted" && method === "written" ? 10 : undefined} maxLength={2000} value={note} onChange={(e) => { setNote(e.target.value); setConfirmed(false); }} className={`${inputClass} min-h-20`} /></label>
        <label className="flex items-start gap-3 rounded-2xl border p-4 text-sm"><input type="checkbox" required checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1" /><span>I personally received this choice, or reviewed its evidence, and this record accurately describes it.</span></label>
        <button disabled={!e164 || !confirmed || loading || saving} className="rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{saving ? "Saving…" : status === "granted" ? "Record permission" : "Record opt-out"}</button>
      </fieldset>
    </form>
    {events.length ? <details className="rounded-2xl border p-4"><summary className="cursor-pointer font-semibold">Permission history ({events.length})</summary><div className="mt-3 max-h-96 space-y-3 overflow-y-auto">{events.map((event) => <article key={event.id} className="rounded-xl border p-3 text-sm"><div className="font-semibold capitalize">{event.category} · {event.status} · {event.method.replaceAll("_", " ")}</div><div className="mt-1 text-xs text-slate-500">Received {new Date(event.obtained_at).toLocaleString()} · Recorded {new Date(event.created_at).toLocaleString()}</div><p className="mt-2 whitespace-pre-wrap break-words">{event.disclosure}</p>{event.evidence_note ? <p className="mt-2 whitespace-pre-wrap break-words text-slate-600">{event.evidence_note}</p> : null}</article>)}</div></details> : null}
  </div>;
}
