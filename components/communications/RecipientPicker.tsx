"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { getAccessToken } from "@/lib/auth";
import type { AudienceCriteria, AudienceFormSource, AudiencePreview } from "@/lib/communications/audience";

type OptionMember = { id: string; name: string; email: string; gender: string | null; age_group: string | null; membership_stage: string | null };
type NamedOption = { id: string; name: string };
type FormField = { field_key: string; field_type: "email" | "short_text" | "long_text"; label: string; position: number };
type FormOption = { id: string; title: string; status: string; is_system: boolean; fields: FormField[] };
type OptionsPayload = { members: OptionMember[]; groups: NamedOption[]; departments: NamedOption[]; forms: FormOption[] };

const PAGE_SIZE = 25;
const emptyCriteria: AudienceCriteria = {
  include_filtered_members: false, member_ids: [], genders: [], age_groups: [], membership_stages: [],
  group_ids: [], department_ids: [], form_sources: [], manual_text: "", excluded_emails: [],
};
const sourceNames: Record<string, string> = {
  members: "Active members", individuals: "Selected members", community_groups: "Community groups",
  worker_departments: "Worker departments", form_respondents: "Form respondents", additional: "Additional emails",
};

function toggle(list: string[], value: string) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function extractEmailCount(value: string) {
  const matches = value.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/gi) ?? [];
  return new Set(matches.map((email) => email.toLowerCase())).size;
}

function ChoiceList({ items, selected, onToggle, empty }: { items: NamedOption[]; selected: string[]; onToggle: (id: string) => void; empty: string }) {
  if (!items.length) return <div className="text-sm text-slate-500">{empty}</div>;
  return <div className="max-h-56 divide-y overflow-y-auto overflow-hidden rounded-2xl border">
    {items.map((item) => <label key={item.id} className="flex cursor-pointer items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50">
      <input type="checkbox" checked={selected.includes(item.id)} onChange={() => onToggle(item.id)} />
      <span>{item.name}</span>
    </label>)}
  </div>;
}

export type RecipientPickerHandle = {
  reviewAudience: () => Promise<AudiencePreview | null>;
};

export const RecipientPicker = forwardRef<RecipientPickerHandle, {
  orgId: string;
  value: AudiencePreview | null;
  onApply: (preview: AudiencePreview | null) => void;
  onContinue?: () => void;
  onSelectionStateChange?: (hasSelections: boolean) => void;
}>(function RecipientPicker({ orgId, value, onApply, onContinue, onSelectionStateChange }, ref) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [options, setOptions] = useState<OptionsPayload | null>(null);
  const [criteria, setCriteria] = useState<AudienceCriteria>(emptyCriteria);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState<AudiencePreview | null>(null);
  const [memberSearch, setMemberSearch] = useState("");
  const [page, setPage] = useState(1);
  const [excluded, setExcluded] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    getAccessToken().then(async (token) => {
      if (!token) throw new Error("Unauthorized");
      const response = await fetch(`/api/communications/audiences/options?organization_id=${encodeURIComponent(orgId)}`, { headers: { Authorization: `Bearer ${token}` } });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Unable to load recipient options.");
      if (active) setOptions(payload as OptionsPayload);
    }).catch((cause) => active && setError(cause instanceof Error ? cause.message : "Unable to load recipients."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [orgId]);

  const filteredMembers = useMemo(() => {
    const query = memberSearch.trim().toLowerCase();
    return (options?.members ?? []).filter((member) => {
      if (query && !`${member.name} ${member.email}`.toLowerCase().includes(query)) return false;
      if (criteria.genders.length && !criteria.genders.includes(member.gender ?? "")) return false;
      if (criteria.age_groups.length && !criteria.age_groups.includes(member.age_group ?? "")) return false;
      if (criteria.membership_stages.length && !criteria.membership_stages.includes(member.membership_stage ?? "")) return false;
      return true;
    });
  }, [criteria.age_groups, criteria.genders, criteria.membership_stages, memberSearch, options?.members]);

  const pageCount = Math.max(1, Math.ceil(filteredMembers.length / PAGE_SIZE));
  const shownMembers = filteredMembers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selectedForms = useMemo(() => new Map(criteria.form_sources.map((source) => [source.form_id, source])), [criteria.form_sources]);
  const selectedMemberCount = criteria.member_ids.length;
  const manualEmailCount = useMemo(() => extractEmailCount(criteria.manual_text), [criteria.manual_text]);
  const hasFilters = !!(criteria.genders.length || criteria.age_groups.length || criteria.membership_stages.length);
  const hasSelections = !!(
    criteria.include_filtered_members ||
    criteria.member_ids.length ||
    criteria.group_ids.length ||
    criteria.department_ids.length ||
    criteria.form_sources.length ||
    manualEmailCount
  );

  useEffect(() => setPage(1), [memberSearch, criteria.genders, criteria.age_groups, criteria.membership_stages]);
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);

  function updateCriteria(next: AudienceCriteria) {
    setCriteria(next);
    setReview(null);
    setExcluded([]);
    onApply(null);
  }

  function updateForm(form: FormOption, enabled: boolean) {
    const rest = criteria.form_sources.filter((source) => source.form_id !== form.id);
    const preferred = [...form.fields].sort((a, b) => (a.field_type === "email" ? -1 : b.field_type === "email" ? 1 : a.position - b.position))[0];
    updateCriteria({ ...criteria, form_sources: enabled && preferred ? [...rest, { form_id: form.id, field_key: preferred.field_key, statuses: ["new", "reviewed"] }] : rest });
  }

  function patchForm(formId: string, patch: Partial<AudienceFormSource>) {
    updateCriteria({ ...criteria, form_sources: criteria.form_sources.map((source) => source.form_id === formId ? { ...source, ...patch } : source) });
  }

  async function previewAudience(nextExcluded = excluded) {
    setExcluded(nextExcluded);
    setLoading(true);
    setError("");
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Unauthorized");
      const response = await fetch("/api/communications/audiences/preview", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ organization_id: orgId, criteria: { ...criteria, excluded_emails: nextExcluded } }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Unable to preview recipients.");
      const result = payload as AudiencePreview;
      setReview(result);
      onApply(result);
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to preview recipients.");
      return null;
    } finally { setLoading(false); }
  }

  useImperativeHandle(ref, () => ({
    reviewAudience: () => previewAudience([]),
  }));

  useEffect(() => {
    onSelectionStateChange?.(hasSelections);
  }, [hasSelections, onSelectionStateChange]);

  async function removeRecipient(email: string) {
    const next = [...excluded, email];
    setExcluded(next);
    await previewAudience(next);
  }

  const chips = useMemo(() => {
    if (!options) return [];
    const result: string[] = [];
    criteria.group_ids.forEach((id) => { const name = options.groups.find((item) => item.id === id)?.name; if (name) result.push(`Group: ${name}`); });
    criteria.department_ids.forEach((id) => { const name = options.departments.find((item) => item.id === id)?.name; if (name) result.push(`Department: ${name}`); });
    criteria.form_sources.forEach((source) => { const title = options.forms.find((item) => item.id === source.form_id)?.title; if (title) result.push(`Form: ${title}`); });
    if (manualEmailCount) result.push(`${manualEmailCount} additional email${manualEmailCount === 1 ? "" : "s"}`);
    return result;
  }, [criteria.department_ids, criteria.form_sources, criteria.group_ids, manualEmailCount, options]);

  return <>
    <div className="overflow-hidden rounded-3xl border bg-white">
      <div className="border-b px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div><div className="text-sm font-semibold">Audience</div><div className="mt-1 text-sm text-slate-600">Choose active members first, then add other recipient sources if needed.</div></div>
          <div className="rounded-2xl bg-primary/10 px-4 py-2 text-sm text-primary"><span className="font-semibold">{value?.total_recipients ?? selectedMemberCount}</span> {value ? "unique recipients reviewed" : "members selected"}</div>
        </div>
        {chips.length ? <div className="mt-4 flex flex-wrap gap-2">{chips.map((chip) => <span key={chip} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-700">{chip}</span>)}</div> : null}
      </div>

      <div className="space-y-5 px-5 py-5 sm:px-6">
        {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
        {loading && !options ? <div className="py-12 text-center text-sm text-slate-600">Loading active members...</div> : null}
        {options ? <>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <input className="min-w-0 flex-1 rounded-2xl border px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20" placeholder="Search active members by name or email" value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} />
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setFiltersOpen((current) => !current)} className={`rounded-2xl border px-4 py-2.5 text-sm font-semibold hover:bg-slate-50 ${hasFilters ? "border-primary text-primary" : ""}`}>Filters{hasFilters ? " (on)" : ""}</button>
              <button type="button" onClick={() => updateCriteria({ ...criteria, member_ids: options.members.map((member) => member.id) })} className="rounded-2xl border px-4 py-2.5 text-sm font-semibold hover:bg-slate-50">Select all active</button>
              <button type="button" onClick={() => setAdvancedOpen(true)} className="rounded-2xl bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary/85">More recipient options</button>
            </div>
          </div>

          {filtersOpen ? <div className="grid gap-3 rounded-2xl border bg-slate-50 p-4 sm:grid-cols-3">
            <select className="rounded-2xl border bg-white px-3 py-2.5 text-sm" value={criteria.genders[0] ?? ""} onChange={(event) => updateCriteria({ ...criteria, genders: event.target.value ? [event.target.value] : [] })}><option value="">All genders</option><option value="female">Female</option><option value="male">Male</option></select>
            <select className="rounded-2xl border bg-white px-3 py-2.5 text-sm" value={criteria.age_groups[0] ?? ""} onChange={(event) => updateCriteria({ ...criteria, age_groups: event.target.value ? [event.target.value] : [] })}><option value="">All age groups</option><option value="1-12">1-12</option><option value="13-17">13-17</option><option value="18-35">18-35</option><option value="36+">36+</option></select>
            <select className="rounded-2xl border bg-white px-3 py-2.5 text-sm" value={criteria.membership_stages[0] ?? ""} onChange={(event) => updateCriteria({ ...criteria, membership_stages: event.target.value ? [event.target.value] : [] })}><option value="">All stages</option><option value="member">Members</option><option value="visitor">Visitors</option></select>
            <div className="flex items-center justify-between gap-3 sm:col-span-3"><span className="text-xs text-slate-600">{filteredMembers.length} matching active member{filteredMembers.length === 1 ? "" : "s"}</span><div className="flex gap-3"><button type="button" onClick={() => updateCriteria({ ...criteria, genders: [], age_groups: [], membership_stages: [] })} className="text-xs font-semibold text-slate-700 underline">Clear filters</button><button type="button" onClick={() => updateCriteria({ ...criteria, member_ids: [...new Set([...criteria.member_ids, ...filteredMembers.map((member) => member.id)])] })} className="text-xs font-semibold text-primary underline">Select all matching</button></div></div>
          </div> : null}

          <div className="overflow-hidden rounded-2xl border">
            <div className="flex items-center justify-between gap-3 border-b bg-slate-50 px-4 py-3"><div className="text-xs text-slate-600">{filteredMembers.length ? `Showing ${(page - 1) * PAGE_SIZE + 1}-${Math.min(page * PAGE_SIZE, filteredMembers.length)} of ${filteredMembers.length}` : "No matching active members"}</div>{selectedMemberCount ? <button type="button" onClick={() => updateCriteria({ ...criteria, member_ids: [] })} className="text-xs font-semibold text-primary underline">Clear selected ({selectedMemberCount})</button> : null}</div>
            <div className="divide-y">{shownMembers.map((member) => <label key={member.id} className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3 hover:bg-slate-50"><span className="min-w-0"><span className="block truncate text-sm font-semibold">{member.name}</span><span className="block truncate text-xs text-slate-500">{member.email}</span></span><input aria-label={`Select ${member.name}`} type="checkbox" checked={criteria.member_ids.includes(member.id)} onChange={() => updateCriteria({ ...criteria, member_ids: toggle(criteria.member_ids, member.id) })} /></label>)}</div>
            {pageCount > 1 ? <div className="flex items-center justify-between border-t px-4 py-3"><button type="button" disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-xl border px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 disabled:opacity-40">Previous</button><span className="text-xs text-slate-600">Page {page} of {pageCount}</span><button type="button" disabled={page === pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))} className="rounded-xl border px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 disabled:opacity-40">Next</button></div> : null}
          </div>

          {review ? <div className="rounded-3xl border border-primary/25 bg-primary/5 p-4 sm:p-5">
            <div className="font-semibold">{review.total_recipients} unique recipient{review.total_recipients === 1 ? "" : "s"} ready</div>
            <div className="mt-1 text-xs text-slate-600">{review.duplicate_count} duplicate{review.duplicate_count === 1 ? "" : "s"} removed · {review.invalid_count} invalid · {review.unsubscribed_count} unsubscribed · {review.suppressed_count} delivery-suppressed</div>
            <div className="mt-3 flex max-h-52 flex-wrap gap-2 overflow-y-auto">{review.recipients.map((recipient) => <button type="button" title="Remove this recipient" key={recipient.id} onClick={() => removeRecipient(recipient.email)} className="rounded-full border bg-white px-3 py-1.5 text-xs hover:border-red-300 hover:text-red-700">{recipient.email} <span aria-hidden>×</span></button>)}</div>
            {review.recipients_truncated ? <div className="mt-2 text-xs text-slate-600">Showing the first 1,000 recipients. All validated recipients remain included.</div> : null}
            {Object.entries(review.source_counts).some(([, count]) => count > 0) ? <div className="mt-3 flex flex-wrap gap-2">{Object.entries(review.source_counts).filter(([, count]) => count > 0).map(([source, count]) => <span key={source} className="rounded-full bg-white px-3 py-1 text-xs text-primary">{sourceNames[source] ?? source}: {count}</span>)}</div> : null}
          </div> : null}
        </> : null}
      </div>

      <div className="flex flex-col-reverse gap-2 border-t px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
        {value && onContinue ? <button type="button" onClick={onContinue} className="rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary/85">Continue to preview</button> : null}
      </div>
    </div>

    {advancedOpen && options ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-3 sm:p-6" onMouseDown={() => setAdvancedOpen(false)}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4 sm:px-6"><div><div className="text-lg font-semibold">More recipient options</div><div className="text-sm text-slate-600">Add groups, departments, form respondents, or additional email addresses.</div></div><button type="button" onClick={() => setAdvancedOpen(false)} className="rounded-xl border px-3 py-1.5 text-sm hover:bg-slate-50">Close</button></div>
        <div className="space-y-4 overflow-y-auto px-5 py-5 sm:px-6">
          <details className="rounded-2xl border p-4"><summary className="cursor-pointer font-semibold">Community groups <span className="ml-1 text-sm font-normal text-slate-500">({criteria.group_ids.length})</span></summary><div className="mt-4"><ChoiceList items={options.groups} selected={criteria.group_ids} onToggle={(id) => updateCriteria({ ...criteria, group_ids: toggle(criteria.group_ids, id) })} empty="No active community groups." /></div></details>
          <details className="rounded-2xl border p-4"><summary className="cursor-pointer font-semibold">Worker departments <span className="ml-1 text-sm font-normal text-slate-500">({criteria.department_ids.length})</span></summary><div className="mt-4"><ChoiceList items={options.departments} selected={criteria.department_ids} onToggle={(id) => updateCriteria({ ...criteria, department_ids: toggle(criteria.department_ids, id) })} empty="No active worker departments." /></div></details>
          <details className="rounded-2xl border p-4"><summary className="cursor-pointer font-semibold">Form respondents <span className="ml-1 text-sm font-normal text-slate-500">({criteria.form_sources.length})</span></summary><div className="mt-2 text-xs text-slate-600">Respondents remain form responses. They are not saved to People.</div><div className="mt-4 space-y-3">{options.forms.map((form) => { const selected = selectedForms.get(form.id); return <div key={form.id} className="rounded-2xl border p-4"><label className="flex cursor-pointer items-center gap-3"><input type="checkbox" checked={!!selected} onChange={(event) => updateForm(form, event.target.checked)} /><span className="font-semibold">{form.title}</span><span className="text-xs capitalize text-slate-500">{form.status}</span></label>{selected ? <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-600">Email answer field<select className="mt-1 w-full rounded-2xl border px-3 py-2 text-sm font-normal text-slate-900" value={selected.field_key} onChange={(event) => patchForm(form.id, { field_key: event.target.value })}>{form.fields.map((field) => <option key={field.field_key} value={field.field_key}>{field.label} · {field.field_type === "email" ? "Email (recommended)" : field.field_type === "short_text" ? "Short Answer" : "Paragraph"}</option>)}</select></label><label className="flex items-center gap-2 self-end rounded-2xl bg-slate-50 px-4 py-2.5 text-sm"><input type="checkbox" checked={selected.statuses.includes("archived")} onChange={(event) => patchForm(form.id, { statuses: event.target.checked ? ["new", "reviewed", "archived"] : ["new", "reviewed"] })} />Include archived responses</label></div> : null}</div>; })}</div></details>
          <details className="rounded-2xl border p-4"><summary className="cursor-pointer font-semibold">Additional email addresses <span className="ml-1 text-sm font-normal text-slate-500">({manualEmailCount})</span></summary><div className="mt-4"><textarea className="min-h-28 w-full rounded-2xl border px-4 py-3 text-sm" placeholder="name@example.com; another@example.com" value={criteria.manual_text} onChange={(event) => updateCriteria({ ...criteria, manual_text: event.target.value })} /><div className="mt-1 text-xs text-slate-500">Paste up to 100 addresses separated by commas, semicolons, spaces, or new lines.</div></div></details>
        </div>
        <div className="flex justify-end border-t px-5 py-4 sm:px-6"><button type="button" onClick={() => setAdvancedOpen(false)} className="rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary/85">Save options</button></div>
      </div>
    </div> : null}
  </>;
});
