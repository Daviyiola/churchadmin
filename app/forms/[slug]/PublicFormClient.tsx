"use client";

import { useEffect, useMemo, useState } from "react";
import FormRenderer, { type RenderableFormField } from "@/components/forms/FormRenderer";
import { supabase } from "@/lib/supabaseClient";
import TurnstileWidget from "@/components/forms/TurnstileWidget";

type PublicFieldRow = {
  field_key: string;
  field_type: RenderableFormField["type"];
  label: string;
  help_text: string | null;
  placeholder: string | null;
  is_required: boolean;
  options: string[];
  layout_width: RenderableFormField["width"];
};

type PublicPayload = {
  form: { title: string; description: string | null; revision: number; kind: string };
  fields: PublicFieldRow[];
  organization: { name: string };
  settings: { logo_path: string | null; use_default_logo: boolean };
};

export default function PublicFormClient({ slug }: { slug: string }) {
  const [payload, setPayload] = useState<PublicPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileReset, setTurnstileReset] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await fetch(`/api/forms/public/${encodeURIComponent(slug)}`, { cache: "no-store" });
        const body = await response.json().catch(() => null) as PublicPayload | { error?: string } | null;
        if (!response.ok) throw new Error(body && "error" in body ? body.error : "This form is unavailable.");
        if (alive) setPayload(body as PublicPayload);
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : "This form is unavailable.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [slug]);

  const fields = useMemo<RenderableFormField[]>(() => (payload?.fields ?? []).map((field) => ({
    key: field.field_key,
    type: field.field_type,
    label: field.label,
    help_text: field.help_text ?? "",
    placeholder: field.placeholder ?? "",
    required: field.is_required,
    options: Array.isArray(field.options) ? field.options : [],
    width: field.layout_width ?? "full",
  })), [payload]);

  const logoUrl = useMemo(() => {
    const path = payload?.settings.logo_path;
    if (!path || payload?.settings.use_default_logo) return null;
    return supabase.storage.from("org-logos").getPublicUrl(path).data.publicUrl;
  }, [payload]);

  async function submit(answers: Record<string, string | string[]>, website: string) {
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/forms/public/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: requestId, answers, website, turnstile_token: turnstileToken }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error || "Unable to submit the form.");
      setComplete(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to submit the form.");
      setTurnstileToken("");
      setTurnstileReset((value) => value + 1);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <main className="min-h-screen bg-slate-100 p-6"><div className="mx-auto max-w-3xl rounded-3xl border bg-white p-8 text-sm text-slate-600">Loading form…</div></main>;
  if (error && !payload) return <main className="min-h-screen bg-slate-100 p-6"><div className="mx-auto max-w-xl rounded-3xl border bg-white p-8"><h1 className="text-lg font-semibold">Form unavailable</h1><p className="mt-2 text-sm text-slate-600">{error}</p></div></main>;
  if (!payload) return null;
  if (complete) return <main className="min-h-screen bg-slate-100 px-4 py-10"><div className="mx-auto max-w-xl rounded-3xl border bg-white p-8 text-center shadow-sm"><div className="text-3xl">✓</div><h1 className="mt-3 text-xl font-semibold">Response submitted</h1><p className="mt-2 text-sm text-slate-600">Thank you. Your response has been received by {payload.organization.name}.</p></div></main>;

  return <main className="min-h-screen bg-slate-100 px-4 py-6 sm:px-6 sm:py-10">
    <div className="mx-auto max-w-4xl space-y-4">
      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      <FormRenderer
        title={payload.form.title}
        description={payload.form.description}
        fields={fields}
        organizationName={payload.organization.name}
        organizationLogoUrl={logoUrl}
        onSubmitAnswers={(answers, website) => void submit(answers, website)}
        submitting={submitting}
        submitDisabled={!turnstileToken}
        verificationSlot={<TurnstileWidget onToken={setTurnstileToken} resetSignal={turnstileReset} />}
      />
    </div>
  </main>;
}
