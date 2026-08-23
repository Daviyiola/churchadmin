"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import SaveSubmissionToPeopleModal from "@/components/forms/SaveSubmissionToPeopleModal";

type InboxStatus = "all" | "new" | "reviewed" | "archived";
type SubmissionStatus = Exclude<InboxStatus, "all">;
type SnapshotField = { key: string; label: string; type: string };
type Submission = {
  id: string;
  form_revision: number;
  status: SubmissionStatus;
  form_snapshot: { title?: string; fields?: SnapshotField[] };
  answers: Record<string, string | string[]>;
  result_member_id: string | null;
  person_action: "created_member" | "created_visitor" | "updated_member" | "updated_visitor" | null;
  processed_at: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  archived_at: string | null;
  source_type: "permanent" | "campaign" | "personal";
  source_label: string | null;
};
type InboxPayload = {
  form: {
    id: string; title: string; form_kind: string; revision: number;
    created_at: string; updated_at: string;
    created_by_email: string; updated_by_email: string;
  };
  submissions: Submission[];
  counts: Record<InboxStatus, number>;
  page: number;
  page_size: number;
  total: number;
};

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) throw new Error("Your session has expired. Please sign in again.");
  return { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" };
}

function answerText(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "No answer";
  return value?.trim() || "No answer";
}

function submissionName(submission: Submission) {
  const fields = submission.form_snapshot?.fields ?? [];
  const find = (label: string) => {
    const field = fields.find((candidate) => candidate.label.toLowerCase() === label);
    return field ? answerText(submission.answers[field.key]) : "";
  };
  const name = `${find("first name")} ${find("last name")}`
    .replaceAll("No answer", "").replace(/\s+/g, " ").trim();
  if (name) return name;
  const preview = fields
    .map((field) => ({ label: field.label.trim(), answer: answerText(submission.answers[field.key]) }))
    .filter((item) => item.answer !== "No answer")
    .slice(0, 3)
    .map((item) => `${item.label}: ${item.answer}`)
    .join(" · ");
  if (!preview) return "Response without answered questions";
  return preview.length > 120 ? `${preview.slice(0, 117).trimEnd()}…` : preview;
}

export default function FormSubmissionInboxPage() {
  const { formId } = useParams<{ formId: string }>();
  const [status, setStatus] = useState<InboxStatus>("all");
  const [page, setPage] = useState(1);
  const [payload, setPayload] = useState<InboxPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updating, setUpdating] = useState<string | null>(null);
  const [peopleSubmission, setPeopleSubmission] = useState<Submission | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [formInfoOpen, setFormInfoOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/forms/${formId}/submissions?status=${status}&page=${page}&q=${encodeURIComponent(search)}`,
        { headers: await authHeaders(), cache: "no-store" },
      );
      const body = await response.json().catch(() => null) as InboxPayload | { error?: string } | null;
      if (!response.ok) throw new Error(body && "error" in body ? body.error : "Unable to load submissions.");
      setPayload(body as InboxPayload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load submissions.");
    } finally {
      setLoading(false);
    }
  }, [formId, page, search, status]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);
  const pageCount = Math.max(1, Math.ceil((payload?.total ?? 0) / (payload?.page_size ?? 25)));
  const tabs = useMemo(() => ([
    ["all", "All"], ["new", "New"], ["reviewed", "Reviewed"], ["archived", "Archived"],
  ] as Array<[InboxStatus, string]>), []);

  async function setSubmissionStatus(submissionId: string, nextStatus: SubmissionStatus) {
    setUpdating(submissionId);
    setError("");
    try {
      const response = await fetch(`/api/forms/${formId}/submissions`, {
        method: "PATCH",
        headers: await authHeaders(),
        body: JSON.stringify({ submission_id: submissionId, status: nextStatus }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error || "Unable to update the submission.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update the submission.");
    } finally {
      setUpdating(null);
    }
  }

  return <div className="min-h-full bg-primary/[0.02] p-6">
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Form inbox</div>
          <div className="mt-1 flex items-center gap-2"><h1 className="text-xl font-semibold">{payload?.form.title ?? "Submissions"}</h1>{payload?.form ? <button type="button" title="Form information" aria-label="Form information" onClick={() => setFormInfoOpen(true)} className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold text-slate-500 hover:bg-primary/[0.06]">i</button> : null}</div>
          <p className="mt-1 text-sm text-slate-600">Review responses collected through this form. Closing a form does not remove its inbox.</p>
        </div>
        <Link href="/app/communications/forms" className="w-fit rounded-2xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50">Back to Forms</Link>
      </div>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      <div className="flex flex-wrap items-center gap-3">
      <div className="relative order-2 min-w-[min(100%,18rem)] flex-1"><span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400" aria-hidden="true">⌕</span><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} maxLength={120} placeholder="Search responses, answers, or source" className="w-full rounded-2xl border bg-white py-2.5 pl-9 pr-10 text-sm outline-none focus:ring-2 focus:ring-primary/20" />{searchInput ? <button type="button" onClick={() => setSearchInput("")} className="absolute inset-y-0 right-3 text-xs font-semibold text-slate-500 hover:text-slate-800">Clear</button> : null}</div>

      <div className="order-1 inline-flex max-w-full shrink-0 overflow-x-auto rounded-2xl border bg-primary/[0.04] p-1">
        {tabs.map(([key, label]) => <button key={key} type="button" onClick={() => { setStatus(key); setPage(1); }} className={`whitespace-nowrap rounded-2xl px-4 py-2 text-sm ${status === key ? "border bg-white shadow-sm" : "text-slate-600 hover:bg-white"}`}>
          {label} <span className="ml-1 text-xs text-slate-400">{payload?.counts[key] ?? 0}</span>
        </button>)}
      </div>
      </div>

      {loading ? <div className="rounded-3xl border bg-white p-8 text-sm text-slate-600">Loading submissions…</div> : null}
      {!loading && payload?.submissions.length === 0 ? <div className="rounded-3xl border border-dashed bg-white p-12 text-center"><div className="font-semibold">{search ? "No matching responses" : `No ${status === "all" ? "submissions" : status + " submissions"}`}</div><p className="mt-1 text-sm text-slate-500">{search ? "Try another name, answer, or source." : "Responses will appear here after this form is shared and completed."}</p></div> : null}

      {!loading ? <div className="space-y-3">
        {payload?.submissions.map((submission) => {
          const fields = submission.form_snapshot?.fields ?? [];
          return <details key={submission.id} className="group rounded-3xl border bg-white shadow-sm open:ring-1 open:ring-slate-200">
            <summary className="flex cursor-pointer list-none flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="truncate font-semibold">{submissionName(submission)}</div>
                <div className="mt-1 text-xs text-slate-500">Submitted {new Date(submission.submitted_at).toLocaleString()} · Form version {submission.form_revision}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full border bg-primary/[0.04] px-2.5 py-1 text-xs font-semibold text-slate-600">
                  {submission.source_type === "campaign"
                    ? submission.source_label || "Campaign link"
                    : submission.source_type === "personal"
                      ? "Personal link"
                      : "View"}
                </span>
                {submission.person_action ? <Link href="/app/people/members" className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:underline"><span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[10px] leading-none text-white" aria-hidden="true">✓</span>{{created_member:"Member created",created_visitor:"Visitor created",updated_member:"Member updated",updated_visitor:"Visitor updated"}[submission.person_action]}</Link> : null}
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${submission.status === "new" ? "border-amber-200 bg-amber-50 text-amber-700" : submission.status === "archived" ? "border-slate-300 bg-slate-100 text-slate-600" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{submission.status}</span>
              </div>
            </summary>
            <div className="border-t px-5 py-5">
              <dl className="grid gap-4 sm:grid-cols-2">
                {fields.map((field) => <div key={field.key} className="rounded-2xl bg-primary/[0.035] px-4 py-3"><dt className="text-xs font-semibold text-slate-500">{field.label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-800">{answerText(submission.answers[field.key])}</dd></div>)}
              </dl>
              <div className="mt-5 flex flex-wrap justify-end gap-2 border-t pt-4">
                {payload.form.form_kind !== "first_timer" && !submission.person_action ? <button disabled={updating === submission.id} onClick={() => setPeopleSubmission(submission)} className="rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">Save to People</button> : null}
                {submission.status === "new" ? <button disabled={updating === submission.id} onClick={() => void setSubmissionStatus(submission.id, "reviewed")} className="rounded-xl border px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50">Mark reviewed</button> : null}
                {submission.status !== "archived" ? <button disabled={updating === submission.id} onClick={() => void setSubmissionStatus(submission.id, "archived")} className="rounded-xl border px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50">Archive</button> : <button disabled={updating === submission.id} onClick={() => void setSubmissionStatus(submission.id, "reviewed")} className="rounded-xl border px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50">Restore to reviewed</button>}
              </div>
            </div>
          </details>;
        })}
      </div> : null}

      {!loading && payload && pageCount > 1 ? <div className="flex items-center justify-between rounded-2xl border bg-white px-4 py-3 text-sm"><button disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-xl border px-3 py-1.5 disabled:opacity-40">Previous</button><span className="text-slate-500">Page {page} of {pageCount}</span><button disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)} className="rounded-xl border px-3 py-1.5 disabled:opacity-40">Next</button></div> : null}
    </div>
    {peopleSubmission ? <SaveSubmissionToPeopleModal formId={formId} submission={peopleSubmission} onClose={() => setPeopleSubmission(null)} onSaved={() => { setPeopleSubmission(null); void load(); }} /> : null}
    {formInfoOpen && payload?.form ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={() => setFormInfoOpen(false)}><div className="w-full max-w-md rounded-3xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between gap-3 border-b px-6 py-4"><div><h2 className="font-semibold">Form information</h2><p className="mt-0.5 text-sm text-slate-600">{payload.form.title}</p></div><button type="button" onClick={() => setFormInfoOpen(false)} className="rounded-xl border px-3 py-1.5 text-sm hover:bg-slate-50">Close</button></div><dl className="grid gap-4 px-6 py-5 text-sm sm:grid-cols-2"><div><dt className="text-xs font-semibold text-slate-500">Created at</dt><dd className="mt-1 text-slate-800">{new Date(payload.form.created_at).toLocaleString()}</dd></div><div><dt className="text-xs font-semibold text-slate-500">Created by</dt><dd className="mt-1 break-words text-slate-800">{payload.form.created_by_email}</dd></div><div><dt className="text-xs font-semibold text-slate-500">Last updated at</dt><dd className="mt-1 text-slate-800">{new Date(payload.form.updated_at).toLocaleString()}</dd></div><div><dt className="text-xs font-semibold text-slate-500">Last updated by</dt><dd className="mt-1 break-words text-slate-800">{payload.form.updated_by_email}</dd></div><div><dt className="text-xs font-semibold text-slate-500">Current version</dt><dd className="mt-1 text-slate-800">Version {payload.form.revision}</dd></div></dl></div></div> : null}
  </div>;
}
