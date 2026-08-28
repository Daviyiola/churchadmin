"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

async function accessToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export default function AccountEmailPreferencesPage() {
  const [productUpdates, setProductUpdates] = useState(true);
  const [onboardingTips, setOnboardingTips] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void (async () => {
      const token = await accessToken();
      if (!token) return setLoading(false);
      const response = await fetch("/api/account/email-preferences", { headers: { Authorization: `Bearer ${token}` } });
      const json = await response.json();
      if (response.ok) {
        setProductUpdates(Boolean(json.product_updates));
        setOnboardingTips(Boolean(json.onboarding_tips));
      } else setMessage(json.error ?? "Unable to load preferences.");
      setLoading(false);
    })();
  }, []);

  async function save() {
    const token = await accessToken();
    if (!token) return;
    setSaving(true);
    setMessage("");
    const response = await fetch("/api/account/email-preferences", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ product_updates: productUpdates, onboarding_tips: onboardingTips }),
    });
    const json = await response.json();
    setMessage(response.ok ? "Preferences saved." : json.error ?? "Unable to save preferences.");
    setSaving(false);
  }

  return <div className="p-6">
    <div className="max-w-2xl rounded-3xl border bg-white p-6">
      <h1 className="text-xl font-semibold">My email preferences</h1>
      <p className="mt-1 text-sm text-slate-600">These choices apply to optional Church Admin emails. Account, security, billing, invitation, and material policy emails remain enabled.</p>
      {loading ? <p className="mt-6 text-sm text-slate-600">Loading…</p> : <div className="mt-6 space-y-3">
        <label className="flex items-start gap-3 rounded-2xl border p-4"><input type="checkbox" checked={productUpdates} onChange={(e) => setProductUpdates(e.target.checked)} className="mt-1" /><span><strong className="block">Product updates</strong><span className="text-sm text-slate-600">Occasional news about Church Admin features and improvements.</span></span></label>
        <label className="flex items-start gap-3 rounded-2xl border p-4"><input type="checkbox" checked={onboardingTips} onChange={(e) => setOnboardingTips(e.target.checked)} className="mt-1" /><span><strong className="block">Onboarding tips</strong><span className="text-sm text-slate-600">Helpful guidance for setting up and using Church Admin.</span></span></label>
        {message ? <p className="text-sm text-slate-600">{message}</p> : null}
        <button onClick={save} disabled={saving} className="rounded-2xl bg-primary px-5 py-2.5 font-semibold text-white disabled:opacity-60">{saving ? "Saving…" : "Save preferences"}</button>
      </div>}
    </div>
  </div>;
}
