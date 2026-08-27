"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import BrandLogo from "@/components/BrandLogo";
import { supabase } from "@/lib/supabaseClient";

type RecoveryState = "checking" | "ready" | "invalid";

export default function UpdatePasswordInner() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [recoveryState, setRecoveryState] = useState<RecoveryState>("checking");

  useEffect(() => {
    let active = true;
    let invalidTimer: ReturnType<typeof setTimeout> | undefined;

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active && session) {
        setRecoveryState("ready");
        if (invalidTimer) clearTimeout(invalidTimer);
      }
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) {
        setRecoveryState("ready");
        return;
      }

      // Supabase may still be consuming the recovery fragment when this page mounts.
      invalidTimer = setTimeout(() => {
        if (active) setRecoveryState("invalid");
      }, 2500);
    });

    return () => {
      active = false;
      if (invalidTimer) clearTimeout(invalidTimer);
      listener.subscription.unsubscribe();
    };
  }, []);

  async function updatePassword() {
    setMessage("");

    if (recoveryState !== "ready") {
      setMessage("Recovery link not active. Please request a new reset email.");
      return;
    }
    if (!password || password.length < 8) {
      setMessage("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmation) {
      setMessage("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setMessage(error.message);
        return;
      }

      // Recovery is account-level. Normal sign-in freshly resolves memberships.
      localStorage.removeItem("active_org_id");
      localStorage.removeItem("active_org_role");
      await supabase.auth.signOut({ scope: "local" });
      router.replace("/signin?passwordUpdated=1");
    } finally {
      setLoading(false);
    }
  }

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
        <p className="mt-2 text-slate-600">Choose a new password for your account.</p>

        <div className="mt-8 rounded-3xl border p-6">
          {recoveryState === "checking" ? (
            <p className="text-sm text-slate-600">Checking your recovery link…</p>
          ) : recoveryState === "invalid" ? (
            <div>
              <p className="text-sm text-slate-600">
                This recovery link is invalid or has expired. Please request a new one.
              </p>
              <Link className="mt-4 inline-block text-sm font-medium underline" href="/signin">
                Return to sign in
              </Link>
            </div>
          ) : (
            <>
              <label className="block text-sm font-medium">New password</label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-2 w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                placeholder="••••••••"
              />

              <label className="mt-4 block text-sm font-medium">Confirm new password</label>
              <input
                type="password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                className="mt-2 w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                placeholder="••••••••"
              />

              <button
                onClick={updatePassword}
                disabled={loading}
                className="mt-6 w-full rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-50"
              >
                {loading ? "Updating…" : "Update password"}
              </button>
            </>
          )}

          {message ? <div className="mt-3 text-sm text-slate-600">{message}</div> : null}
        </div>
      </section>
    </main>
  );
}
