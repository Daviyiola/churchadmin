"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QRCodeCanvas } from "qrcode.react";
import { getActiveOrgId } from "@/lib/auth";
import { supabase } from "@/lib/supabaseClient";
import FormRenderer from "@/components/forms/FormRenderer";

type FormStatus = "draft" | "open" | "closed";
type FormTab = "all" | FormStatus;
type FieldType =
  | "short_text"
  | "long_text"
  | "email"
  | "phone"
  | "number"
  | "date"
  | "month_day"
  | "single_choice"
  | "multiple_choice"
  | "dropdown"
  | "yes_no";

type FormRow = {
  id: string;
  title: string;
  description: string | null;
  status: FormStatus;
  form_kind: "generic" | "first_timer" | "member_update" | "attendance";
  is_system: boolean;
  slug: string;
  revision: number;
  updated_at: string;
  response_count: number;
};

type FieldRow = {
  form_id: string;
  field_key: string;
  field_type: FieldType;
  label: string;
  help_text: string | null;
  placeholder: string | null;
  is_required: boolean;
  options: string[];
  layout_width: "full" | "half";
  is_locked: boolean;
  position: number;
};

type EditableField = {
  key: string;
  type: FieldType;
  label: string;
  help_text: string;
  placeholder: string;
  required: boolean;
  options: string[];
  width: "full" | "half";
  locked: boolean;
};

const FIELD_TYPES: Array<{ value: FieldType; label: string }> = [
  { value: "short_text", label: "Short answer" },
  { value: "long_text", label: "Paragraph" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date (with year)" },
  { value: "month_day", label: "Month and day only" },
  { value: "single_choice", label: "Multiple choice" },
  { value: "multiple_choice", label: "Checkboxes" },
  { value: "dropdown", label: "Dropdown" },
  { value: "yes_no", label: "Yes / No" },
];

const CHOICE_TYPES: FieldType[] = [
  "single_choice",
  "multiple_choice",
  "dropdown",
];

function statusClasses(status: FormStatus) {
  if (status === "open") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "closed") return "border-slate-300 bg-slate-100 text-slate-600";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function statusLabel(status: FormStatus) {
  if (status === "open") return "Active";
  if (status === "closed") return "Closed";
  return "Draft";
}

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your session has expired. Please sign in again.");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function responseError(response: Response) {
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  return payload?.error || "Something went wrong.";
}

export default function FormsPage() {
  const router = useRouter();
  const orgId = getActiveOrgId();
  const [forms, setForms] = useState<FormRow[]>([]);
  const [fields, setFields] = useState<FieldRow[]>([]);
  const [tab, setTab] = useState<FormTab>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [allowed, setAllowed] = useState(false);
  const [organizationName, setOrganizationName] = useState("");
  const [organizationLogoUrl, setOrganizationLogoUrl] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [creating, setCreating] = useState(false);

  const [editing, setEditing] = useState<FormRow | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editFields, setEditFields] = useState<EditableField[]>([]);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState("");
  const [sharing, setSharing] = useState<FormRow | null>(null);
  const qrWrapRef = useRef<HTMLDivElement | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2800);
  }, []);

  const load = useCallback(async () => {
    if (!orgId) {
      setError("No active organization selected.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { data: session } = await supabase.auth.getSession();
      const userId = session.session?.user.id;
      if (!userId) throw new Error("Please sign in again.");

      const { data: membership, error: membershipError } = await supabase
        .from("user_organizations")
        .select("role")
        .eq("organization_id", orgId)
        .eq("user_id", userId)
        .maybeSingle();
      if (membershipError) throw membershipError;
      const canManage = ["owner", "admin", "finance"].includes(String(membership?.role ?? ""));
      setAllowed(canManage);
      if (!canManage) return;

      const [formsResponse, fieldsResult, organizationResult, settingsResult] = await Promise.all([
        fetch(`/api/forms?organization_id=${encodeURIComponent(orgId)}`, { headers: await authHeaders(), cache: "no-store" }),
        supabase
          .from("form_fields")
          .select("form_id,field_key,field_type,label,help_text,placeholder,is_required,options,layout_width,is_locked,position")
          .eq("org_id", orgId)
          .order("position", { ascending: true }),
        supabase
          .from("organizations")
          .select("name")
          .eq("id", orgId)
          .maybeSingle(),
        supabase
          .from("organization_settings")
          .select("logo_path,use_default_logo")
          .eq("organization_id", orgId)
          .maybeSingle(),
      ]);
      const formsPayload = await formsResponse.json().catch(() => null) as { forms?: FormRow[]; error?: string } | null;
      if (!formsResponse.ok) throw new Error(formsPayload?.error || "Unable to load forms.");
      if (fieldsResult.error) throw fieldsResult.error;
      if (organizationResult.error) throw organizationResult.error;
      if (settingsResult.error) throw settingsResult.error;
      setForms([...(formsPayload?.forms ?? [])].sort((left, right) => {
        const leftPriority = left.form_kind === "first_timer" ? 0 : 1;
        const rightPriority = right.form_kind === "first_timer" ? 0 : 1;
        if (leftPriority !== rightPriority) return leftPriority - rightPriority;
        return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
      }));
      setFields((fieldsResult.data ?? []) as FieldRow[]);
      setOrganizationName(organizationResult.data?.name ?? "");
      const logoPath = settingsResult.data?.logo_path;
      const useDefaultLogo = settingsResult.data?.use_default_logo ?? true;
      setOrganizationLogoUrl(!useDefaultLogo && logoPath
        ? supabase.storage.from("org-logos").getPublicUrl(logoPath).data.publicUrl
        : null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load forms.");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => ({
    all: forms.length,
    draft: forms.filter((form) => form.status === "draft").length,
    open: forms.filter((form) => form.status === "open").length,
    closed: forms.filter((form) => form.status === "closed").length,
  }), [forms]);
  const visibleForms = forms.filter((form) => {
    if (tab !== "all" && form.status !== tab) return false;
    const term = search.trim().toLowerCase();
    return !term || `${form.title} ${form.description ?? ""}`.toLowerCase().includes(term);
  });
  const fieldsFor = useCallback(
    (formId: string) => fields.filter((field) => field.form_id === formId),
    [fields],
  );

  function openEditor(form: FormRow) {
    setEditing(form);
    setEditTitle(form.title);
    setEditDescription(form.description ?? "");
    setEditFields(fieldsFor(form.id).map((field) => ({
      key: field.field_key,
      type: field.field_type,
      label: field.label,
      help_text: field.help_text ?? "",
      placeholder: field.placeholder ?? "",
      required: field.is_required,
      options: Array.isArray(field.options) ? field.options : [],
      width: field.layout_width ?? "full",
      locked: field.is_locked ?? false,
    })));
    setEditorError("");
  }

  function inboxHref(form: FormRow) {
    return form.form_kind === "first_timer" ? "/app/people/first-timers" : `/app/communications/forms/${form.id}/submissions`;
  }

  async function createForm() {
    if (!orgId || !createName.trim()) return;
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/forms", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          organization_id: orgId,
          title: createName,
          description: createDescription,
        }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const payload = await response.json() as { form_id: string };
      setCreateOpen(false);
      setCreateName("");
      setCreateDescription("");
      await load();
      showToast("Draft form created");
      openEditor({
        id: payload.form_id,
        title: createName.trim(),
        description: createDescription.trim() || null,
        status: "draft",
        form_kind: "generic",
        is_system: false,
        slug: "",
        revision: 1,
        updated_at: new Date().toISOString(),
        response_count: 0,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create form.");
    } finally {
      setCreating(false);
    }
  }

  function addField() {
    setEditFields((current) => [...current, {
      key: crypto.randomUUID(),
      type: "short_text",
      label: `Question ${current.length + 1}`,
      help_text: "",
      placeholder: "",
      required: false,
      options: [],
      width: "full",
      locked: false,
    }]);
  }

  function updateField(index: number, patch: Partial<EditableField>) {
    setEditFields((current) => current.map((field, fieldIndex) =>
      fieldIndex === index ? { ...field, ...patch } : field));
  }

  function moveField(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= editFields.length) return;
    setEditFields((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function jumpToField(fieldKey: string) {
    const target = document.getElementById(`form-field-editor-${fieldKey}`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => target.focus({ preventScroll: true }), 250);
  }

  async function saveForm() {
    if (!editing) return;
    setSaving(true);
    setEditorError("");
    try {
      const response = await fetch(`/api/forms/${editing.id}`, {
        method: "PATCH",
        headers: await authHeaders(),
        body: JSON.stringify({
          action: "save",
          title: editTitle,
          description: editDescription,
          fields: editFields,
        }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setEditing(null);
      await load();
      showToast("Form saved");
    } catch (cause) {
      setEditorError(cause instanceof Error ? cause.message : "Unable to save form.");
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(form: FormRow, status: "open" | "closed") {
    if (form.form_kind === "first_timer") return;
    try {
      const response = await fetch(`/api/forms/${form.id}`, {
        method: "PATCH",
        headers: await authHeaders(),
        body: JSON.stringify({ action: "status", status }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      await load();
      showToast(status === "closed" ? "Form closed" : "Form published");
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Unable to change form status.");
    }
  }

  function shareUrl(form: FormRow) {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/forms/${form.slug}`;
  }

  async function copyShareLink(form: FormRow) {
    await navigator.clipboard.writeText(shareUrl(form));
    showToast("Form link copied");
  }

  function downloadQrPng(form: FormRow) {
    const canvas = qrWrapRef.current?.querySelector("canvas");
    if (!canvas) return;
    const anchor = document.createElement("a");
    anchor.href = canvas.toDataURL("image/png");
    anchor.download = `${form.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "form"}-qr.png`;
    anchor.click();
  }

  async function deleteForm(form: FormRow) {
    if (form.is_system || form.status === "open") return;
    if (!window.confirm(`Delete “${form.title}”? Only forms without submissions can be deleted.`)) return;
    try {
      const response = await fetch(`/api/forms/${form.id}`, {
        method: "PATCH",
        headers: await authHeaders(),
        body: JSON.stringify({ action: "delete" }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      await load();
      showToast("Form deleted");
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Unable to delete form.");
    }
  }

  if (loading) return <div className="p-10 text-sm text-slate-600">Loading forms…</div>;
  if (!allowed) return <div className="p-6"><div className="rounded-3xl border bg-white p-6 text-sm text-slate-700">Forms are available to owners, admins, and finance users.</div></div>;

  return <>
    <div className="min-h-full bg-primary/[0.02] p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold">Forms</h1>
            <p className="mt-1 text-sm text-slate-600">
              Build reusable forms, publish them when ready, and close them when needed.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { setCreateOpen(true); setError(""); }} className="rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
              Create form
            </button>
            <Link href="/app/communications" className="rounded-2xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50">
              Back to Communications
            </Link>
          </div>
        </div>

        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          Publish a form, share its link or QR code, and review responses from that form’s inbox.
        </div>

        {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

        <div className="flex flex-wrap items-center gap-3">
        <div className="relative order-2 min-w-[min(100%,18rem)] flex-1"><span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400" aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search forms by name or description" className="w-full rounded-2xl border bg-white py-2.5 pl-9 pr-10 text-sm outline-none focus:ring-2 focus:ring-primary/20" />{search ? <button type="button" onClick={() => setSearch("")} className="absolute inset-y-0 right-3 text-xs font-semibold text-slate-500 hover:text-slate-800">Clear</button> : null}</div>

        <div className="order-1 inline-flex max-w-full shrink-0 overflow-x-auto rounded-2xl border bg-primary/[0.04] p-1">
          {([
            ["all", "All"],
            ["draft", "Drafts"],
            ["open", "Active"],
            ["closed", "Closed"],
          ] as Array<[FormTab, string]>).map(([key, label]) => <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
              className={`whitespace-nowrap rounded-2xl px-4 py-2 text-sm ${tab === key ? "border bg-white shadow-sm" : "text-slate-600 hover:bg-white"}`}
          >
              {label} <span className="ml-1 text-xs text-slate-400">{counts[key]}</span>
          </button>)}
        </div>
        </div>

        {visibleForms.length === 0 ? <div className="rounded-3xl border border-dashed bg-white px-6 py-14 text-center">
          <div className="font-semibold">{search ? "No matching forms" : `No ${tab === "all" ? "forms" : `${tab} forms`} yet`}</div>
          <div className="mt-1 text-sm text-slate-500">{search ? "Try another form name or description." : "Create a draft and add your first question."}</div>
        </div> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleForms.map((form) => {
            const formFields = fieldsFor(form.id);
            return <article key={form.id} role="link" tabIndex={0} onClick={(event) => { if (!(event.target as HTMLElement).closest("button,a")) router.push(inboxHref(form)); }} onKeyDown={(event) => { if (!(event.target as HTMLElement).closest("button,a") && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); router.push(inboxHref(form)); } }} className="cursor-pointer rounded-3xl border bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary/30">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link href={inboxHref(form)} className="min-w-0"><h2 className="truncate font-semibold hover:underline">{form.form_kind === "first_timer" ? "First Timers Form" : form.title}</h2></Link>
                    {form.is_system ? <span className="shrink-0 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700">Built-in</span> : null}
                  </div>
                  <p className="mt-1 line-clamp-2 min-h-10 text-sm text-slate-600">{form.description || "No description"}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClasses(form.status)}`}>{statusLabel(form.status)}</span>
                  {!form.is_system && form.status !== "open" ? <button type="button" title="Delete form" aria-label={`Delete ${form.title}`} onClick={() => void deleteForm(form)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-700">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button> : null}
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                <span>{formFields.length} {formFields.length === 1 ? "field" : "fields"}</span>
                <span>{form.response_count} {form.response_count === 1 ? "response" : "responses"}</span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
                <button type="button" onClick={() => openEditor(form)} className="rounded-xl border px-3 py-1.5 text-xs font-semibold hover:bg-slate-50">Edit</button>
                <Link target="_blank" rel="noopener noreferrer" href={`/forms/preview/${form.id}`} className="rounded-xl border px-3 py-1.5 text-xs font-semibold hover:bg-slate-50">Preview</Link>
                {form.status === "open" ? <button type="button" onClick={() => setSharing(form)} className="rounded-xl border px-3 py-1.5 text-xs font-semibold hover:bg-slate-50">Share</button> : null}
                <Link href={inboxHref(form)} className="rounded-xl border px-3 py-1.5 text-xs font-semibold hover:bg-slate-50">{form.form_kind === "first_timer" ? "View First Timers" : "Inbox"}</Link>
                {form.form_kind !== "first_timer" ? (form.status === "open" ? <button type="button" onClick={() => void changeStatus(form, "closed")} className="rounded-xl border px-3 py-1.5 text-xs font-semibold hover:bg-slate-50">Close</button> : <button type="button" onClick={() => void changeStatus(form, "open")} className="rounded-xl border px-3 py-1.5 text-xs font-semibold hover:bg-slate-50">Publish</button>) : null}
              </div>
            </article>;
          })}
        </div>}
      </div>
    </div>

    {createOpen ? <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="w-full max-w-lg rounded-t-3xl bg-white p-6 shadow-xl sm:rounded-3xl">
        <h2 className="text-lg font-semibold">Create a form</h2>
        <p className="mt-1 text-sm text-slate-600">Start with the basics. Questions are added in the builder.</p>
        <label className="mt-5 block text-xs font-semibold text-slate-600">Form name *</label>
        <input autoFocus maxLength={120} value={createName} onChange={(event) => setCreateName(event.target.value)} className="mt-1 w-full rounded-2xl border px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-200" placeholder="Sunday registration" />
        <label className="mt-4 block text-xs font-semibold text-slate-600">Description</label>
        <textarea maxLength={2000} value={createDescription} onChange={(event) => setCreateDescription(event.target.value)} className="mt-1 min-h-24 w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-200" placeholder="Tell respondents what this form is for." />
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" disabled={creating} onClick={() => setCreateOpen(false)} className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50">Cancel</button>
          <button type="button" disabled={creating || !createName.trim()} onClick={() => void createForm()} className="rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{creating ? "Creating…" : "Create draft"}</button>
        </div>
      </div>
    </div> : null}

    {editing ? <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 sm:items-center sm:p-4">
      <div className="flex max-h-[96vh] w-full max-w-6xl flex-col rounded-t-3xl bg-white shadow-2xl sm:max-h-[92vh] sm:rounded-3xl">
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4 sm:px-6">
          <div><h2 className="text-lg font-semibold">Edit form</h2><p className="text-xs text-slate-500">{editing.status === "closed" ? "Publish this form again before editing." : "Changes create a new revision."}</p></div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" disabled={editing.status === "closed"} onClick={addField} className="rounded-xl bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">Add field</button>
            <button type="button" onClick={() => setEditing(null)} className="rounded-xl border px-3 py-1.5 text-sm hover:bg-slate-50">Close</button>
          </div>
        </div>
        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
          <div className="space-y-5 p-5 sm:p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label className="text-xs font-semibold text-slate-600">Form heading *</label><input disabled={editing.status === "closed"} maxLength={120} value={editTitle} onChange={(event) => setEditTitle(event.target.value)} className="mt-1 w-full rounded-2xl border px-4 py-2.5 text-sm disabled:bg-slate-100" /></div>
              <div><label className="text-xs font-semibold text-slate-600">Description</label><input disabled={editing.status === "closed"} maxLength={2000} value={editDescription} onChange={(event) => setEditDescription(event.target.value)} className="mt-1 w-full rounded-2xl border px-4 py-2.5 text-sm disabled:bg-slate-100" /></div>
            </div>

            <div><h3 className="font-semibold">Questions</h3><p className="text-xs leading-5 text-slate-500">Up to 50 fields per form. Choose full or half width for larger screens; all fields stack on mobile.</p></div>

            {editFields.length === 0 ? <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-slate-500">Add a field to begin building this form.</div> : <div className="space-y-3">
              {editFields.map((field, index) => field.locked ? (
                <div id={`form-field-editor-${field.key}`} tabIndex={-1} key={field.key} className="flex scroll-m-6 items-center justify-between gap-3 rounded-2xl border border-blue-200 bg-blue-50/60 px-4 py-3 outline-none transition focus:ring-2 focus:ring-blue-300">
                  <div className="font-semibold text-slate-800">{field.label}</div>
                  <span className="shrink-0 rounded-full border border-blue-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700">Built-in · locked</span>
                </div>
              ) : (
              <div id={`form-field-editor-${field.key}`} tabIndex={-1} key={field.key} className="scroll-m-6 rounded-2xl border bg-slate-50 p-4 outline-none transition focus:ring-2 focus:ring-primary/30">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_130px]">
                  <div className="min-w-0 flex-1"><label className="text-xs font-semibold text-slate-600">Question *</label><input disabled={editing.status === "closed" || field.locked} maxLength={160} value={field.label} onChange={(event) => updateField(index, { label: event.target.value })} className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm disabled:bg-slate-100" /></div>
                  <div><label className="text-xs font-semibold text-slate-600">Answer type</label><select disabled={editing.status === "closed" || field.locked} value={field.type} onChange={(event) => { const type = event.target.value as FieldType; updateField(index, { type, options: CHOICE_TYPES.includes(type) ? (field.options.length ? field.options : ["Option 1"]) : [] }); }} className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm disabled:bg-slate-100">{FIELD_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></div>
                  <div><label className="text-xs font-semibold text-slate-600">Width</label><select disabled={editing.status === "closed" || field.locked} value={field.width} onChange={(event) => updateField(index, { width: event.target.value as "full" | "half" })} className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm disabled:bg-slate-100"><option value="full">Full width</option><option value="half">Half width</option></select></div>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2"><input disabled={editing.status === "closed" || field.locked} maxLength={200} value={field.placeholder} onChange={(event) => updateField(index, { placeholder: event.target.value })} className="rounded-xl border bg-white px-3 py-2 text-sm disabled:bg-slate-100" placeholder="Placeholder (optional)" /><input disabled={editing.status === "closed" || field.locked} maxLength={500} value={field.help_text} onChange={(event) => updateField(index, { help_text: event.target.value })} className="rounded-xl border bg-white px-3 py-2 text-sm disabled:bg-slate-100" placeholder="Help text (optional)" /></div>
                {CHOICE_TYPES.includes(field.type) ? <div className="mt-3"><label className="text-xs font-semibold text-slate-600">Choices — one per line</label><textarea disabled={editing.status === "closed" || field.locked} value={field.options.join("\n")} onChange={(event) => updateField(index, { options: event.target.value.split("\n") })} className="mt-1 min-h-24 w-full rounded-xl border bg-white px-3 py-2 text-sm disabled:bg-slate-100" /></div> : null}
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3"><label className="mr-auto flex items-center gap-2 text-sm"><input disabled={editing.status === "closed" || field.locked} type="checkbox" checked={field.required} onChange={(event) => updateField(index, { required: event.target.checked })} />Required</label><button type="button" disabled={editing.status === "closed" || field.locked || index === 0 || editFields[index - 1]?.locked} onClick={() => moveField(index, -1)} className="rounded-lg border px-2 py-1 text-xs disabled:opacity-40">Up</button><button type="button" disabled={editing.status === "closed" || field.locked || index === editFields.length - 1 || editFields[index + 1]?.locked} onClick={() => moveField(index, 1)} className="rounded-lg border px-2 py-1 text-xs disabled:opacity-40">Down</button><button type="button" disabled={editing.status === "closed" || field.locked} onClick={() => setEditFields((current) => current.filter((_, fieldIndex) => fieldIndex !== index))} className="rounded-lg border border-rose-200 px-2 py-1 text-xs text-rose-700 disabled:opacity-40">Remove</button></div>
              </div>))}
            </div>}
          </div>

          <aside className="border-t bg-slate-50 p-5 lg:border-l lg:border-t-0 sm:p-6"><div className="sticky top-0"><div className="flex items-center justify-between gap-3"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Preview</div><Link target="_blank" rel="noopener noreferrer" href={`/forms/preview/${editing.id}`} className="text-xs font-semibold text-primary underline underline-offset-2">Open saved preview</Link></div><p className="mt-1 text-xs text-slate-500">Select a question in the preview to jump to its editor.</p><div className="mt-3"><FormRenderer title={editTitle} description={editDescription} fields={editFields} organizationName={organizationName} organizationLogoUrl={organizationLogoUrl} compact previewMode onFieldSelect={jumpToField} /></div></div></aside>
        </div>
        <div className="flex items-center justify-between gap-3 border-t px-5 py-4 sm:px-6">{editorError ? <div className="text-sm text-rose-600">{editorError}</div> : <div className="text-xs text-slate-500">Version number: {editing.revision}</div>}<button type="button" disabled={saving || editing.status === "closed" || !editTitle.trim()} onClick={() => void saveForm()} className="rounded-2xl bg-primary px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Save changes"}</button></div>
      </div>
    </div> : null}

    {sharing ? <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4" onClick={() => setSharing(null)}>
      <div className="flex max-h-[80dvh] w-full max-w-xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="border-b px-6 py-4"><h2 className="text-lg font-semibold">Share {sharing.title}</h2><p className="mt-1 text-xs text-slate-600">Anyone with this link can submit while the form is active.</p></div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-6">
          <div className="flex justify-center"><div ref={qrWrapRef} className="rounded-3xl border bg-slate-50 p-5"><QRCodeCanvas value={shareUrl(sharing)} size={280} includeMargin /></div></div>
          <button type="button" onClick={() => downloadQrPng(sharing)} className="w-full rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50">Download QR (PNG)</button>
          <div className="flex flex-col gap-2 sm:flex-row"><input readOnly value={shareUrl(sharing)} className="min-w-0 flex-1 rounded-2xl border px-3 py-2 text-sm" /><button type="button" onClick={() => void copyShareLink(sharing)} className="rounded-2xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50">Copy link</button></div>
          <Link target="_blank" rel="noopener noreferrer" href={`/forms/${sharing.slug}`} className="block w-full rounded-xl border px-4 py-2 text-center text-sm font-semibold hover:bg-slate-50">Open public form</Link>
        </div>
        <div className="flex justify-end border-t px-6 py-4"><button type="button" onClick={() => setSharing(null)} className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50">Close</button></div>
      </div>
    </div> : null}

    {toast ? <div className="fixed bottom-5 left-1/2 z-[70] -translate-x-1/2 rounded-2xl bg-slate-900 px-4 py-2 text-sm text-white shadow-xl">{toast}</div> : null}
  </>;
}
