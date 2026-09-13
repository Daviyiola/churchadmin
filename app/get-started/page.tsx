"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import BrandLogo from "@/components/BrandLogo";
import { applyOrgContext, getAccessToken, signIn } from "@/lib/auth";
import { supabase } from "@/lib/supabaseClient";
import { ONBOARDING_DRAFT_KEY, SELF_SERVICE_PLANS } from "@/lib/onboarding";

const input = "mt-2 w-full rounded-2xl border px-4 py-3";
export default function GetStartedPage() {
  const params = useSearchParams();
  const router = useRouter();
  const [plan, setPlan] = useState("free");
  const [interval, setInterval] = useState("monthly");
  const [org, setOrg] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [existing, setExisting] = useState(false);
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const [verification, setVerification] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(false);
  const [retry, setRetry] = useState(0);
  const intentId = useRef("");
  const sessionId = params.get("session_id");

  useEffect(() => {
    let active = true;
    let draft: Record<string, string> = {};
    try { draft = JSON.parse(localStorage.getItem(ONBOARDING_DRAFT_KEY) ?? "{}") ?? {}; } catch { /* Storage is optional. */ }
    const selected = params.get("plan") ?? draft.plan;
    setPlan(SELF_SERVICE_PLANS.includes(selected as typeof SELF_SERVICE_PLANS[number]) ? selected : "free");
    setInterval((params.get("interval") ?? draft.interval) === "annual" ? "annual" : "monthly");
    setOrg(typeof draft.org === "string" ? draft.org : "");
    setEmail(typeof draft.email === "string" ? draft.email : "");
    intentId.current = draft.intent_id || crypto.randomUUID();
    if (params.get("plan") && (params.get("plan") !== draft.plan || params.get("interval") !== draft.interval)) intentId.current = crypto.randomUUID();
    if (params.get("checkout") === "canceled") setMessage("Checkout was canceled. Your setup is saved; you can try again or choose another plan.");
    const hash = new URLSearchParams(location.hash.slice(1));
    if (hash.get("error_description")) setMessage(hash.get("error_description")!);
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      setSignedInEmail(data.session?.user.email ?? null);
      if (error) setMessage(error.message);
      setReady(true);
    }).catch(() => { if (active) { setMessage("Unable to check your session. Please sign in to continue."); setReady(true); } });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedInEmail(session?.user.email ?? null);
      if (session?.user.email_confirmed_at) setVerification(false);
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, [params]);

  useEffect(() => {
    if (!sessionId || !signedInEmail) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    let attempts = 0;
    setChecking(true);
    setMessage("Waiting for payment confirmation and your workspace…");
    async function check() {
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("Sign in to finish setting up your paid workspace.");
        const response = await fetch(`/api/billing/onboarding/status?session_id=${encodeURIComponent(sessionId!)}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Unable to check payment status.");
        if (stopped) return;
        if (data.provisioned_organization_id) {
          const context = await applyOrgContext(data.provisioned_organization_id);
          if (!context.ok) throw new Error(context.message);
          try { localStorage.removeItem(ONBOARDING_DRAFT_KEY); } catch {}
          router.replace("/app/setup");
          return;
        }
        if (["expired", "canceled"].includes(data.status)) throw new Error("This checkout has expired or was canceled. Return to plans to start again.");
        if (++attempts >= 20) throw new Error("Your payment is still being confirmed. Check again shortly. You do not need to pay again.");
        timer = setTimeout(check, 1500);
      } catch (error) {
        if (!stopped) { setChecking(false); setMessage(error instanceof Error ? error.message : "Unable to check payment. Please try again."); }
      }
    }
    void check();
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, [sessionId, signedInEmail, retry, router]);

  function saveDraft() {
    try { localStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify({ plan, interval, org, email, intent_id: intentId.current })); } catch {}
  }
  function redirectUrl() { return `${location.origin}/get-started?plan=${plan}&interval=${interval}&verified=1`; }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true); setMessage(""); saveDraft();
    try {
      let token = await getAccessToken();
      if (!token) {
        if (existing || sessionId) {
          const result = await signIn(email.trim(), password);
          if (!result.ok) throw new Error(result.message);
        } else {
          if (password !== confirmPassword) throw new Error("Passwords do not match.");
          const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: redirectUrl() } });
          if (error) throw error;
          if (!data.session) {
            setVerification(true); setExisting(true); setPassword(""); setConfirmPassword("");
            setMessage("Check your email to verify your account. Open the link to continue, or sign in here after verifying. If you already have an account, sign in instead.");
            return;
          }
        }
        token = await getAccessToken();
      }
      if (!token) throw new Error("Sign in again to continue.");
      if (sessionId) { setRetry(value => value + 1); return; }
      const response = await fetch("/api/billing/onboarding", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ plan, interval, organization_name: org, intent_id: intentId.current }), signal: AbortSignal.timeout(30000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to continue.");
      if (data.checkout_url) { location.assign(data.checkout_url); return; }
      if (!data.organization_id) throw new Error("Your workspace is not ready yet. Please try again.");
      const context = await applyOrgContext(data.organization_id);
      if (!context.ok) throw new Error(context.message);
      try { localStorage.removeItem(ONBOARDING_DRAFT_KEY); } catch {}
      router.replace("/app/setup");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to continue. Please try again."); }
    finally { setLoading(false); }
  }
  async function resend() {
    setLoading(true);
    try {
      const { error } = await supabase.auth.resend({ type: "signup", email: email.trim(), options: { emailRedirectTo: redirectUrl() } });
      if (error) throw error;
      setMessage("Verification email requested. Check your inbox and spam folder.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to resend. Please try again."); }
    finally { setLoading(false); }
  }
  return <main className="min-h-dvh bg-slate-50 text-slate-900">
    <header className="border-b bg-white"><div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-4"><Link href="/" className="flex items-center gap-3"><BrandLogo size={40} /><span className="font-semibold">Church Admin</span></Link><Link href="/signin" className="text-sm underline">Sign in</Link></div></header>
    <section className="mx-auto max-w-xl px-4 py-8 sm:px-6 sm:py-12">
      <p className="mb-4 text-sm text-slate-500">Account & verification → Organization → Team</p>
      <div className="rounded-3xl border bg-white p-5 sm:p-7">
        <div className="text-sm font-semibold capitalize text-slate-500">{plan} · {plan === "free" ? "No card required" : interval}</div>
        <h1 className="mt-2 text-3xl font-semibold">{sessionId ? "Finish your workspace" : "Create your church workspace"}</h1>
        <p className="mt-3 text-sm text-slate-600">We’ll help you set your organization name, logo, timezone, mailing address, and team. You can update these later in Settings.</p>
        {!ready ? <p className="mt-6" role="status">Checking your account…</p> : <form onSubmit={submit} className="mt-6">
          {!sessionId && <><label htmlFor="org" className="block text-sm font-medium">Organization name</label><input id="org" required minLength={2} maxLength={120} value={org} onChange={e => { setOrg(e.target.value); intentId.current = crypto.randomUUID(); }} className={input} autoComplete="organization" placeholder="Grace Community Church" /></>}
          {signedInEmail ? <p className="mt-4 break-words rounded-2xl bg-slate-50 p-3 text-sm">Signed in as <strong>{signedInEmail}</strong>. <button type="button" className="underline" disabled={loading || checking} onClick={async () => { await supabase.auth.signOut(); intentId.current = crypto.randomUUID(); }}>Use another account</button></p> : <>
            <label htmlFor="email" className="mt-4 block text-sm font-medium">Email</label><input id="email" required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} className={input} />
            <label htmlFor="password" className="mt-4 block text-sm font-medium">{existing || sessionId ? "Password" : "Create a password"}</label><input id="password" required minLength={existing || sessionId ? 1 : 8} type="password" autoComplete={existing || sessionId ? "current-password" : "new-password"} value={password} onChange={e => setPassword(e.target.value)} className={input} />
            {!existing && !sessionId && <><p className="mt-2 text-xs text-slate-500">Use at least 8 characters.</p><label htmlFor="confirm-password" className="mt-4 block text-sm font-medium">Confirm password</label><input id="confirm-password" required type="password" autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className={input} /></>}
            {!sessionId && <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={existing} onChange={e => setExisting(e.target.checked)} />I already have a Church Admin account</label>}
          </>}
          {(!sessionId || !signedInEmail) && <button disabled={loading || checking} className="mt-6 w-full rounded-2xl bg-primary px-4 py-3 font-semibold text-white disabled:opacity-50">{loading ? "Continuing…" : sessionId ? "Sign in to finish setup" : !signedInEmail ? existing ? "Sign in and continue" : "Create account" : plan === "free" ? "Create free workspace" : "Continue to secure checkout"}</button>}
        </form>}
        {message && <div role="status" className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm">{message}</div>}
        {verification && <button onClick={resend} disabled={loading || !email} className="mt-4 text-sm underline disabled:opacity-50">Resend verification email</button>}
        {sessionId && signedInEmail && <button disabled={checking} onClick={() => setRetry(value => value + 1)} className="mt-4 rounded-2xl border px-4 py-3 text-sm disabled:opacity-50">{checking ? "Confirming…" : "Check again"}</button>}
        <div className="mt-6 flex flex-wrap gap-4 text-sm"><Link href="/pricing" onClick={() => { intentId.current = crypto.randomUUID(); saveDraft(); }} className="underline">Change plan</Link><Link href="/signin" className="underline">Open an existing workspace</Link></div>
        <p className="mt-5 text-xs text-slate-500">By creating an account, you agree to our <Link href="/terms" className="underline">Terms</Link> and <Link href="/privacy" className="underline">Privacy Policy</Link>. {plan !== "free" && "Paid plans renew automatically until canceled. Your records are kept if you downgrade."}</p>
      </div>
    </section>
  </main>;
}
