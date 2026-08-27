"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import BrandLogo from "@/components/BrandLogo";
import { applyOrgContext, signIn } from "@/lib/auth";
import { supabase } from "@/lib/supabaseClient";

type Membership = {
  organization_id: string;
  role: string;
  organizations: { name: string } | Array<{ name: string }> | null;
};

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [memberships, setMemberships] = useState<Membership[]>([]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("verified")) {
      setMessage("Email verified. Sign in to continue.");
    } else if (params.get("passwordUpdated")) {
      setMessage("Password updated. Sign in with your new password.");
    }
  }, []);

  async function choose(row: Membership) {
    const result = await applyOrgContext(row.organization_id);
    if (!result.ok) throw new Error(result.message);
    router.push("/app");
  }

  async function loadMemberships() {
    const { data, error: queryError } = await supabase
      .from("user_organizations")
      .select("organization_id,role,organizations(name)")
      .order("created_at");
    if (queryError) throw queryError;

    const rows = (data ?? []) as Membership[];
    if (rows.length === 1) {
      await choose(rows[0]);
      return;
    }
    setMemberships(rows);
  }

  async function requestPasswordReset() {
    if (!email.trim()) {
      setMessage("Enter your email first.");
      return;
    }

    setResettingPassword(true);
    setMessage("If that account exists, a reset email has been sent.");
    setResettingPassword(false);

    window.setTimeout(() => {
      try {
        const request = supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${location.origin}/auth/update-password`,
        });
        void request.catch(() => undefined);
      } catch {
        // Keep the response generic so the page never reveals whether an account exists.
      }
    }, 0);
  }

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-3">
            <BrandLogo size={45} />
            <div>
              <div className="text-lg font-semibold">Church Admin</div>
              <div className="text-sm text-slate-500">Church Operations Simplified</div>
            </div>
          </Link>
          <Link href="/pricing" className="rounded-2xl border px-4 py-2 text-sm">
            View plans
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-md px-6 py-14">
        <h1 className="text-3xl font-semibold">
          {memberships.length ? "Choose your organization" : "Welcome back"}
        </h1>
        <p className="mt-2 text-slate-600">
          {memberships.length
            ? "Select a workspace you belong to."
            : "Sign in with your Church Admin account."}
        </p>

        <div className="mt-8 rounded-3xl border p-6">
          {memberships.length ? (
            <div className="divide-y rounded-2xl border">
              {memberships.map((row) => {
                const org = Array.isArray(row.organizations)
                  ? row.organizations[0]
                  : row.organizations;
                return (
                  <button
                    key={row.organization_id}
                    onClick={() => choose(row).catch((error) => setMessage(error.message))}
                    className="w-full px-4 py-4 text-left hover:bg-slate-50"
                  >
                    <div className="font-semibold">{org?.name ?? "Organization"}</div>
                    <div className="text-sm capitalize text-slate-500">{row.role}</div>
                  </button>
                );
              })}
            </div>
          ) : (
            <>
              <label className="text-sm font-medium">Email</label>
              <input
                className="mt-2 w-full rounded-2xl border px-4 py-3"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
              />

              <label className="mt-4 block text-sm font-medium">Password</label>
              <input
                className="mt-2 w-full rounded-2xl border px-4 py-3"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
              />

              <button
                disabled={signingIn || resettingPassword || !email || !password}
                onClick={async () => {
                  setSigningIn(true);
                  setMessage("");
                  const result = await signIn(email.trim(), password);
                  try {
                    if (!result.ok) throw new Error(result.message);
                    await loadMemberships();
                  } catch (error) {
                    setMessage(error instanceof Error ? error.message : "Unable to sign in.");
                  } finally {
                    setSigningIn(false);
                  }
                }}
                className="mt-6 w-full rounded-2xl bg-primary px-4 py-3 font-semibold text-white disabled:opacity-50"
              >
                {signingIn ? "Signing in…" : "Sign in"}
              </button>

              <button
                className="mt-4 text-sm underline disabled:opacity-50"
                disabled={signingIn || resettingPassword}
                onClick={requestPasswordReset}
              >
                {resettingPassword ? "Sending reset email…" : "Forgot password?"}
              </button>
            </>
          )}

          {message ? <div className="mt-4 text-sm text-slate-600">{message}</div> : null}
        </div>

        <div className="mt-6 text-center text-sm">
          Setting up a church?{" "}
          <Link className="font-semibold underline" href="/pricing">
            Choose a plan
          </Link>
        </div>
      </section>
    </main>
  );
}
