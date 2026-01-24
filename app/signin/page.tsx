"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
// import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";
import { signInWithOrg } from "@/lib/auth";
import BrandLogo from "@/components/BrandLogo";

type Org = { id: string; name: string; slug: string };
//const [selectedOrgId, setSelectedOrgId] = useState<string>("");

export default function SignInPage() {
  const [open, setOpen] = useState(false);

  // Stepper
  const [step, setStep] = useState<1 | 2>(1);

  // Org chooser
  const [orgQuery, setOrgQuery] = useState("");
  const [orgName, setOrgName] = useState("");

  // Supabase orgs
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loadingOrgs, setLoadingOrgs] = useState(true);
  const [orgLoadError, setOrgLoadError] = useState<string>("");

  //email and password states
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");

  const [selectedOrgId, setSelectedOrgId] = useState("");

  useEffect(() => {
    let alive = true;

    async function loadOrgs() {
      setLoadingOrgs(true);
      setOrgLoadError("");

      const res = await fetch("/api/org/public-list");
      const json = await res.json();

      if (!alive) return;

      if (!res.ok) {
        setOrgLoadError(json.error || "Failed to load organizations.");
        setOrgs([]);
      } else {
        setOrgs((json.orgs ?? []) as Org[]);
      }

      setLoadingOrgs(false);
    }

    loadOrgs();

    return () => {
      alive = false;
    };
  }, []);

  const orgResults = useMemo(() => {
    const q = orgQuery.trim().toLowerCase();
    if (!q) return orgs.slice(0, 10);
    return orgs.filter((x) => x.name.toLowerCase().includes(q)).slice(0, 10);
  }, [orgQuery, orgs]);

  // existing orgs only
  const canContinue = selectedOrgId.length > 0;

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-3">
            <BrandLogo size={45} className="" />
            <div>
              <div className="text-lg font-semibold leading-tight">Church Admin</div>
              <div className="text-sm text-slate-500">Church Operations Simplified</div>
            </div>
          </Link>

          <Link
            href="/"
            className="rounded-2xl border px-4 py-2 text-sm font-medium hover:bg-slate-50"
          >
            Landing Page
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-md px-6 pt-14">
        <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-slate-600">
          <span
            className={`h-2 w-2 rounded-full ${
              step === 1 ? "bg-primary" : "bg-slate-300"
            }`}
          />
          Organization
          <span className="mx-1 text-slate-400">→</span>
          <span
            className={`h-2 w-2 rounded-full ${
              step === 2 ? "bg-primary" : "bg-slate-300"
            }`}
          />
          Sign in
        </div>

        <h1 className="mt-5 text-3xl font-semibold tracking-tight">
          {step === 1 ? "Choose your organization" : "Welcome back"}
        </h1>

        <p className="mt-2 text-slate-600">
          {step === 1
            ? "Select your church from the list. New churches will be onboarded later."
            : `Signing in to: ${orgName || "—"}`}
        </p>

        <div className="mt-8 rounded-3xl border p-6">
          {step === 1 ? (
            <>
              <label className="block text-sm font-medium">Organization name</label>
              <input
                value={orgQuery}
                onChange={(e) => setOrgQuery(e.target.value)}
                className="mt-2 w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                placeholder="Type your church name…"
              />

              <div className="mt-4 rounded-2xl border bg-white">
                <div className="px-4 py-2 text-xs font-semibold text-slate-500">
                  Suggestions
                </div>

                <div className="max-h-56 overflow-auto">
                  {loadingOrgs ? (
                    <div className="px-4 py-3 text-sm text-slate-600">
                      Loading organizations…
                    </div>
                  ) : orgLoadError ? (
                    <div className="px-4 py-3 text-sm text-red-600">
                      Failed to load organizations: {orgLoadError}
                    </div>
                  ) : orgResults.length > 0 ? (
                    orgResults.map((org) => (
                      <button
                        key={org.id}
                        onClick={() => {
                          setSelectedOrgId(org.id);
                        setOrgName(org.name);
                            setOrgQuery(org.name);
                        }}
                        className={`w-full px-4 py-3 text-left text-sm hover:bg-slate-50 ${
                          orgName === org.name ? "bg-slate-50" : ""
                        }`}
                      >
                        {org.name}
                      </button>
                    ))
                  ) : (
                    <div className="px-4 py-3 text-sm text-slate-600">
                      No matches. Please contact your administrator to be added.
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-5 flex items-center justify-between gap-3">
                <button
                  onClick={() => setStep(2)}
                  disabled={!canContinue}
                  className="w-full rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-50"
                >
                  Continue
                </button>
              </div>

              <div className="mt-4 text-center text-xs text-slate-500">
                Admins can manage multiple organizations.
              </div>
            </>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between rounded-2xl border bg-slate-50 px-4 py-3">
                <div className="text-sm">
                  <div className="text-xs text-slate-500">Organization</div>
                  <div className="font-semibold">{orgName}</div>
                </div>
                <button
                  onClick={() => setStep(1)}
                  className="rounded-2xl border bg-white px-3 py-1 text-sm hover:bg-slate-50"
                >
                  Change
                </button>
              </div>

              <label className="block text-sm font-medium">Email</label>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-2 w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                placeholder="you@example.com"
                />

              <label className="mt-4 block text-sm font-medium">Password</label>
                <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-2 w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                placeholder="••••••••"
                />

              <button
                onClick={async () => {
                    setAuthError("");
                    setAuthLoading(true);

                    const res = await signInWithOrg(email.trim(), password, selectedOrgId);

                    setAuthLoading(false);

                    if (!res.ok) {
                    setAuthError(res.message);
                    return;
                    }

                    router.push("/app");
                }}
                disabled={authLoading || !email.trim() || !password || !selectedOrgId}
                className="mt-6 w-full rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-50"
                >
                {authLoading ? "Signing in..." : "Sign in"}
                </button>

              {authError ? (
                <div className="mt-3 text-sm text-red-600">{authError}</div>
                ) : null}

              <div className="mt-4 text-center text-xs text-slate-500">
                Forgot password and SSO come later.
              </div>
            </>
          )}
        </div>
      </section>

    </main>
  );
}
