"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import BrandLogo from "@/components/BrandLogo";

function isAlreadyRegisteredError(msg: string) {
  const m = msg.toLowerCase();
  return (
    m.includes("already registered") ||
    m.includes("already been registered") ||
    m.includes("user already registered") ||
    m.includes("already exists")
  );
}

export default function InviteAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();

  // UX mode: default is create account; if email already exists we switch to sign in
  const [mode, setMode] = useState<"signup" | "signin">("signup");

  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");

  const pwMismatch =
    mode === "signup" && pw.length > 0 && pw2.length > 0 && pw !== pw2;

  const canSubmit = useMemo(() => {
    const e = email.trim().toLowerCase();
    if (!e || !e.includes("@") || !e.includes(".")) return false;
    if (pw.length < 6) return false;
    if (mode === "signup" && pwMismatch) return false;
    return true;
  }, [email, pw, pwMismatch, mode]);

  async function validateInviteOrFail(enteredEmail: string) {
    const v = await fetch("/api/invites/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, email: enteredEmail }),
    });

    const vjson = await v.json();
    if (!v.ok) throw new Error(vjson.error || "Invite validation failed.");
  }

  async function acceptInviteOrFail(accessToken: string) {
    const res = await fetch("/api/invites/accept", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ token }),
    });

    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Failed to accept invite.");
  }

  async function getAccessTokenOrFail() {
    const { data } = await supabase.auth.getSession();
    const access = data.session?.access_token;
    if (!access) {
      throw new Error(
        "No session found. If email confirmation is enabled in Supabase, disable it for v1 or we’ll add confirmation flow."
      );
    }
    return access;
  }

  async function doSignInAndAccept(enteredEmail: string) {
    const { error } = await supabase.auth.signInWithPassword({
      email: enteredEmail,
      password: pw,
    });
    if (error) throw new Error(error.message);

    const accessToken = await getAccessTokenOrFail();
    await acceptInviteOrFail(accessToken);

    // Keep your org-selection sign-in flow consistent
    await supabase.auth.signOut();
    router.push("/signin");
  }

  async function doSignUpAndAccept(enteredEmail: string) {
    const { error: signUpErr } = await supabase.auth.signUp({
      email: enteredEmail,
      password: pw,
    });

    if (signUpErr) {
      // If email exists, gracefully switch to Sign in mode
      if (isAlreadyRegisteredError(signUpErr.message)) {
        setMode("signin");
        setNote("This email already has an account. Please sign in to accept the invite.");
        return;
      }
      throw new Error(signUpErr.message);
    }

    const accessToken = await getAccessTokenOrFail();
    await acceptInviteOrFail(accessToken);

    await supabase.auth.signOut();
    router.push("/signin");
  }

  async function handleSubmit() {
    setErr("");
    setNote("");
    setLoading(true);

    const enteredEmail = email.trim().toLowerCase();

    try {
      // 0) Validate token + email FIRST (prevents junk auth users)
      await validateInviteOrFail(enteredEmail);

      if (mode === "signin") {
        await doSignInAndAccept(enteredEmail);
      } else {
        await doSignUpAndAccept(enteredEmail);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Something went wrong.";
      setErr(msg);
    } finally {
      setLoading(false);
    }
  }

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
            href="/signin"
            className="rounded-2xl border bg-primary text-slate-100 px-4 py-2 text-sm font-medium hover:bg-slate-50 hover:text-slate-900"
          >
            Sign in with Organization
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-md px-6 pt-14">
        <h1 className="text-3xl font-semibold tracking-tight">You’ve been invited</h1>
        <p className="mt-2 text-slate-600">
          Use the invited email address. If you already have an account, we’ll switch you to sign in.
        </p>

        <div className="mt-8 rounded-3xl border p-6">
          {/* Mode chips (Create account default + Sign in) */}
          <div className="mb-5 flex gap-2">
            <button
              onClick={() => {
                setMode("signup");
                setErr("");
                setNote("");
              }}
              className={`flex-1 rounded-2xl border px-3 py-2 text-sm font-semibold ${
                mode === "signup" ? "bg-primary/15" : "bg-white hover:bg-slate-50"
              }`}
            >
              Create account
            </button>
            <button
              onClick={() => {
                setMode("signin");
                setErr("");
                setNote("");
              }}
              className={`flex-1 rounded-2xl border px-3 py-2 text-sm font-semibold ${
                mode === "signin" ? "bg-primary/15" : "bg-white hover:bg-slate-50"
              }`}
            >
              Sign in
            </button>
          </div>

          <label className="block text-sm font-medium">Email (must match invite)</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-2 w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-200"
            placeholder="you@example.com"
            autoComplete="email"
          />

          <label className="mt-4 block text-sm font-medium">
            Password {mode === "signin" ? "(your existing password)" : ""}
          </label>
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            className="mt-2 w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-200"
            placeholder="Minimum 6 characters"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
          />

          {mode === "signup" ? (
            <>
              <label className="mt-4 block text-sm font-medium">Confirm password</label>
              <input
                type="password"
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                className="mt-2 w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                placeholder="Re-enter password"
                autoComplete="new-password"
              />
              {pwMismatch ? (
                <div className="mt-2 text-sm text-red-600">Passwords do not match.</div>
              ) : null}
            </>
          ) : null}

          <button
            disabled={loading || !canSubmit}
            onClick={handleSubmit}
            className="mt-6 w-full rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-50"
          >
            {loading
              ? mode === "signin"
                ? "Signing in..."
                : "Creating account..."
              : mode === "signin"
              ? "Sign in & accept invite"
              : "Accept invite"}
          </button>

          {note ? (
            <div className="mt-3 rounded-2xl border bg-slate-50 p-3 text-sm text-slate-700">
              {note}
            </div>
          ) : null}

          {err ? <div className="mt-3 text-sm text-red-600">{err}</div> : null}

          <div className="mt-4 text-xs text-slate-500">
            Invite token: <span className="font-mono">{token}</span>
          </div>
        </div>
      </section>
    </main>
  );
}
