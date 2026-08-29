"use client";

import { useState } from "react";
import { getAccessToken, getActiveOrgId, getActiveOrgRole } from "@/lib/auth";

const TOPICS = [
  ["broadcast", "Broadcasts"],
  ["followup", "Follow-ups"],
  ["form_invite", "Form invitations"],
  ["giving_statement", "Giving statements"],
] as const;

type State = {
  contact: { preferences: Record<string, boolean> };
  eligibility: Record<string, { eligible: boolean; reason: string }>;
};

export default function EmailDeliverySettingsPage() {
  const canResubscribe = ["owner", "admin"].includes(getActiveOrgRole() ?? "");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function request(method: "GET" | "POST", body?: Record<string, unknown>) {
    const orgId = getActiveOrgId();
    const token = await getAccessToken();
    if (!orgId || !token) throw new Error("No active organization selected.");
    const url = method === "GET"
      ? `/api/communications/email-preferences?organization_id=${encodeURIComponent(orgId)}&email=${encodeURIComponent(email)}`
      : "/api/communications/email-preferences";
    const response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify({ organization_id: orgId, email, ...body }) } : {}),
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error ?? "Unable to update delivery preferences.");
    return json;
  }

  async function lookup() {
    setBusy(true); setMessage(""); setState(null);
    try { setState(await request("GET")); } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to look up this address."); }
    setBusy(false);
  }

  async function change(subscribed: boolean) {
    if (subscribed && !reason.trim()) return setMessage("Enter the recipient's affirmative-consent reason before resubscribing.");
    setBusy(true); setMessage("");
    try {
      await request("POST", { topics: TOPICS.map(([topic]) => topic), subscribed, reason: subscribed ? reason.trim() : "Suppressed by organization staff" });
      setState(await request("GET"));
      setMessage(subscribed ? "Resubscription recorded." : "All optional church emails disabled for this organization.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to update preferences."); }
    setBusy(false);
  }

  return <div className="p-6"><div className="max-w-3xl rounded-3xl border bg-white p-6">
    <h1 className="text-xl font-semibold">Email delivery</h1>
    <p className="mt-1 text-sm text-slate-600">Look up an address without exposing provider internals. Provider hard-bounce and complaint suppressions cannot be overridden here.</p>
    <div className="mt-6 flex flex-col gap-3 sm:flex-row"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="recipient@example.com" className="min-w-0 flex-1 rounded-2xl border px-4 py-2.5" /><button onClick={lookup} disabled={busy || !email.trim()} className="rounded-2xl bg-primary px-5 py-2.5 font-semibold text-white disabled:opacity-50">Check delivery</button></div>
    {state ? <div className="mt-6 space-y-3">
      {TOPICS.map(([topic, label]) => { const item = state.eligibility[topic]; return <div key={topic} className="flex items-center justify-between rounded-2xl border px-4 py-3"><span className="font-medium">{label}</span><span className={`rounded-full px-3 py-1 text-xs font-semibold ${item?.eligible ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{item?.eligible ? "Eligible" : item?.reason === "suppressed" ? "Delivery suppressed" : "Unsubscribed"}</span></div>; })}
      {canResubscribe ? <label className="block text-sm"><span className="font-semibold">Affirmative-consent reason (required to resubscribe)</span><textarea value={reason} onChange={(e) => setReason(e.target.value)} className="mt-2 min-h-24 w-full rounded-2xl border p-3" placeholder="For example: Recipient requested resubscription by email on Aug 27, 2026." /></label> : null}
      <div className="flex flex-wrap gap-3"><button disabled={busy} onClick={() => void change(false)} className="rounded-2xl border border-red-200 px-4 py-2.5 font-semibold text-red-700">Disable all optional church email</button>{canResubscribe ? <button disabled={busy} onClick={() => void change(true)} className="rounded-2xl border px-4 py-2.5 font-semibold">Record resubscription</button> : null}</div>
    </div> : null}
    {message ? <p className="mt-4 text-sm text-slate-600">{message}</p> : null}
  </div></div>;
}
