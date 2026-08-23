"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import {
  suggestPersonFieldMapping,
  type MappingSuggestion,
} from "@/lib/forms/fieldMappingSuggestions";
import { validatePersonFieldMapping } from "@/lib/forms/personFieldValidation";
import { parseMonthDay } from "@/lib/people/birthDate";

type SnapshotField = { key: string; label: string; type: string; options?: string[] };
type Submission = {
  id: string;
  form_snapshot: { fields?: SnapshotField[] };
  answers: Record<string, string | string[]>;
};
type Mapping = { field_key: string; target_type: "standard" | "custom"; standard_key: string | null; custom_field_id: string | null };
type CustomField = { id: string; name: string; field_type: string; options: string[]; status: string };
type Candidate = Record<string, unknown> & {
  id: string; first_name: string; last_name: string; membership_stage: string; status: string;
  visitor_details?: Array<Record<string, unknown>> | Record<string, unknown> | null;
  person_custom_field_values?: Array<{ custom_field_id: string; value: unknown }>;
};
type LoadPayload = {
  role: "owner" | "admin" | "finance";
  mappings: Mapping[];
  custom_fields: CustomField[];
  candidates: Candidate[];
  error?: string;
};

const STANDARD_FIELDS = [
  ["first_name", "First name"], ["last_name", "Last name"], ["gender", "Gender"],
  ["age_group", "Age group"], ["email", "Email"], ["phone", "Phone"],
  ["address", "Address"], ["marital_status", "Marital status"],
  ["children_count", "Number of children"], ["joined_at", "Joined date"],
  ["dob", "Date of birth"], ["notes", "Notes"], ["baptized", "Baptized"],
  ["baptism_date", "Baptism date"], ["born_again", "Born again"],
  ["born_again_date", "Born again date"], ["first_visit_at", "First visit"],
  ["how_heard", "How they heard about us"], ["prayer_requests", "Prayer requests"],
] as const;
const PROTECTED = new Set(["first_name", "last_name", "gender", "age_group"]);

function answerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value : value ?? "";
}
function answerText(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.join(", ") : value ?? "";
}
async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) throw new Error("Your session has expired. Please sign in again.");
  return { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" };
}

export default function SaveSubmissionToPeopleModal({
  formId, submission, onClose, onSaved,
}: {
  formId: string; submission: Submission; onClose: () => void; onSaved: () => void;
}) {
  const fields = useMemo(() => submission.form_snapshot.fields ?? [], [submission]);
  const [payload, setPayload] = useState<LoadPayload | null>(null);
  const [action, setAction] = useState<"create_person" | "update_person">("update_person");
  const [saveAsFirstTimer, setSaveAsFirstTimer] = useState(false);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [suggestions, setSuggestions] = useState<Record<string, MappingSuggestion & { saved?: boolean }>>({});
  const [manual, setManual] = useState<Record<string, string>>({});
  const [chosenStandard, setChosenStandard] = useState<Set<string>>(new Set());
  const [chosenCustom, setChosenCustom] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/forms/${formId}/submissions/${submission.id}/people`, { headers: await authHeaders(), cache: "no-store" });
        const body = await response.json() as LoadPayload;
        if (!response.ok) throw new Error(body.error || "Unable to load person fields.");
        if (cancelled) return;
        setPayload(body);
        const saved = new Map(body.mappings.map((item) => [item.field_key, item]));
        const initial: Record<string, string> = {};
        const initialManual: Record<string, string> = {};
        const initialSuggestions: Record<string, MappingSuggestion & { saved?: boolean }> = {};
        fields.forEach((field) => {
          const mapping = saved.get(field.key);
          const suggestion = suggestPersonFieldMapping(field, submission.answers[field.key], body.custom_fields);
          if (mapping) {
            const target = mapping.target_type === "custom" ? `custom:${mapping.custom_field_id}` : `standard:${mapping.standard_key}`;
            const customLabel = body.custom_fields.find((item) => item.id === mapping.custom_field_id)?.name;
            const standardLabel = STANDARD_FIELDS.find(([key]) => key === mapping.standard_key)?.[1];
            initial[field.key] = target;
            initialSuggestions[field.key] = { target, label: customLabel ?? standardLabel ?? field.label, confidence: "high", reason: "Saved mapping from an earlier response", saved: true };
          } else {
            initial[field.key] = suggestion.confidence === "high" ? suggestion.target : "custom:new";
            initialSuggestions[field.key] = suggestion;
          }
          const standard = initial[field.key].startsWith("standard:") ? initial[field.key].slice(9) : null;
          if (standard && PROTECTED.has(standard)) initialManual[standard] = answerText(submission.answers[field.key]);
        });
        setTargets(initial);
        setSuggestions(initialSuggestions);
        setManual(initialManual);
        setChosenStandard(new Set());
        setChosenCustom(new Set());
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load person fields."); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [fields, formId, submission]);

  useEffect(() => {
    if (action !== "update_person" || search.trim().length < 2) return;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/forms/${formId}/submissions/${submission.id}/people?q=${encodeURIComponent(search.trim())}`, { headers: await authHeaders(), cache: "no-store" });
        const body = await response.json() as LoadPayload;
        if (!response.ok) throw new Error(body.error || "Unable to search People.");
        setPayload((current) => current ? { ...current, candidates: body.candidates } : body);
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to search People."); }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [action, formId, search, submission.id]);

  const validations = Object.fromEntries(fields.map((field) => [
    field.key,
    validatePersonFieldMapping(targets[field.key] ?? "ignore", submission.answers[field.key], payload?.custom_fields ?? []),
  ]));
  const standardRows = fields.flatMap((field) => {
    const target = targets[field.key] ?? "ignore";
    return target.startsWith("standard:") && validations[field.key].valid ? [{ field, key: target.slice(9), value: answerValue(submission.answers[field.key]) }] : [];
  });
  const customRows = fields.filter((field) => (targets[field.key] ?? "").startsWith("custom:") && validations[field.key].valid);
  const mappedRequiredValues = Object.fromEntries(standardRows.filter((row) => PROTECTED.has(row.key)).map((row) => [row.key, answerText(submission.answers[row.field.key])]));
  const mappedDob = standardRows.find((row) => row.key === "dob");
  const dobText = mappedDob ? answerText(submission.answers[mappedDob.field.key]).trim() : "";
  const hasFullDob = /^\d{4}-\d{2}-\d{2}$/.test(dobText);
  const hasBirthday = hasFullDob || parseMonthDay(dobText) !== null;
  const requiredKeys = ["first_name", "last_name", "gender"];
  const ageGroupValue = (manual.age_group ?? mappedRequiredValues.age_group ?? "").trim();
  if (!hasBirthday && !["1-12", "13-17", "18-35", "36+"].includes(ageGroupValue)) {
    requiredKeys.push("age_group");
  }
  const missingRequired = requiredKeys.filter((key) => {
    const value = (manual[key] ?? mappedRequiredValues[key] ?? "").trim();
    if (key === "gender") return !["male", "female"].includes(value.toLowerCase());
    if (key === "age_group") return !["1-12", "13-17", "18-35", "36+"].includes(value);
    return !value;
  });

  function existingValue(target: string) {
    if (!candidate || target === "ignore" || target === "custom:new") return null;
    if (target.startsWith("custom:")) {
      const fieldId = target.slice(7);
      return candidate.person_custom_field_values?.find((item) => item.custom_field_id === fieldId)?.value ?? null;
    }
    const key = target.slice(9);
    if (["first_visit_at", "how_heard", "prayer_requests"].includes(key)) {
      const details = Array.isArray(candidate.visitor_details) ? candidate.visitor_details[0] : candidate.visitor_details;
      const detailKey = key === "prayer_requests" ? "prayer_request_tags" : key;
      return details?.[detailKey] ?? null;
    }
    return candidate[key] ?? null;
  }

  function displayValue(value: unknown) {
    if (value === null || value === undefined || value === "") return "Not set";
    if (Array.isArray(value)) return value.length ? value.join(", ") : "Not set";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    return String(value);
  }

  function candidateTypeLabel(item: Candidate) {
    if (item.membership_stage === "member") return "Member";
    if (item.membership_stage === "visitor") return "First-timer";
    return "Visitor";
  }

  function switchAction(next: typeof action) {
    setAction(next); setCandidate(null); setError("");
    if (next === "update_person") { setChosenStandard(new Set()); setChosenCustom(new Set()); }
    else {
      setChosenStandard(new Set(standardRows.map((row) => row.key)));
      setChosenCustom(new Set(customRows.map((field) => field.key)));
    }
  }

  async function save() {
    setSaving(true); setError("");
    try {
      if (action === "update_person" && !candidate) throw new Error("Choose the existing person to update.");
      if (fields.some((field) => !validations[field.key].valid)) throw new Error("Fix the incompatible field mappings before saving.");
      if (action === "create_person" && missingRequired.length) throw new Error("Add the missing required person details before saving.");
      const standardValues: Record<string, string | string[]> = {};
      const standardMappings: Record<string, string> = {};
      for (const row of standardRows) {
        if (action !== "update_person" || chosenStandard.has(row.key)) standardValues[row.key] = row.value;
        standardMappings[row.key] = row.field.key;
      }
      for (const key of PROTECTED) {
        if (action !== "update_person") standardValues[key] = manual[key] ?? standardValues[key] ?? "";
      }
      const customValues = customRows.filter((field) => action !== "update_person" || chosenCustom.has(field.key)).map((field) => {
        const target = targets[field.key];
        const fieldId = target === "custom:new" ? null : target.slice(7);
        const existing = payload?.custom_fields.find((item) => item.id === fieldId);
        return {
          field_id: fieldId,
          name: existing?.name ?? field.label,
          field_type: existing?.field_type ?? field.type,
          options: existing?.options ?? field.options ?? [],
          value: answerValue(submission.answers[field.key]),
          source_field_key: field.key,
        };
      });
      const response = await fetch(`/api/forms/${formId}/submissions/${submission.id}/people`, {
        method: "POST", headers: await authHeaders(),
        body: JSON.stringify({ action: action === "update_person" ? action : saveAsFirstTimer ? "create_visitor" : "create_member", target_member_id: candidate?.id ?? null, standard_values: standardValues, standard_mappings: standardMappings, custom_values: customValues }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error || "Unable to save this response to People.");
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save this response to People."); }
    finally { setSaving(false); }
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Save submission to People">
    <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
      <div className="flex items-start justify-between border-b px-5 py-4 sm:px-7">
        <div><h2 className="text-lg font-semibold">Save to People</h2><p className="mt-1 text-sm text-slate-600">Map this response, then create or carefully update one person record.</p></div>
        <button type="button" onClick={onClose} className="rounded-xl border px-3 py-1.5 text-sm font-semibold hover:bg-slate-50">Close</button>
      </div>
      <div className="overflow-y-auto px-5 py-5 sm:px-7">
        {error ? <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}
        {loading ? <div className="py-10 text-center text-sm text-slate-500">Loading person fields…</div> : <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-[max-content_minmax(0,1fr)] sm:items-center sm:gap-5">
            <label className="text-sm font-semibold text-slate-800">What would you like to do?</label>
            <select value={action} onChange={(event) => switchAction(event.target.value as typeof action)} className="w-full rounded-xl border bg-white px-3 py-2.5 text-sm">
              <option value="update_person">Update existing person</option>
              <option value="create_person">Create new person</option>
            </select>
            {action === "create_person" ? <label className="flex w-full items-start gap-3 rounded-2xl border bg-slate-50 p-3 text-sm sm:col-span-2">
              <input type="checkbox" checked={saveAsFirstTimer} onChange={(event) => setSaveAsFirstTimer(event.target.checked)} className="mt-0.5" />
              <span><span className="block font-semibold text-slate-800">Save this person in First Timers</span><span className="mt-0.5 block text-slate-600">Otherwise, the person will be created as a member. First Timers created here will not receive automatic follow-up emails.</span></span>
            </label> : null}
          </div>

          {action === "update_person" ? <section className="rounded-2xl border bg-slate-50 p-4">
            <label className="text-sm font-semibold">Find the existing person</label>
            <input value={search} onChange={(event) => { setSearch(event.target.value); setCandidate(null); }} placeholder="Search name, email, or phone" className="mt-2 w-full rounded-xl border bg-white px-3 py-2 text-sm" />
            {search.trim().length >= 2 ? <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border bg-white">
              {(payload?.candidates ?? []).map((item, index) => <button key={item.id} type="button" onClick={() => setCandidate(item)} className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm ${index ? "border-t border-slate-200" : ""} ${candidate?.id === item.id ? "bg-blue-50" : "hover:bg-slate-50"}`}><span><b>{item.first_name} {item.last_name}</b><span className="ml-2 text-xs text-slate-500">{candidateTypeLabel(item)}</span></span><span className="text-xs capitalize text-slate-500">{item.status}</span></button>)}
              {(payload?.candidates ?? []).length === 0 ? <div className="px-2 py-3 text-sm text-slate-500">No matching active or archived people.</div> : null}
            </div> : null}
          </section> : null}

          <section>
            <h3 className="font-semibold">Review submitted fields</h3>
            <p className="mt-1 text-sm text-slate-600">Choose where each answer belongs. Saved mappings are reused for future responses, but Church Admin never guesses which person submitted a form.</p>
            <div className="mt-3 space-y-2">
              {fields.map((field) => {
                const target = targets[field.key] ?? "ignore";
                const validation = validations[field.key];
                const standardKey = target.startsWith("standard:") ? target.slice(9) : null;
                const isCustom = target.startsWith("custom:");
                const locked = action === "update_person" && payload?.role === "finance" && standardKey !== null && PROTECTED.has(standardKey);
                const checked = standardKey !== null ? chosenStandard.has(standardKey) : isCustom ? chosenCustom.has(field.key) : false;
                const toggleApply = (enabled: boolean) => {
                  if (standardKey !== null) setChosenStandard((old) => { const next = new Set(old); if (enabled) next.add(standardKey); else next.delete(standardKey); return next; });
                  else if (isCustom) setChosenCustom((old) => { const next = new Set(old); if (enabled) next.add(field.key); else next.delete(field.key); return next; });
                };
                return <div key={field.key} className={`rounded-2xl border p-4 ${validation.valid ? "" : "border-rose-300 bg-rose-50/40"}`}>
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(14rem,1fr)]">
                  <div><div className="text-xs font-semibold text-slate-500">Submitted answer</div><div className="mt-1 font-semibold text-slate-900">{field.label}</div><div className="mt-1 break-words text-sm text-slate-700">{answerText(submission.answers[field.key]) || "No answer"}</div></div>
                  <div><label className="text-xs font-semibold text-slate-500">Save as</label><select value={target} onChange={(event) => setTargets((current) => ({ ...current, [field.key]: event.target.value }))} className={`mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm ${validation.valid ? "" : "border-rose-400 ring-1 ring-rose-200"}`}>
                  <option value="ignore">Do not save</option>
                  <optgroup label="Standard person fields">{STANDARD_FIELDS.map(([key,label]) => <option key={key} value={`standard:${key}`}>{label}</option>)}</optgroup>
                  <optgroup label="Custom fields"><option value="custom:new">New custom field: {field.label}</option>{payload?.custom_fields.map((item) => <option key={item.id} value={`custom:${item.id}`}>{item.name}</option>)}</optgroup>
                </select>{suggestions[field.key]?.saved ? <div className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-emerald-700"><span className="inline-flex size-4 items-center justify-center rounded-full bg-emerald-600 text-[10px] text-white">✓</span>Saved mapping</div> : suggestions[field.key]?.confidence === "high" ? <div className="mt-1.5 text-xs text-blue-700"><span className="font-semibold">Suggested:</span> {suggestions[field.key].label} · {suggestions[field.key].reason}</div> : suggestions[field.key]?.confidence === "medium" ? <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-amber-700"><span><b>Possible match:</b> {suggestions[field.key].label} · {suggestions[field.key].reason}</span><button type="button" onClick={() => setTargets((current) => ({ ...current, [field.key]: suggestions[field.key].target }))} className="font-semibold underline">Use suggestion</button></div> : <div className="mt-1.5 text-xs text-slate-500">No reliable standard match. It will be kept as a custom field.</div>}{!validation.valid ? <div className="mt-2 flex items-start gap-2 text-xs font-semibold text-rose-700"><span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-rose-600 text-[10px] text-white">×</span><span>{validation.message}</span></div> : null}</div>
                </div>
                {action === "update_person" ? <div className="mt-3 flex flex-col gap-2 rounded-xl bg-slate-50 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm"><span className="font-semibold text-slate-600">Existing value:</span> <span className="text-slate-800">{candidate ? displayValue(existingValue(target)) : "Choose a person first"}</span></div>
                  {target !== "ignore" ? <label className={`flex items-center gap-2 text-sm font-semibold ${locked || !validation.valid ? "text-slate-400" : "text-slate-700"}`}><input type="checkbox" checked={checked && validation.valid} disabled={!candidate || locked || !validation.valid} onChange={(event) => toggleApply(event.target.checked)} />Apply submitted value</label> : <span className="text-xs text-slate-500">This answer will not be saved.</span>}
                  {locked ? <div className="basis-full text-xs text-slate-500 sm:text-right">Finance can view but cannot change identity fields.</div> : null}
                </div> : <div className={`mt-3 flex items-center gap-2 text-sm font-medium ${!validation.valid ? "text-rose-700" : target === "ignore" ? "text-slate-500" : "text-emerald-700"}`}>
                  {!validation.valid ? <><span className="inline-flex size-5 items-center justify-center rounded-full bg-rose-600 text-xs text-white">×</span><span>Choose a compatible field before saving.</span></> : target === "ignore" ? <span>This answer will not be saved.</span> : <><span className="inline-flex size-5 items-center justify-center rounded-full bg-emerald-600 text-xs text-white">✓</span><span>Will be saved</span></>}
                </div>}
              </div>})}
            </div>
          </section>

          {action !== "update_person" && missingRequired.length ? <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <h3 className="font-semibold text-amber-950">Missing required details</h3><p className="mt-1 text-sm text-amber-800">Add only the details that could not be filled reliably from this response.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {missingRequired.includes("first_name") ? <label className="text-sm font-semibold">First name<input value={manual.first_name ?? ""} onChange={(e) => setManual((v) => ({...v,first_name:e.target.value}))} className="mt-1 w-full rounded-xl border bg-white px-3 py-2 font-normal" /></label> : null}
              {missingRequired.includes("last_name") ? <label className="text-sm font-semibold">Last name<input value={manual.last_name ?? ""} onChange={(e) => setManual((v) => ({...v,last_name:e.target.value}))} className="mt-1 w-full rounded-xl border bg-white px-3 py-2 font-normal" /></label> : null}
              {missingRequired.includes("gender") ? <label className="text-sm font-semibold">Gender<select value={manual.gender?.toLowerCase() ?? ""} onChange={(e) => setManual((v) => ({...v,gender:e.target.value}))} className="mt-1 w-full rounded-xl border bg-white px-3 py-2 font-normal"><option value="">Choose…</option><option value="male">Male</option><option value="female">Female</option></select></label> : null}
              {missingRequired.includes("age_group") ? <label className="text-sm font-semibold">Age group<select value={manual.age_group ?? ""} onChange={(e) => setManual((v) => ({...v,age_group:e.target.value}))} className="mt-1 w-full rounded-xl border bg-white px-3 py-2 font-normal"><option value="">Choose…</option>{["1-12","13-17","18-35","36+"].map((v)=><option key={v}>{v}</option>)}</select></label> : null}
            </div>
          </section> : null}
        </div>}
      </div>
      <div className="flex justify-end gap-2 border-t bg-slate-50 px-5 py-4 sm:px-7"><button type="button" onClick={onClose} className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold">Cancel</button><button type="button" disabled={loading || saving || fields.some((field) => !validations[field.key]?.valid) || (action === "update_person" && !candidate) || (action === "create_person" && missingRequired.length > 0)} onClick={() => void save()} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : action === "update_person" ? "Apply selected changes" : saveAsFirstTimer ? "Create first-timer" : "Create member"}</button></div>
    </div>
  </div>;
}
