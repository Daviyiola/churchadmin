"use client";

import { useEffect, useState } from "react";
import BrandLogo from "@/components/BrandLogo";
import { CHURCH_EMAIL_TOPICS, type ChurchEmailTopic } from "@/lib/server/email/types";

const LABELS: Record<ChurchEmailTopic, { title: string; detail: string }> = {
  broadcast: { title: "Announcements and broadcasts", detail: "General news, events, and church-wide messages." },
  followup: { title: "Visitor follow-ups", detail: "Manual and scheduled follow-up messages." },
  form_invite: { title: "Form invitations", detail: "Personal links to complete church forms." },
  giving_statement: { title: "Giving statements", detail: "Contribution statements and giving reports." },
};

export default function EmailPreferencesClient({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [organization, setOrganization] = useState("Church");
  const [email, setEmail] = useState("");
  const [preferences, setPreferences] = useState<Record<ChurchEmailTopic, boolean>>(() => Object.fromEntries(CHURCH_EMAIL_TOPICS.map((topic) => [topic, true])) as Record<ChurchEmailTopic, boolean>);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [linkTopic, setLinkTopic] = useState<ChurchEmailTopic | null>(null);

  useEffect(() => {
    fetch(`/api/email/preferences?token=${encodeURIComponent(token)}`)
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error); return data; })
      .then((data) => { setOrganization(data.organization_name); setEmail(data.email_masked); setPreferences(data.preferences); setLinkTopic(data.link_topic ?? null); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load preferences."))
      .finally(() => setLoading(false));
  }, [token]);

  async function save(unsubscribeAll = false) {
    setSaving(true); setError(""); setMessage("");
    try {
      const appliedPreferences = linkTopic ? { [linkTopic]: preferences[linkTopic] } : preferences;
      const response = await fetch("/api/email/preferences", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, preferences: appliedPreferences, unsubscribe_all: unsubscribeAll }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      if (data.preferences) setPreferences(data.preferences);
      setMessage(unsubscribeAll ? "You have been unsubscribed from all optional emails from this church." : "Your email preferences have been saved.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save preferences."); }
    finally { setSaving(false); }
  }

  return <main className="min-h-screen bg-slate-50 px-5 py-10 text-slate-900">
    <div className="mx-auto max-w-xl rounded-3xl border bg-white p-6 shadow-sm sm:p-8">
      <div className="flex items-center gap-3"><BrandLogo size={44}/><div><div className="text-xl font-semibold">{organization}</div><div className="text-sm text-slate-500">Email preferences · {email}</div></div></div>
      <h1 className="mt-8 text-2xl font-semibold">Choose what you receive</h1>
      <p className="mt-2 text-sm text-slate-600">These choices apply only to emails from {organization} sent through Church Admin.</p>
      {loading ? <div className="mt-8 text-sm text-slate-500">Loading your preferences…</div> : error && !email ? <div className="mt-8 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : <>
        <div className="mt-6 divide-y rounded-2xl border">{CHURCH_EMAIL_TOPICS.filter((topic) => !linkTopic || topic === linkTopic).map((topic) => <label key={topic} className="flex cursor-pointer items-start justify-between gap-4 p-4"><span><span className="block font-medium">{LABELS[topic].title}</span><span className="mt-1 block text-sm text-slate-500">{LABELS[topic].detail}</span></span><input type="checkbox" className="mt-1 h-5 w-5 accent-[rgb(var(--primary))]" checked={preferences[topic]} onChange={(event) => setPreferences((current) => ({ ...current, [topic]: event.target.checked }))}/></label>)}</div>
        {error ? <div className="mt-4 text-sm text-red-600">{error}</div> : null}{message ? <div className="mt-4 text-sm text-emerald-700">{message}</div> : null}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row"><button disabled={saving} onClick={() => void save(false)} className="rounded-2xl bg-primary px-5 py-3 font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Save preferences"}</button>{!linkTopic ? <button disabled={saving} onClick={() => void save(true)} className="rounded-2xl border px-5 py-3 font-semibold disabled:opacity-50">Unsubscribe from all</button> : null}</div>
      </>}
      <p className="mt-8 text-xs leading-5 text-slate-500">Essential Church Admin account, security, invitation, and billing messages are managed separately.</p>
    </div>
  </main>;
}
