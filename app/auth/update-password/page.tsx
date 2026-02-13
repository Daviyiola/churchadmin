"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import BrandLogo from "@/components/BrandLogo";
import { supabase } from "@/lib/supabaseClient";
import { applyOrgContext } from "@/lib/auth";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const orgId = sp.get("orgId") || "";
  const email = sp.get("email") || "";

  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setMsg("Recovery link not active. Please request a new reset email.");
      }
    })();
  }, []);

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-3">
            <BrandLogo size={45} />
            <div>
              <div className="text-lg font-semibold leading-tight">Church Admin</div>
              <div className="text-sm text-slate-500">Church Operations Simplified</div>
            </div>
          </Link>

          <Link
            href="/signin"
            className="rounded-2xl border px-4 py-2 text-sm font-medium hover:bg-slate-50"
          >
            Back to Sign in
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-md px-6 pt-14">
        <h1 className="text-3xl font-semibold tracking-tight">Set a new password</h1>
        <p className="mt-2 text-slate-600">
          {email ? `Account: ${email}` : "Choose a new password for your account."}
        </p>

        <div className="mt-8 rounded-3xl border p-6">
          <label className="block text-sm font-medium">New password</label>
          <input
            type="password"
            value={pw1}
            onChange={(e) => setPw1(e.target.value)}
            className="mt-2 w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-200"
            placeholder="••••••••"
          />

          <label className="mt-4 block text-sm font-medium">Confirm new password</label>
          <input
            type="password"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            className="mt-2 w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-200"
            placeholder="••••••••"
          />

          <button
            onClick={async () => {
              setMsg("");

              if (!orgId) {
                setMsg("Missing organization context. Go back and start reset again.");
                return;
              }
              if (!pw1 || pw1.length < 8) {
                setMsg("Password must be at least 8 characters.");
                return;
              }
              if (pw1 !== pw2) {
                setMsg("Passwords do not match.");
                return;
              }

              setLoading(true);
              try {
                const { error } = await supabase.auth.updateUser({ password: pw1 });
                if (error) {
                  setMsg(error.message);
                  return;
                }

                const applied = await applyOrgContext(orgId);
                if (!applied.ok) {
                  setMsg(applied.message);
                  return;
                }

                router.replace("/app");
              } finally {
                setLoading(false);
              }
            }}
            disabled={loading}
            className="mt-6 w-full rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-50"
          >
            {loading ? "Updating..." : "Update password"}
          </button>

          {msg ? <div className="mt-3 text-sm text-slate-600">{msg}</div> : null}
        </div>
      </section>
    </main>
  );
}
