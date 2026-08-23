"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import FormRenderer, {
  type RenderableFormField,
} from "@/components/forms/FormRenderer";
import { supabase } from "@/lib/supabaseClient";

type PreviewForm = {
  id: string;
  org_id: string;
  title: string;
  description: string | null;
  status: "draft" | "open" | "closed";
  revision: number;
};

type PreviewFieldRow = {
  field_key: string;
  field_type: RenderableFormField["type"];
  label: string;
  help_text: string | null;
  placeholder: string | null;
  is_required: boolean;
  options: string[];
  layout_width: RenderableFormField["width"];
};

export default function FormPreviewPage() {
  const params = useParams<{ formId: string }>();
  const formId = params.formId;
  const [form, setForm] = useState<PreviewForm | null>(null);
  const [fields, setFields] = useState<RenderableFormField[]>([]);
  const [organizationName, setOrganizationName] = useState("");
  const [organizationLogoUrl, setOrganizationLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const { data: session } = await supabase.auth.getSession();
        if (!session.session) throw new Error("Sign in to preview this form.");

        const { data: formData, error: formError } = await supabase
          .from("forms")
          .select("id,org_id,title,description,status,revision")
          .eq("id", formId)
          .maybeSingle();
        if (formError) throw formError;
        if (!formData) throw new Error("This form is unavailable or you do not have access.");

        const previewForm = formData as PreviewForm;
        const [fieldsResult, organizationResult, settingsResult] = await Promise.all([
          supabase
            .from("form_fields")
            .select("field_key,field_type,label,help_text,placeholder,is_required,options,layout_width")
            .eq("form_id", formId)
            .eq("org_id", previewForm.org_id)
            .order("position", { ascending: true }),
          supabase
            .from("organizations")
            .select("name")
            .eq("id", previewForm.org_id)
            .maybeSingle(),
          supabase
            .from("organization_settings")
            .select("logo_path,use_default_logo")
            .eq("organization_id", previewForm.org_id)
            .maybeSingle(),
        ]);
        if (fieldsResult.error) throw fieldsResult.error;
        if (organizationResult.error) throw organizationResult.error;
        if (settingsResult.error) throw settingsResult.error;
        if (!alive) return;

        setForm(previewForm);
        setOrganizationName(organizationResult.data?.name ?? "");
        const logoPath = settingsResult.data?.logo_path;
        const useDefaultLogo = settingsResult.data?.use_default_logo ?? true;
        setOrganizationLogoUrl(!useDefaultLogo && logoPath
          ? supabase.storage.from("org-logos").getPublicUrl(logoPath).data.publicUrl
          : null);
        setFields(((fieldsResult.data ?? []) as PreviewFieldRow[]).map((field) => ({
          key: field.field_key,
          type: field.field_type,
          label: field.label,
          help_text: field.help_text ?? "",
          placeholder: field.placeholder ?? "",
          required: field.is_required,
          options: Array.isArray(field.options) ? field.options : [],
          width: field.layout_width ?? "full",
        })));
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : "Unable to preview form.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [formId]);

  if (loading) return <main className="min-h-screen bg-slate-100 p-6"><div className="mx-auto max-w-3xl rounded-3xl border bg-white p-8 text-sm text-slate-600">Loading preview…</div></main>;
  if (error || !form) return <main className="min-h-screen bg-slate-100 p-6"><div className="mx-auto max-w-xl rounded-3xl border bg-white p-8"><h1 className="text-lg font-semibold">Preview unavailable</h1><p className="mt-2 text-sm text-slate-600">{error}</p><Link href="/app/communications/forms" className="mt-5 inline-block rounded-2xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50">Back to Forms</Link></div></main>;

  return <main className="min-h-screen bg-slate-100 px-4 py-6 sm:px-6 sm:py-10">
    <div className="mx-auto max-w-4xl">
      <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-blue-950 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold">Preview mode</div>
          <div className="text-xs leading-5 text-blue-800">
            This is how respondents will see the saved form. Answers cannot be submitted here.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-blue-200 bg-white px-2.5 py-1 text-xs font-semibold capitalize">
            {form.status === "open" ? "Active" : form.status === "closed" ? "Closed" : "Draft"} · revision {form.revision}
          </span>
          <Link href="/app/communications/forms" className="rounded-xl border border-blue-200 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-blue-100">
            Back to Forms
          </Link>
        </div>
      </div>

      <FormRenderer
        title={form.title}
        description={form.description}
        fields={fields}
        organizationName={organizationName}
        organizationLogoUrl={organizationLogoUrl}
        previewMode
      />
    </div>
  </main>;
}
