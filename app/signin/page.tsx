"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

function CoolModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-lg font-semibold">Sign in</div>
            <div className="mt-1 text-sm text-slate-600">Cool, this works! ✅</div>
          </div>
          <button
            onClick={onClose}
            className="rounded-2xl border px-3 py-1 text-sm hover:bg-slate-50"
          >
            Close
          </button>
        </div>

        <div className="mt-5 rounded-2xl border bg-slate-50 p-4 text-sm text-slate-700">
          Next step: connect this flow to Supabase Auth + tenant lookup.
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-2xl bg-[rgb(var(--brand))] px-4 py-2 text-sm font-semibold text-white hover:opacity-95"
          >
            Nice
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SignInPage() {
  const [open, setOpen] = useState(false);

  // Stepper
  const [step, setStep] = useState<1 | 2>(1);

  // Org chooser (UI-only)
  const [orgQuery, setOrgQuery] = useState("");
  const [orgName, setOrgName] = useState("");

  // Mock org results (later from Supabase)
  const orgResults = useMemo(() => {
    const all = ["GOFAMINT Glory House", "ETSU Campus Fellowship", "New Life Assembly", "City of Faith"];
    const q = orgQuery.trim().toLowerCase();
    if (!q) return all.slice(0, 4);
    return all.filter((x) => x.toLowerCase().includes(q)).slice(0, 6);
  }, [orgQuery]);

  const canContinue = orgName.trim().length > 1;

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-[rgb(var(--brand))]" />
            <div>
              <div className="text-sm font-semibold leading-tight">churchadmin</div>
              <div className="text-xs text-slate-500">Sign in</div>
            </div>
          </Link>

          <Link
            href="/app"
            className="rounded-2xl border px-4 py-2 text-sm font-medium hover:bg-slate-50"
          >
            Open Demo
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-md px-6 pt-14">
        <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-slate-600">
          <span className={`h-2 w-2 rounded-full ${step === 1 ? "bg-[rgb(var(--brand))]" : "bg-slate-300"}`} />
          Organization
          <span className="mx-1 text-slate-400">→</span>
          <span className={`h-2 w-2 rounded-full ${step === 2 ? "bg-[rgb(var(--brand))]" : "bg-slate-300"}`} />
          Sign in
        </div>

        <h1 className="mt-5 text-3xl font-semibold tracking-tight">
          {step === 1 ? "Choose your organization" : "Welcome back"}
        </h1>
        <p className="mt-2 text-slate-600">
          {step === 1
            ? "Start typing your church name. Later this will route you to churchname.app.com."
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
                  {orgResults.map((org) => (
                    <button
                      key={org}
                      onClick={() => {
                        setOrgName(org);
                        setOrgQuery(org);
                      }}
                      className={`w-full px-4 py-3 text-left text-sm hover:bg-slate-50 ${
                        orgName === org ? "bg-slate-50" : ""
                      }`}
                    >
                      {org}
                    </button>
                  ))}
                  {orgResults.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-slate-600">
                      No matches. You can still continue with “{orgQuery || "your org"}”.
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="mt-5 flex items-center justify-between gap-3">
                <button
                  onClick={() => {
                    // if user typed something not selected, accept it
                    const typed = orgQuery.trim();
                    if (!orgName && typed) setOrgName(typed);
                    setStep(2);
                  }}
                  disabled={!canContinue && orgQuery.trim().length < 2}
                  className="w-full rounded-2xl bg-[rgb(var(--brand))] px-4 py-3 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-50"
                >
                  Continue
                </button>
              </div>

              <div className="mt-4 text-center text-xs text-slate-500">
                Admins can later manage multiple organizations.
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
                className="mt-2 w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                placeholder="you@example.com"
              />

              <label className="mt-4 block text-sm font-medium">Password</label>
              <input
                type="password"
                className="mt-2 w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                placeholder="••••••••"
              />

              <button
                onClick={() => setOpen(true)}
                className="mt-6 w-full rounded-2xl bg-[rgb(var(--brand))] px-4 py-3 text-sm font-semibold text-white hover:opacity-95"
              >
                Sign in
              </button>

              <div className="mt-4 text-center text-xs text-slate-500">
                Forgot password and SSO come later.
              </div>
            </>
          )}
        </div>
      </section>

      <CoolModal open={open} onClose={() => setOpen(false)} />
    </main>
  );
}
