"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import TurnstileWidget from "@/components/forms/TurnstileWidget";

type Payload = {
  organization: { name: string; logo_url: string | null };
  qr_name: string; service_name: string; session_date: string | null; timezone: string;
  status: "open" | "scheduled" | "preparing" | "closed"; window: { opens_at: string; closes_at: string } | null;
  remembered_profiles: Array<{ id: string; label: string }>;
};

export default function AttendanceCheckinClient({ signedCode }: { signedCode: string }) {
  const [loadError, setLoadError] = useState("");
  const [payload,setPayload]=useState<Payload|null>(null); const [error,setError]=useState(""); const [loading,setLoading]=useState(true);
  const [first,setFirst]=useState(""); const [last,setLast]=useState(""); const [phone,setPhone]=useState(""); const [email,setEmail]=useState("");
  const [remember,setRemember]=useState(false); const [turnstile,setTurnstile]=useState(""); const [reset,setReset]=useState(0); const [busy,setBusy]=useState(false);
  const [needsIdentifier,setNeedsIdentifier]=useState(false); const [confirmation,setConfirmation]=useState<{handle:string;name:string}|null>(null); const [success,setSuccess]=useState("");
  const endpoint=`/api/attendance/public/${encodeURIComponent(signedCode)}`;
  const request = useCallback(async (path: string, body?: unknown) => {
    const res = await fetch(path, { method: body === undefined ? "GET" : "POST", cache: "no-store", ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Unable to complete check-in. Please try again.");
    return data;
  }, []);
  
  const load = useCallback(async () => {
    try { const body = await request(endpoint); setPayload(body); setLoadError(""); }
    catch (error) { setLoadError(error instanceof Error ? error.message : "Unable to load check-in."); }
    finally { setLoading(false); }
  }, [endpoint, request]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => {
    if (busy || confirmation) return;
    const timer = window.setInterval(() => { if (document.visibilityState !== "hidden") void load(); }, 15000);
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [load, busy, confirmation]);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); }
    catch (error) { setError(error instanceof Error ? error.message : "Unable to complete check-in. Please try again."); }
    finally { setBusy(false); }
  }
  async function identify() {
    await run(async () => {
      let body;
      try { body = await request(`${endpoint}/identify`, { request_id: crypto.randomUUID(), first_name: first, last_name: last, phone, email, remember, website: "", turnstile_token: turnstile }); }
      finally { setReset(value => value + 1); }
      if (body.needs_identifier) { setNeedsIdentifier(true); setError(body.message); return; }
      if (body.confirmation_handle) { setConfirmation({ handle: body.confirmation_handle, name: body.submitted_name }); return; }
      setSuccess(body.message || "Thanks. Church staff will review your check-in.");
    });
  }
  async function confirm(accepted = true) {
    if (!confirmation) return;
    await run(async () => {
      const body = await request(`${endpoint}/confirm`, { confirmation_handle: confirmation.handle, accepted });
      setSuccess(body.message || (body.state === "duplicate" ? "You are already checked in." : `You're checked in, ${body.display_name}.`));
      setConfirmation(null); await load();
    });
  }
  async function remembered(profile: { id: string; label: string }) {
    await run(async () => {
      const body = await request(`${endpoint}/remembered-checkin`, { profile_id: profile.id, request_id: crypto.randomUUID() });
      setSuccess(body.state === "duplicate" ? `${profile.label} is already checked in.` : `${profile.label} is checked in.`);
    });
  }
  async function forget(profileId?: string) {
    await run(async () => { await request(`${endpoint}/forget`, profileId ? { profile_id: profileId } : {}); await load(); });
  }
  if(loading)return <main className="min-h-screen bg-slate-50 p-6 text-center text-slate-600">Loading check-in…</main>;
  return <main className="min-h-screen bg-slate-50 px-4 py-8"><div className="mx-auto max-w-2xl overflow-hidden rounded-3xl border bg-white shadow-sm">
    <header className="flex items-center gap-4 border-b p-6">{payload?.organization.logo_url?<Image src={payload.organization.logo_url} alt="" width={58} height={58} className="h-14 w-14 object-contain"/>:<Image src="/brand/logo.svg" alt="" width={58} height={58}/>}<div><h1 className="text-2xl font-bold">{payload?.organization.name||"Attendance check-in"}</h1><p className="text-sm text-slate-600">{payload?.service_name} · {payload?.session_date}</p></div></header>
    <section className="space-y-5 p-6">{error || loadError ?<div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error || loadError}</div>:null}{success?<div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 font-semibold text-emerald-800">{success}</div>:null}
      {payload?.status!=="open"?<div className="rounded-2xl border bg-slate-50 p-5"><h2 className="font-semibold">{payload?.status === "preparing" ? "Getting check-in ready?" : `Check-in is ${payload?.status || "unavailable"}.`}</h2><p className="mt-1 text-sm text-slate-600">{payload?.window?`Available ${new Date(payload.window.opens_at).toLocaleString(undefined, { timeZone: payload.timezone })} – ${new Date(payload.window.closes_at).toLocaleString(undefined, { timeZone: payload.timezone })} (${payload.timezone}).`:"Ask church staff when check-in will open."}</p><p className="mt-2 text-xs text-slate-500">This page checks for updates automatically.</p><button type="button" onClick={() => { setError(""); void load(); }} className="mt-3 text-sm underline">Check again</button></div>:<>
      {payload.remembered_profiles.length?<div><h2 className="text-lg font-semibold">Who are you checking in?</h2><div className="mt-3 divide-y overflow-hidden rounded-2xl border">{payload.remembered_profiles.map((p)=><div key={p.id} className="flex items-center justify-between gap-3 p-3"><button disabled={busy} onClick={()=>void remembered(p)} className="flex-1 text-left font-medium hover:text-primary">{p.label}</button><button onClick={()=>void forget(p.id)} className="text-xs text-slate-500 underline">Forget</button></div>)}</div><button onClick={()=>{setSuccess("");document.getElementById("new-person")?.scrollIntoView({behavior:"smooth"});}} className="mt-3 text-sm font-semibold text-primary underline">Add another person</button><button onClick={()=>void forget()} className="ml-4 text-sm text-slate-500 underline">Forget everyone</button></div>:null}
      <div id="new-person" className="space-y-4 border-t pt-5"><div><h2 className="text-lg font-semibold">Check in another person</h2>
      {/* <p className="text-sm text-slate-600">We’ll confirm a clear match. Church staff reviews anything uncertain.</p> */}
      </div><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">First name<input value={first} onChange={(e)=>setFirst(e.target.value)} className="mt-1 w-full rounded-2xl border px-4 py-3"/></label><label className="text-sm font-medium">Last name<input value={last} onChange={(e)=>setLast(e.target.value)} className="mt-1 w-full rounded-2xl border px-4 py-3"/></label></div>{needsIdentifier?<div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Phone (optional)<input value={phone} onChange={(e)=>setPhone(e.target.value)} className="mt-1 w-full rounded-2xl border px-4 py-3"/></label><label className="text-sm font-medium">Email (optional)<input type="email" value={email} onChange={(e)=>setEmail(e.target.value)} className="mt-1 w-full rounded-2xl border px-4 py-3"/></label></div>:null}<label className="flex gap-3 rounded-2xl bg-slate-50 p-3 text-sm"><input type="checkbox" checked={remember} onChange={(e)=>setRemember(e.target.checked)}/><span><strong>Remember me on this device</strong><br/><span className="text-slate-600">A secure random cookie remembers your approved profile; it contains no name or member details.</span></span></label><TurnstileWidget action="attendance_checkin" onToken={setTurnstile} resetSignal={reset}/><button disabled={busy||!first.trim()||!last.trim()||!turnstile} onClick={()=>void identify()} className="w-full rounded-2xl bg-primary px-5 py-3 font-semibold text-white disabled:opacity-50">{busy?"Checking…":"Continue"}</button></div></>}
    </section></div>{confirmation?<div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"><div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-6 shadow-xl"><h2 className="text-xl font-bold">Is this you?</h2>{error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}<p className="mt-2 text-slate-600">Confirm that you are <strong>{confirmation.name}</strong>. If this is not you, church staff will review your check-in.</p><div className="mt-5 flex gap-2"><button onClick={()=>void confirm()} disabled={busy} className="flex-1 rounded-2xl bg-primary px-4 py-3 font-semibold text-white">Check me in</button><button onClick={()=>void confirm(false)} disabled={busy} className="rounded-2xl border px-4 py-3">Not me</button></div></div></div>:null}</main>;
}
