import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { CurrentFormField, ResponseSubmission } from "@/lib/server/forms/responseAnalytics";
import { localDateStartIso, nextLocalDate } from "@/lib/server/forms/timezone";

export type SubmissionFilters = {
  status: "all" | "new" | "reviewed" | "archived";
  search: string;
  from: string;
  to: string;
};

const ANALYTICS_COLUMNS = "id,form_revision,status,form_snapshot,answers,submitted_at,source_type,source_label,person_action";

export function parseSubmissionFilters(url: URL): SubmissionFilters {
  const status = url.searchParams.get("status") ?? "all";
  if (!["all", "new", "reviewed", "archived"].includes(status)) throw new Error("Invalid inbox filter");
  const search = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  if (search.length > 120) throw new Error("Search is too long");
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error("Invalid start date");
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error("Invalid end date");
  if (from && to && from > to) throw new Error("Start date must be on or before end date");
  return { status: status as SubmissionFilters["status"], search, from, to };
}

function searchableSubmission(row: ResponseSubmission) {
  return [row.form_snapshot, row.answers, row.source_label, row.person_action]
    .map((value) => typeof value === "string" ? value : JSON.stringify(value ?? ""))
    .join(" ")
    .toLowerCase();
}

export async function fetchFilteredSubmissions(formId: string, organizationId: string, filters: SubmissionFilters, timezone = "UTC") {
  const all: ResponseSubmission[] = [];
  for (let offset = 0; ; offset += 1000) {
    let query = supabaseAdmin.from("form_submissions")
      .select(ANALYTICS_COLUMNS)
      .eq("form_id", formId)
      .eq("org_id", organizationId)
      .order("submitted_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + 999);
    if (filters.status !== "all") query = query.eq("status", filters.status);
    if (filters.from) query = query.gte("submitted_at", localDateStartIso(filters.from, timezone));
    if (filters.to) query = query.lt("submitted_at", localDateStartIso(nextLocalDate(filters.to), timezone));
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as ResponseSubmission[];
    all.push(...batch);
    if (batch.length < 1000) break;
  }
  return filters.search ? all.filter((row) => searchableSubmission(row).includes(filters.search)) : all;
}

export async function fetchCurrentFormFields(formId: string, organizationId: string) {
  const { data, error } = await supabaseAdmin.from("form_fields")
    .select("field_key,label,field_type,position")
    .eq("form_id", formId)
    .eq("org_id", organizationId)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((field) => ({
    key: String(field.field_key),
    label: String(field.label),
    type: String(field.field_type),
    position: Number(field.position),
  })) satisfies CurrentFormField[];
}
