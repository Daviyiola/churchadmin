"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Status = "idle" | "sending" | "sent" | "error";

export default function ContactForm({
  variant = "public",
  source = "contact-form",
  showLegal = true,
  initialValues,
  lockEmail = false,
}: {
  variant?: "public" | "app";
  source?: string;
  showLegal?: boolean;
  initialValues?: Partial<{
    name: string;
    email: string;
    church: string;
    message: string;
  }>;
  lockEmail?: boolean;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    email: "",
    church: "",
    message: "",
    website: "", // honeypot
  });

  // apply prefills once (or whenever initialValues changes)
  useEffect(() => {
    if (!initialValues) return;
    setForm((s) => ({
      ...s,
      name: initialValues.name ?? s.name,
      email: initialValues.email ?? s.email,
      church: initialValues.church ?? s.church,
      message: initialValues.message ?? s.message,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    initialValues?.name,
    initialValues?.email,
    initialValues?.church,
    initialValues?.message,
  ]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (form.website.trim()) {
      setStatus("sent");
      return;
    }

    const cleanEmail = form.email.trim();
    const cleanMessage = form.message.trim();

    if (cleanEmail.length === 0 || cleanMessage.length === 0) {
      setStatus("error");
      setError("Please provide both an email and a message.");
      return;
    }

    setStatus("sending");

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          email: cleanEmail,
          church: form.church.trim(),
          message: cleanMessage,
          source,
          website: form.website,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Something went wrong.");

      setStatus("sent");
      setForm((s) => ({
        ...s,
        message: "",
        website: "",
        
      }));
    } catch (err: unknown) {
      setStatus("error");
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : "Failed to send. Please try again.";
      setError(msg);
    }
  }

  const title = variant === "app" ? "Support" : "Contact us";
  const subtitle =
    variant === "app"
      ? "Send a message to support and we’ll reply by email."
      : "Send a message and we’ll get back to you.";

  return (
    <div className="rounded-3xl border bg-white p-6 shadow-sm sm:p-8">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">{subtitle}</p>

      {status === "sent" ? (
        <div className="mt-6 rounded-2xl border bg-slate-50 px-4 py-3 text-sm text-slate-700">
          Message sent. We’ll reply as soon as we can.
        </div>
      ) : null}

      {status === "error" ? (
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <input
          value={form.website}
          onChange={(e) => setForm((s) => ({ ...s, website: e.target.value }))}
          className="hidden"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          placeholder="Website"
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-sm font-medium">Name *</label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
              className="mt-2 w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-200"
              placeholder="Your name"
            />
          </div>

          <div>
            <label className="text-sm font-medium">
              Email <span className="font-normal text-slate-500">*</span>
            </label>
            <input
              required
              value={form.email}
              disabled={lockEmail}
              onChange={(e) =>
                setForm((s) => ({ ...s, email: e.target.value }))
              }
              className="mt-2 w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50"
              placeholder="you@church.org"
            />
          </div>
        </div>

        <div>
          <label className="text-sm font-medium">
            Church{" "}
            <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <input
            value={form.church}
            onChange={(e) => setForm((s) => ({ ...s, church: e.target.value }))}
            className="mt-2 w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-200"
            placeholder="e.g., Church of Christ"
          />
        </div>

        <div>
          <label className="text-sm font-medium">Message *</label>
          <textarea
            required
            value={form.message}
            onChange={(e) =>
              setForm((s) => ({ ...s, message: e.target.value }))
            }
            className="mt-2 min-h-[140px] w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-200"
            placeholder="Tell us what you need help with..."
          />
        </div>

        <button
          disabled={
            status === "sending" ||
            form.email.trim().length === 0 ||
            form.message.trim().length === 0
          }
          className="inline-flex w-full items-center justify-center rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-white hover:bg-primary/85 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === "sending" ? "Sending..." : "Send message"}
        </button>

        {showLegal ? (
          <div className="text-xs text-slate-500">
            By contacting us, you agree to our{" "}
            <Link className="underline hover:text-slate-900" href="/terms">
              Terms
            </Link>{" "}
            and{" "}
            <Link className="underline hover:text-slate-900" href="/privacy">
              Privacy Policy
            </Link>
            .
          </div>
        ) : null}
      </form>
    </div>
  );
}
