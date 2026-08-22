import { randomUUID } from "node:crypto";
import { appendNikkyAudit } from "@/lib/server/nikky/audit";
import { assertDateRange, assertIsoDate, enforceFinanceWindow } from "@/lib/server/nikky/dates";
import type { NikkyContext, NikkyToolResult } from "@/lib/server/nikky/types";

export type NikkyToolDefinition = {
  type: "function";
  name: string;
  description: string;
  strict: true;
  parameters: Record<string, unknown>;
};

const dateRangeProperties = {
  start_date: { type: "string", description: "Exact inclusive YYYY-MM-DD start date." },
  end_date: { type: "string", description: "Exact inclusive YYYY-MM-DD end date." },
};

const ageGroups = ["1-12", "13-17", "18-35", "36+"] as const;
const segments = ["boys", "girls", "men", "women"] as const;
const genders = ["male", "female"] as const;
const demographicGroupings = ["none", "age_group", "segment", "gender"] as const;
const attendanceBreakdownIntervals = ["month", "session"] as const;
const givingGroupings = [...demographicGroupings, "category", "service", "method"] as const;

const demographicProperties = {
  ...dateRangeProperties,
  age_groups: { type: ["array", "null"], items: { type: "string", enum: ageGroups }, maxItems: ageGroups.length },
  segments: { type: ["array", "null"], items: { type: "string", enum: segments }, maxItems: segments.length },
  genders: { type: ["array", "null"], items: { type: "string", enum: genders }, maxItems: genders.length },
  group_by: { type: "string", enum: demographicGroupings },
};

const givingDemographicProperties = {
  ...demographicProperties,
  group_by: { type: "string", enum: givingGroupings },
};

function objectSchema(
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) {
  return { type: "object", properties, required, additionalProperties: false };
}

const baseTools: NikkyToolDefinition[] = [
  {
    type: "function",
    name: "financial_summary",
    description: "Return aggregate income, expense, and net totals for an exact date range.",
    strict: true,
    parameters: objectSchema(dateRangeProperties),
  },
  {
    type: "function",
    name: "compare_financial_periods",
    description: "Compare aggregate income, expenses, and net income across two exact periods.",
    strict: true,
    parameters: objectSchema({
      period_a_start: { type: "string" }, period_a_end: { type: "string" },
      period_b_start: { type: "string" }, period_b_end: { type: "string" },
    }),
  },
  {
    type: "function",
    name: "income_breakdown",
    description: "Return aggregate income grouped by category, service, method, or date.",
    strict: true,
    parameters: objectSchema({
      ...dateRangeProperties,
      group_by: { type: "string", enum: ["category", "service", "method", "date"] },
    }),
  },
  {
    type: "function",
    name: "income_monthly_breakdown",
    description: "Return monthly giving totals plus a zero-filled month-by-category, month-by-service, or month-by-payment-method matrix for an exact date range. Use this to identify the highest giving month and explain its categories, or compare giving methods by month.",
    strict: true,
    parameters: objectSchema({
      ...dateRangeProperties,
      group_by: { type: "string", enum: ["total", "category", "service", "method"] },
    }),
  },
  {
    type: "function",
    name: "expense_breakdown",
    description: "Return aggregate expenses grouped by category, vendor, method, or date.",
    strict: true,
    parameters: objectSchema({
      ...dateRangeProperties,
      group_by: { type: "string", enum: ["category", "vendor", "method", "date"] },
    }),
  },
  {
    type: "function",
    name: "giving_demographic_summary",
    description: "Return aggregate giving totals filtered or grouped by current canonical member age group, segment, or gender. Never returns member identities. Finance requests must be entirely inside the finance window.",
    strict: true,
    parameters: objectSchema(givingDemographicProperties),
  },
  {
    type: "function",
    name: "search_members",
    description: "Find up to ten current canonical active or archived members by name. Merged tombstones are excluded.",
    strict: true,
    parameters: objectSchema({ query: { type: "string", minLength: 2, maxLength: 100 } }),
  },
  {
    type: "function",
    name: "member_profile",
    description: "Return structured non-financial profile information for one canonical member. Free-text notes are excluded.",
    strict: true,
    parameters: objectSchema({ member_id: { type: "string", format: "uuid" } }),
  },
  {
    type: "function",
    name: "member_milestone_summary",
    description: "Return current canonical member counts plus new-member, new-convert, and baptism counts for an exact date range. New members use joined_at, converts use born_again_date, and baptisms use baptism_date. Merged tombstones are excluded.",
    strict: true,
    parameters: objectSchema(dateRangeProperties),
  },
  {
    type: "function",
    name: "member_population_summary",
    description: "Return the current canonical member population broken down by active/archive status, age group, segment, gender, and department. Merged tombstones and visitors are excluded.",
    strict: true,
    parameters: objectSchema({}),
  },
  {
    type: "function",
    name: "attendance_summary",
    description: "Return published attendance totals and session counts for an exact date range.",
    strict: true,
    parameters: objectSchema(dateRangeProperties),
  },
  {
    type: "function",
    name: "attendance_trends",
    description: "Return published attendance totals grouped by session date for an exact range.",
    strict: true,
    parameters: objectSchema(dateRangeProperties),
  },
  {
    type: "function",
    name: "attendance_monthly_summary",
    description: "Return zero-filled published attendance totals, session counts, and averages for every calendar month in an exact range. Use this to identify or compare the highest-attendance month.",
    strict: true,
    parameters: objectSchema(dateRangeProperties),
  },
  {
    type: "function",
    name: "attendance_demographic_summary",
    description: "Return aggregate published attendance filtered or grouped by the age group, segment, or gender snapshots recorded on attendance entries.",
    strict: true,
    parameters: objectSchema(demographicProperties),
  },
  {
    type: "function",
    name: "attendance_demographic_breakdown",
    description: "Return published demographic attendance broken down by calendar month or by individual published session. Use this for month-by-month comparisons such as boys versus girls, or a per-date/per-service demographic breakdown. Zero-count groups are included.",
    strict: true,
    parameters: objectSchema({
      ...demographicProperties,
      interval: { type: "string", enum: attendanceBreakdownIntervals },
    }),
  },
  {
    type: "function",
    name: "member_attendance_history",
    description: "Return published attendance history for one canonical member and exact range.",
    strict: true,
    parameters: objectSchema({ member_id: { type: "string", format: "uuid" }, ...dateRangeProperties }),
  },
  {
    type: "function",
    name: "members_attendance_history",
    description: "Return published attendance history for between one and ten canonical members over an exact range. Use this for a named group or all candidates from a member search.",
    strict: true,
    parameters: objectSchema({
      member_ids: {
        type: "array",
        items: { type: "string", format: "uuid" },
        minItems: 1,
        maxItems: 10,
      },
      ...dateRangeProperties,
    }),
  },
  {
    type: "function",
    name: "absent_members",
    description: "Identify active members absent from one published member-only session. Mixed and headcount sessions are rejected.",
    strict: true,
    parameters: objectSchema({ session_id: { type: "string", format: "uuid" } }),
  },
  {
    type: "function",
    name: "visitor_list",
    description: "Return structured visitor or first-timer records for an exact first-visit range. Notes and prayer requests are excluded.",
    strict: true,
    parameters: objectSchema(dateRangeProperties),
  },
  {
    type: "function",
    name: "followup_queue",
    description: "Return overdue or upcoming scheduled follow-ups without message bodies.",
    strict: true,
    parameters: objectSchema({
      timing: { type: "string", enum: ["overdue", "upcoming"] },
      through_date: { type: "string", description: "Exact YYYY-MM-DD boundary." },
    }),
  },
  {
    type: "function",
    name: "followup_history",
    description: "Return sent/scheduled follow-up metadata for one member. Message subjects and bodies are excluded.",
    strict: true,
    parameters: objectSchema({ member_id: { type: "string", format: "uuid" } }),
  },
  {
    type: "function",
    name: "upcoming_schedules",
    description: "Return approved and pending schedule assignments in an exact date range, without notes.",
    strict: true,
    parameters: objectSchema(dateRangeProperties),
  },
  {
    type: "function",
    name: "schedule_assignments",
    description: "Search schedule assignments by exact date range and optional assignee name.",
    strict: true,
    parameters: objectSchema({
      ...dateRangeProperties,
      assignee_name: { type: ["string", "null"], maxLength: 100 },
    }),
  },
  {
    type: "function",
    name: "schedule_coverage_gaps",
    description: "Compare configured required schedule slots with approved and pending assignments.",
    strict: true,
    parameters: objectSchema(dateRangeProperties),
  },
];

const individualGivingTool: NikkyToolDefinition = {
  type: "function",
  name: "individual_giving",
  description: "Return giving totals and up to 100 giving rows for one canonical member. Owner/admin only.",
  strict: true,
  parameters: objectSchema({ member_id: { type: "string", format: "uuid" }, ...dateRangeProperties }),
};

const pageProperty = {
  page: { type: "integer", minimum: 1, maximum: 1000 },
};

const leadershipTools: NikkyToolDefinition[] = [
  {
    type: "function",
    name: "prepare_member_giving_report_selection",
    description: "Resolve one exact active income category and the canonical members with identifiable giving in an exact period, so a monthly Member Giving report can list each contributor. Owner/admin only. This prepares selection data; it does not generate or confirm a report.",
    strict: true,
    parameters: objectSchema({
      ...dateRangeProperties,
      category_name: { type: "string", minLength: 1, maxLength: 100 },
      include_archived: { type: "boolean" },
    }),
  },
  {
    type: "function",
    name: "sunday_member_checkins",
    description: "Classify active registered members as recorded present, recorded absent, or unknown for exact Sunday dates. Owner/admin only. Anonymous or incomplete Sundays never establish absence.",
    strict: true,
    parameters: objectSchema({
      sunday_dates: {
        type: "array",
        items: { type: "string", description: "Exact Sunday in YYYY-MM-DD format." },
        minItems: 1,
        maxItems: 12,
      },
      ...pageProperty,
    }),
  },
  {
    type: "function",
    name: "attendance_member_changes",
    description: "Identify active members whose per-service attendance rate declined between two exact periods using only entirely member-recorded sessions. Owner/admin only.",
    strict: true,
    parameters: objectSchema({
      baseline_start: { type: "string" },
      baseline_end: { type: "string" },
      current_start: { type: "string" },
      current_end: { type: "string" },
      ...pageProperty,
    }),
  },
  {
    type: "function",
    name: "attendance_inconsistency",
    description: "Identify active members with inconsistent per-service attendance over an exact period using only entirely member-recorded sessions. Owner/admin only.",
    strict: true,
    parameters: objectSchema({ ...dateRangeProperties, ...pageProperty }),
  },
  {
    type: "function",
    name: "attendance_pastoral_candidates",
    description: "Identify active members who may warrant a check-in based only on twelve consecutive entirely member-recorded sessions for a service. Owner/admin only.",
    strict: true,
    parameters: objectSchema({
      as_of_date: { type: "string", description: "Exact inclusive YYYY-MM-DD boundary." },
      ...pageProperty,
    }),
  },
  {
    type: "function",
    name: "regular_tithe_activity",
    description: "Identify regular Tithe givers with no recent identifiable Tithe or a conservative giving decline. Regular means Tithe activity in at least three distinct months during the preceding twelve months. Owner/admin only.",
    strict: true,
    parameters: objectSchema({
      analysis: { type: "string", enum: ["no_recent_tithe", "reduced_tithe"] },
      current_start: { type: "string" },
      current_end: { type: "string" },
      baseline_start: { type: ["string", "null"] },
      baseline_end: { type: ["string", "null"] },
      ...pageProperty,
    }),
  },
  {
    type: "function",
    name: "donor_giving_patterns",
    description: "Identify recurring donors with reduced giving, significant transaction-frequency changes, or no recent identifiable giving across exact equal periods. Owner/admin only.",
    strict: true,
    parameters: objectSchema({
      analysis: { type: "string", enum: ["reduced_amount", "frequency_change", "stopped_recurring"] },
      baseline_start: { type: "string" },
      baseline_end: { type: "string" },
      current_start: { type: "string" },
      current_end: { type: "string" },
      category_id: { type: ["string", "null"], format: "uuid" },
      ...pageProperty,
    }),
  },
];

const leadershipToolNames = new Set([
  "members_attendance_history",
  "absent_members",
  ...leadershipTools.map((tool) => tool.name),
  "individual_giving",
]);

export function canUseNikkyDataTool(context: Pick<NikkyContext, "role">, toolName: string) {
  return !(context.role === "finance" && leadershipToolNames.has(toolName));
}

export function dataToolDefinitions(context: NikkyContext) {
  if (context.role === "finance") {
    return baseTools.filter((tool) => canUseNikkyDataTool(context, tool.name));
  }
  return [...baseTools, individualGivingTool, ...leadershipTools];
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

type DemographicRow = { age_group?: unknown; segment?: unknown; gender?: unknown };
type DemographicFilters = {
  ageGroups: string[];
  segments: string[];
  genders: string[];
  groupBy: string;
};

function enumArray(value: unknown, allowed: readonly string[], field: string) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !allowed.includes(item))) {
    throw new Error(`Invalid ${field} filter.`);
  }
  return [...new Set(value as string[])];
}

function demographicFilters(args: Record<string, unknown>, allowedGroupings: readonly string[] = demographicGroupings): DemographicFilters {
  const groupBy = text(args.group_by);
  if (!allowedGroupings.includes(groupBy)) throw new Error("Invalid demographic grouping.");
  const filters = {
    ageGroups: enumArray(args.age_groups, ageGroups, "age group"),
    segments: enumArray(args.segments, segments, "segment"),
    genders: enumArray(args.genders, genders, "gender"),
    groupBy,
  };
  if (groupBy === "none" && !filters.ageGroups.length && !filters.segments.length && !filters.genders.length) {
    throw new Error("Choose at least one demographic filter or grouping.");
  }
  return filters;
}

function matchesDemographics(row: DemographicRow, filters: DemographicFilters) {
  return (!filters.ageGroups.length || filters.ageGroups.includes(String(row.age_group)))
    && (!filters.segments.length || filters.segments.includes(String(row.segment)))
    && (!filters.genders.length || filters.genders.includes(String(row.gender)));
}

function demographicApplied(startDate: string, endDate: string, filters: DemographicFilters) {
  return {
    start_date: startDate,
    end_date: endDate,
    age_groups: filters.ageGroups,
    segments: filters.segments,
    genders: filters.genders,
    group_by: filters.groupBy,
  };
}

export function filterMemberSearchMatches<
  T extends { first_name?: string | null; last_name?: string | null },
>(members: T[], query: string, limit = 10) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const normalizedTokens = normalizedQuery.split(/\s+/u).filter(Boolean);
  return members
    .filter((member) => {
      const fullName = `${member.first_name ?? ""} ${member.last_name ?? ""}`.toLocaleLowerCase();
      return normalizedTokens.every((token) => fullName.includes(token));
    })
    .sort((a, b) => {
      const aName = `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim().toLocaleLowerCase();
      const bName = `${b.first_name ?? ""} ${b.last_name ?? ""}`.trim().toLocaleLowerCase();
      return Number(bName === normalizedQuery) - Number(aName === normalizedQuery);
    })
    .slice(0, limit);
}

function evidence() {
  return randomUUID();
}

function safeAuditParameters(args: Record<string, unknown>) {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (key === "member_id" || key === "member_ids" || key === "query" || key === "assignee_name") continue;
    output[key] = value;
  }
  return output;
}

function result(
  outcome: NikkyToolResult["outcome"],
  applied: Record<string, unknown>,
  data: unknown,
  recordCount: number,
  message?: string,
): NikkyToolResult {
  const output: NikkyToolResult = {
    outcome,
    evidence_id: evidence(),
    applied,
    record_count: recordCount,
    data,
    message,
  };
  const serialized = JSON.stringify(output);
  if (Buffer.byteLength(serialized, "utf8") > 32 * 1024) {
    return {
      outcome: "unavailable",
      evidence_id: output.evidence_id,
      applied,
      record_count: recordCount,
      message: "The result is too large for chat. Narrow the filters or generate a report.",
    };
  }
  return output;
}

async function categoryNames(context: NikkyContext, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map<string, string>();
  const { data, error } = await context.supabase
    .from("categories")
    .select("id,name")
    .eq("org_id", context.organizationId)
    .in("id", unique);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((row) => [String(row.id), String(row.name)]));
}

async function financialSummary(
  context: NikkyContext,
  args: Record<string, unknown>,
) {
  const { startDate, endDate } = assertDateRange(args.start_date, args.end_date);
  enforceFinanceWindow(context, startDate);
  const [income, expenses] = await Promise.all([
    context.supabase
      .from("income_entries")
      .select("amount_cents")
      .eq("org_id", context.organizationId)
      .gte("session_date", startDate)
      .lte("session_date", endDate),
    context.supabase
      .from("expense_entries")
      .select("amount_cents")
      .eq("org_id", context.organizationId)
      .gte("expense_date", startDate)
      .lte("expense_date", endDate),
  ]);
  if (income.error) throw new Error(income.error.message);
  if (expenses.error) throw new Error(expenses.error.message);
  const incomeCents = (income.data ?? []).reduce((sum, row) => sum + Number(row.amount_cents), 0);
  const expenseCents = (expenses.data ?? []).reduce((sum, row) => sum + Number(row.amount_cents), 0);
  const count = (income.data?.length ?? 0) + (expenses.data?.length ?? 0);
  return result(count ? "ok" : "no_records", { start_date: startDate, end_date: endDate }, {
    income_cents: incomeCents,
    expense_cents: expenseCents,
    net_cents: incomeCents - expenseCents,
    income_record_count: income.data?.length ?? 0,
    expense_record_count: expenses.data?.length ?? 0,
  }, count);
}

async function financialComparison(context: NikkyContext, args: Record<string, unknown>) {
  const a = assertDateRange(args.period_a_start, args.period_a_end);
  const b = assertDateRange(args.period_b_start, args.period_b_end);
  enforceFinanceWindow(context, a.startDate);
  enforceFinanceWindow(context, b.startDate);
  const [aResult, bResult] = await Promise.all([
    financialSummary(context, { start_date: a.startDate, end_date: a.endDate }),
    financialSummary(context, { start_date: b.startDate, end_date: b.endDate }),
  ]);
  const aData = aResult.data as Record<string, number>;
  const bData = bResult.data as Record<string, number>;
  return result("ok", {
    period_a: { start_date: a.startDate, end_date: a.endDate },
    period_b: { start_date: b.startDate, end_date: b.endDate },
  }, {
    period_a: aData,
    period_b: bData,
    change_cents: {
      income: bData.income_cents - aData.income_cents,
      expense: bData.expense_cents - aData.expense_cents,
      net: bData.net_cents - aData.net_cents,
    },
  }, aResult.record_count + bResult.record_count);
}

async function breakdown(
  context: NikkyContext,
  args: Record<string, unknown>,
  kind: "income" | "expense",
) {
  const { startDate, endDate } = assertDateRange(args.start_date, args.end_date);
  enforceFinanceWindow(context, startDate);
  const groupBy = text(args.group_by);
  const table = kind === "income" ? "income_entries" : "expense_entries";
  const dateField = kind === "income" ? "session_date" : "expense_date";
  const categoryField = kind === "income" ? "income_category_id" : "expense_category_id";
  const select = kind === "income"
    ? "session_date,service_category_id,income_category_id,payment_method,amount_cents"
    : "expense_date,expense_category_id,payment_method,vendor,amount_cents";
  const { data, error } = await context.supabase
    .from(table)
    .select(select)
    .eq("org_id", context.organizationId)
    .gte(dateField, startDate)
    .lte(dateField, endDate);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const grouped = new Map<string, { amount_cents: number; record_count: number }>();
  for (const row of rows) {
    let key: string;
    if (groupBy === "category") key = String(row[categoryField] ?? "unknown");
    else if (groupBy === "service") key = String(row.service_category_id ?? "unknown");
    else if (groupBy === "vendor") key = String(row.vendor ?? "Unspecified");
    else if (groupBy === "method") key = String(row.payment_method ?? "unknown");
    else key = String(row[dateField]);
    const current = grouped.get(key) ?? { amount_cents: 0, record_count: 0 };
    current.amount_cents += Number(row.amount_cents ?? 0);
    current.record_count += 1;
    grouped.set(key, current);
  }
  const categoryLike = groupBy === "category" || groupBy === "service";
  const names = categoryLike ? await categoryNames(context, [...grouped.keys()]) : new Map();
  const output = [...grouped.entries()]
    .map(([key, value]) => ({ key, name: names.get(key) ?? key, ...value }))
    .sort((a, b) => b.amount_cents - a.amount_cents)
    .slice(0, 100);
  return result(rows.length ? "ok" : "no_records", {
    start_date: startDate, end_date: endDate, group_by: groupBy,
  }, output, rows.length);
}

export async function incomeMonthlyBreakdown(
  context: NikkyContext,
  args: Record<string, unknown>,
) {
  const { startDate, endDate } = assertDateRange(args.start_date, args.end_date);
  enforceFinanceWindow(context, startDate);
  const groupBy = text(args.group_by);
  if (!["total", "category", "service", "method"].includes(groupBy)) {
    throw new Error("Invalid monthly income grouping.");
  }

  const { data, error } = await context.supabase
    .from("income_entries")
    .select("session_date,income_category_id,service_category_id,payment_method,amount_cents")
    .eq("org_id", context.organizationId)
    .gte("session_date", startDate)
    .lte("session_date", endDate);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const months = calendarMonths(startDate, endDate);
  const monthlyTotals = new Map<string, { total_cents: number; record_count: number }>(
    months.map((month) => [month, { total_cents: 0, record_count: 0 }]),
  );
  const observedGroups = new Set<string>();
  const grouped = new Map<string, { total_cents: number; record_count: number }>();

  for (const row of rows) {
    const month = String(row.session_date).slice(0, 7);
    const monthTotal = monthlyTotals.get(month) ?? { total_cents: 0, record_count: 0 };
    monthTotal.total_cents += Number(row.amount_cents ?? 0);
    monthTotal.record_count += 1;
    monthlyTotals.set(month, monthTotal);

    let group = "all";
    if (groupBy === "category") group = String(row.income_category_id ?? "unspecified");
    else if (groupBy === "service") group = String(row.service_category_id ?? "unspecified");
    else if (groupBy === "method") group = String(row.payment_method ?? "unspecified");
    observedGroups.add(group);
    const key = `${month}\u0000${group}`;
    const current = grouped.get(key) ?? { total_cents: 0, record_count: 0 };
    current.total_cents += Number(row.amount_cents ?? 0);
    current.record_count += 1;
    grouped.set(key, current);
  }

  const groups = groupBy === "total"
    ? ["all"]
    : [...observedGroups].sort((a, b) => a.localeCompare(b));
  if (months.length * Math.max(groups.length, 1) > 100) {
    return result(
      "unavailable",
      { start_date: startDate, end_date: endDate, group_by: groupBy },
      null,
      rows.length,
      "That monthly breakdown would exceed 100 rows. Narrow the date range or choose a simpler grouping.",
    );
  }

  const categoryGrouping = groupBy === "category" || groupBy === "service";
  const names = categoryGrouping
    ? await categoryNames(context, groups.filter((group) => group !== "unspecified"))
    : new Map<string, string>();
  const groupName = (group: string) => {
    if (group === "all") return "All giving";
    if (group === "unspecified") return "Unspecified";
    return names.get(group) ?? group;
  };

  const breakdownRows = months.flatMap((month) =>
    groups.map((group) => {
      const value = grouped.get(`${month}\u0000${group}`);
      return {
        month,
        group: groupName(group),
        total_cents: value?.total_cents ?? 0,
        record_count: value?.record_count ?? 0,
      };
    }),
  );

  return result(
    rows.length ? "ok" : "no_records",
    { start_date: startDate, end_date: endDate, group_by: groupBy },
    {
      total_cents: rows.reduce((sum, row) => sum + Number(row.amount_cents ?? 0), 0),
      giving_record_count: rows.length,
      monthly_totals: months.map((month) => ({ month, ...monthlyTotals.get(month)! })),
      breakdown: breakdownRows,
    },
    rows.length,
  );
}

async function givingDemographicSummary(context: NikkyContext, args: Record<string, unknown>) {
  const { startDate, endDate } = assertDateRange(args.start_date, args.end_date);
  enforceFinanceWindow(context, startDate);
  const filters = demographicFilters(args, givingGroupings);
  const { data, error } = await context.supabase
    .from("income_entries")
    .select("amount_cents,member_id,income_category_id,service_category_id,payment_method,members!inner(age_group,segment,gender,status,membership_stage)")
    .eq("org_id", context.organizationId)
    .gte("session_date", startDate)
    .lte("session_date", endDate)
    .in("members.status", ["active", "archived"])
    .eq("members.membership_stage", "member");
  if (error) throw new Error(error.message);
  const rows = (data ?? []).flatMap((row) => {
    const member = Array.isArray(row.members) ? row.members[0] : row.members;
    return member && matchesDemographics(member, filters) ? [{ ...row, member }] : [];
  });
  const categoryGrouping = filters.groupBy === "category" || filters.groupBy === "service";
  const groupedCategoryIds = categoryGrouping
    ? rows.map((row) => String(filters.groupBy === "category" ? row.income_category_id ?? "" : row.service_category_id ?? "")).filter(Boolean)
    : [];
  const groupedCategoryNames = await categoryNames(context, groupedCategoryIds);
  const groups = new Map<string, { total_cents: number; giving_record_count: number; memberIds: Set<string> }>();
  for (const row of rows) {
    let key: string;
    if (filters.groupBy === "none") key = "all";
    else if (filters.groupBy === "category") key = String(row.income_category_id ?? "uncategorized");
    else if (filters.groupBy === "service") key = String(row.service_category_id ?? "unspecified");
    else if (filters.groupBy === "method") key = String(row.payment_method ?? "unspecified");
    else key = String((row.member as DemographicRow)[filters.groupBy as keyof DemographicRow] ?? "unknown");
    const current = groups.get(key) ?? { total_cents: 0, giving_record_count: 0, memberIds: new Set<string>() };
    current.total_cents += Number(row.amount_cents);
    current.giving_record_count += 1;
    if (row.member_id) current.memberIds.add(String(row.member_id));
    groups.set(key, current);
  }
  const breakdown = [...groups.entries()].map(([key, value]) => ({
    group: categoryGrouping ? groupedCategoryNames.get(key) ?? (key === "uncategorized" || key === "unspecified" ? "Unspecified" : "Unknown category") : key,
    total_cents: value.total_cents,
    giving_record_count: value.giving_record_count,
    matched_member_count: value.memberIds.size,
  })).sort((a, b) => b.total_cents - a.total_cents);
  const totalCents = rows.reduce((sum, row) => sum + Number(row.amount_cents), 0);
  const memberCount = new Set(rows.map((row) => String(row.member_id)).filter(Boolean)).size;
  return result(rows.length ? "ok" : "no_records", {
    ...demographicApplied(startDate, endDate, filters),
    demographic_basis: "current_canonical_member_profile",
  }, {
    total_cents: totalCents,
    giving_record_count: rows.length,
    matched_member_count: memberCount,
    breakdown,
    excludes_unlinked_giving: true,
  }, rows.length);
}

async function searchMembers(context: NikkyContext, args: Record<string, unknown>) {
  const query = text(args.query);
  if (query.length < 2) throw new Error("Enter at least two characters.");
  if (!/^[\p{L}\p{N}\s'.-]+$/u.test(query)) {
    throw new Error("Member searches may contain letters, numbers, spaces, apostrophes, periods, and hyphens only.");
  }
  const tokens = query.split(/\s+/u).filter(Boolean);
  const anchor = [...tokens].sort((a, b) => b.length - a.length)[0];
  const escaped = anchor.replaceAll("%", "\\%").replaceAll("_", "\\_");
  const { data, error } = await context.supabase
    .from("members")
    .select("id,first_name,last_name,email,status,membership_stage")
    .eq("org_id", context.organizationId)
    .in("status", ["active", "archived"])
    .eq("membership_stage", "member")
    .or(`first_name.ilike.%${escaped}%,last_name.ilike.%${escaped}%`)
    .order("last_name")
    .order("first_name")
    .limit(50);
  if (error) throw new Error(error.message);
  const matches = filterMemberSearchMatches(data ?? [], query);
  return result(matches.length ? "ok" : "no_records", { search_performed: true }, matches, matches.length,
    matches.length > 1 ? "Multiple members matched. Ask the user to choose one." : undefined);
}

async function canonicalMember(context: NikkyContext, memberId: string) {
  const { data, error } = await context.supabase
    .from("members")
    .select("id,first_name,last_name,email,phone,joined_at,status,gender,dob,age_group,segment,address,membership_stage,profile_complete,marital_status,children_count,baptized,baptism_date,born_again,born_again_date,department_category_id")
    .eq("org_id", context.organizationId)
    .eq("id", memberId)
    .in("status", ["active", "archived"])
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function memberProfile(context: NikkyContext, args: Record<string, unknown>) {
  const memberId = text(args.member_id);
  const member = await canonicalMember(context, memberId);
  return result(member ? "ok" : "no_records", { member_resolved: Boolean(member) }, member, member ? 1 : 0,
    member ? undefined : "No current canonical member matched that identifier.");
}

type MemberStatus = "active" | "archived";
type Milestone = "new_members" | "new_converts" | "baptisms";

async function exactMemberCount(
  context: NikkyContext,
  status: MemberStatus,
  milestone?: Milestone,
  startDate?: string,
  endDate?: string,
) {
  let query = context.supabase
    .from("members")
    .select("id", { count: "exact", head: true })
    .eq("org_id", context.organizationId)
    .eq("status", status);
  if (!milestone || milestone === "new_members") query = query.eq("membership_stage", "member");
  if (milestone === "new_members") query = query.gte("joined_at", startDate!).lte("joined_at", endDate!);
  if (milestone === "new_converts") query = query.eq("born_again", true).gte("born_again_date", startDate!).lte("born_again_date", endDate!);
  if (milestone === "baptisms") query = query.eq("baptized", true).gte("baptism_date", startDate!).lte("baptism_date", endDate!);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function memberMilestoneSummary(context: NikkyContext, args: Record<string, unknown>) {
  const { startDate, endDate } = assertDateRange(args.start_date, args.end_date);
  const statuses: MemberStatus[] = ["active", "archived"];
  const milestones: Milestone[] = ["new_members", "new_converts", "baptisms"];
  const [activeMembers, archivedMembers, ...milestoneCounts] = await Promise.all([
    exactMemberCount(context, "active"),
    exactMemberCount(context, "archived"),
    ...milestones.flatMap((milestone) => statuses.map((status) => exactMemberCount(context, status, milestone, startDate, endDate))),
  ]);
  const counts = new Map<string, number>();
  let index = 0;
  for (const milestone of milestones) {
    for (const status of statuses) counts.set(`${milestone}:${status}`, milestoneCounts[index++] ?? 0);
  }
  const block = (milestone: Milestone, dateField: string) => {
    const active = counts.get(`${milestone}:active`) ?? 0;
    const archived = counts.get(`${milestone}:archived`) ?? 0;
    return { total: active + archived, active, archived, date_field: dateField };
  };
  const data = {
    current_members: { total: activeMembers + archivedMembers, active: activeMembers, archived: archivedMembers },
    new_members: block("new_members", "joined_at"),
    new_converts: block("new_converts", "born_again_date"),
    baptisms: block("baptisms", "baptism_date"),
    excludes_merged_records: true,
  };
  const recordCount = data.new_members.total + data.new_converts.total + data.baptisms.total;
  return result("ok", { start_date: startDate, end_date: endDate, statuses: statuses }, data, recordCount);
}

function populationBreakdown(
  rows: Array<Record<string, unknown>>,
  field: string,
  labels?: Map<string, string>,
) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = String(row[field] ?? "unspecified");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, member_count]) => ({
      group: labels?.get(key) ?? (key === "unspecified" ? "Unspecified" : key),
      member_count,
    }))
    .sort((a, b) => b.member_count - a.member_count || a.group.localeCompare(b.group));
}

function segmentFromDemographics(row: Record<string, unknown>) {
  const gender = String(row.gender ?? "").toLowerCase();
  const ageGroup = String(row.age_group ?? "");
  if (!(["male", "female"] as const).includes(gender as "male" | "female")) return null;
  if (!["1-12", "13-17", "18-35", "36+"].includes(ageGroup)) return null;
  if (ageGroup === "1-12" || ageGroup === "13-17") return gender === "male" ? "boys" : "girls";
  return gender === "male" ? "men" : "women";
}

export async function memberPopulationSummary(context: NikkyContext) {
  const { data, error } = await context.supabase
    .from("members")
    .select("status,age_group,segment,gender,department_category_id")
    .eq("org_id", context.organizationId)
    .eq("membership_stage", "member")
    .in("status", ["active", "archived"])
    .limit(10000);
  if (error) throw new Error(error.message);
  const sourceRows = (data ?? []) as Array<Record<string, unknown>>;
  const rows: Array<Record<string, unknown>> = sourceRows.map((row) => ({
    ...row,
    // segment is database-derived, but recompute here as defense in depth for
    // legacy/restored data while the database invariant remains authoritative.
    segment: segmentFromDemographics(row),
  }));
  const departmentIds = rows
    .map((row) => String(row.department_category_id ?? ""))
    .filter(Boolean);
  const departmentNames = await categoryNames(context, departmentIds);
  return result(
    rows.length ? "ok" : "no_records",
    {
      membership_stage: "member",
      statuses: ["active", "archived"],
      excludes_merged_records: true,
    },
    {
      total_members: rows.length,
      by_status: populationBreakdown(rows, "status"),
      by_age_group: populationBreakdown(rows, "age_group"),
      by_segment: populationBreakdown(rows, "segment"),
      by_gender: populationBreakdown(rows, "gender"),
      by_department: populationBreakdown(rows, "department_category_id", departmentNames),
    },
    rows.length,
  );
}

async function attendanceRows(context: NikkyContext, startDate: string, endDate: string) {
  const { data: sessions, error: sessionError } = await context.supabase
    .from("attendance_sessions")
    .select("id,session_date,service_category_id")
    .eq("org_id", context.organizationId)
    .eq("status", "published")
    .is("deleted_at", null)
    .gte("session_date", startDate)
    .lte("session_date", endDate)
    .order("session_date");
  if (sessionError) throw new Error(sessionError.message);
  const ids = (sessions ?? []).map((row) => String(row.id));
  if (!ids.length) return { sessions: [], entries: [] };
  const entries: Array<Record<string, unknown>> = [];
  for (let offset = 0; offset < 20_000; offset += 1000) {
    const { data, error } = await context.supabase
      .from("attendance_entries")
      .select("session_id,count,member_id,entry_source,segment,age_group,gender")
      .eq("org_id", context.organizationId)
      .in("session_id", ids)
      .range(offset, offset + 999);
    if (error) throw new Error(error.message);
    entries.push(...((data ?? []) as Array<Record<string, unknown>>));
    if ((data?.length ?? 0) < 1000) break;
  }
  if (entries.length >= 20_000) throw new Error("Attendance analysis exceeds the safe 20,000-row limit. Narrow the date range.");
  return { sessions: sessions ?? [], entries };
}

type PublishedAttendanceSession = {
  id: unknown;
  session_date: unknown;
  service_category_id: unknown;
};

type PublishedAttendanceEntry = {
  session_id: unknown;
  member_id: unknown;
  entry_source: unknown;
  count?: unknown;
};

type ActiveMember = {
  id: unknown;
  first_name: unknown;
  last_name: unknown;
};

function requestedPage(args: Record<string, unknown>) {
  const page = Number(args.page);
  if (!Number.isInteger(page) || page < 1 || page > 1000) throw new Error("page must be an integer between 1 and 1000.");
  return page;
}

function memberName(member: ActiveMember) {
  return `${String(member.first_name ?? "")} ${String(member.last_name ?? "")}`.trim();
}

function pageRows<T>(rows: T[], page: number, pageSize = 50) {
  const start = (page - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    page,
    page_size: pageSize,
    total_count: rows.length,
    total_pages: Math.max(1, Math.ceil(rows.length / pageSize)),
    truncated: start + pageSize < rows.length,
  };
}

async function activeCanonicalMembers(context: NikkyContext) {
  const { data, error } = await context.supabase
    .from("members")
    .select("id,first_name,last_name")
    .eq("org_id", context.organizationId)
    .eq("status", "active")
    .eq("membership_stage", "member")
    .order("last_name")
    .order("first_name")
    .limit(10000);
  if (error) throw new Error(error.message);
  return (data ?? []) as ActiveMember[];
}

function entriesBySession(entries: PublishedAttendanceEntry[]) {
  const grouped = new Map<string, PublishedAttendanceEntry[]>();
  for (const entry of entries) {
    const id = String(entry.session_id);
    grouped.set(id, [...(grouped.get(id) ?? []), entry]);
  }
  return grouped;
}

function isMemberCompleteSession(
  session: PublishedAttendanceSession,
  groupedEntries: Map<string, PublishedAttendanceEntry[]>,
) {
  const rows = groupedEntries.get(String(session.id)) ?? [];
  return rows.length > 0 && rows.every((entry) =>
    entry.entry_source === "member" && Boolean(entry.member_id));
}

function memberPresence(
  session: PublishedAttendanceSession,
  groupedEntries: Map<string, PublishedAttendanceEntry[]>,
) {
  return new Set(
    (groupedEntries.get(String(session.id)) ?? [])
      .filter((entry) => entry.entry_source === "member" && entry.member_id)
      .map((entry) => String(entry.member_id)),
  );
}

export async function sundayMemberCheckins(
  context: NikkyContext,
  args: Record<string, unknown>,
) {
  if (!Array.isArray(args.sunday_dates) || !args.sunday_dates.length || args.sunday_dates.length > 12) {
    throw new Error("Choose between one and twelve Sunday dates.");
  }
  const dates = [...new Set(args.sunday_dates.map((value) => {
    assertIsoDate(value, "sunday_date");
    if (new Date(`${value}T12:00:00.000Z`).getUTCDay() !== 0) throw new Error(`${value} is not a Sunday.`);
    return value;
  }))].sort();
  const page = requestedPage(args);
  const { sessions, entries } = await attendanceRows(context, dates[0], dates.at(-1)!);
  const relevantSessions = (sessions as PublishedAttendanceSession[]).filter((session) =>
    dates.includes(String(session.session_date)));
  const grouped = entriesBySession(entries as PublishedAttendanceEntry[]);
  const members = await activeCanonicalMembers(context);
  const sessionsByDate = new Map<string, PublishedAttendanceSession[]>();
  for (const session of relevantSessions) {
    const date = String(session.session_date);
    sessionsByDate.set(date, [...(sessionsByDate.get(date) ?? []), session]);
  }
  const coverage = dates.map((date) => {
    const daySessions = sessionsByDate.get(date) ?? [];
    const complete = daySessions.length > 0
      && daySessions.every((session) => isMemberCompleteSession(session, grouped));
    return {
      date,
      published_session_count: daySessions.length,
      classification: daySessions.length === 0
        ? "missing"
        : complete ? "member_complete" : "anonymous_or_incomplete",
    };
  });
  const candidates = members.flatMap((member) => {
    const id = String(member.id);
    const statuses = dates.map((date) => {
      const daySessions = sessionsByDate.get(date) ?? [];
      const present = daySessions.some((session) => memberPresence(session, grouped).has(id));
      const dayCoverage = coverage.find((item) => item.date === date)!;
      return {
        date,
        status: present
          ? "recorded_present"
          : dayCoverage.classification === "member_complete"
            ? "recorded_absent"
            : "unknown",
      };
    });
    if (statuses.some((item) => item.status === "recorded_present")) return [];
    return [{
      member_id: id,
      member_name: memberName(member),
      overall_status: statuses.every((item) => item.status === "recorded_absent")
        ? "recorded_absent"
        : "unknown",
      sundays: statuses,
    }];
  }).sort((a, b) => a.member_name.localeCompare(b.member_name));
  const paged = pageRows(candidates, page);
  const absentCount = candidates.filter((row) => row.overall_status === "recorded_absent").length;
  const unknownCount = candidates.length - absentCount;
  return result(candidates.length ? "ok" : "no_records", {
    sunday_dates: dates,
    page,
    reliability_basis: "all_published_sessions_for_sunday_must_be_member_complete",
  }, {
    coverage,
    members_with_no_recorded_checkin: paged,
    recorded_absent_count: absentCount,
    unknown_count: unknownCount,
    active_member_count: members.length,
  }, candidates.length,
  unknownCount ? "Unknown means anonymous headcount, mixed capture, missing sessions, or incomplete check-in data prevented an absence conclusion." : undefined);
}

function sessionsForService(
  sessions: PublishedAttendanceSession[],
  groupedEntries: Map<string, PublishedAttendanceEntry[]>,
) {
  const map = new Map<string, PublishedAttendanceSession[]>();
  for (const session of sessions) {
    if (!isMemberCompleteSession(session, groupedEntries)) continue;
    const serviceId = String(session.service_category_id);
    map.set(serviceId, [...(map.get(serviceId) ?? []), session]);
  }
  return map;
}

function attendanceCountForMember(
  sessions: PublishedAttendanceSession[],
  groupedEntries: Map<string, PublishedAttendanceEntry[]>,
  memberId: string,
) {
  return sessions.filter((session) => memberPresence(session, groupedEntries).has(memberId)).length;
}

export async function attendanceMemberChanges(
  context: NikkyContext,
  args: Record<string, unknown>,
) {
  const baseline = assertDateRange(args.baseline_start, args.baseline_end);
  const current = assertDateRange(args.current_start, args.current_end);
  const page = requestedPage(args);
  const start = [baseline.startDate, current.startDate].sort()[0];
  const end = [baseline.endDate, current.endDate].sort().at(-1)!;
  const { sessions, entries } = await attendanceRows(context, start, end);
  const allSessions = sessions as PublishedAttendanceSession[];
  const grouped = entriesBySession(entries as PublishedAttendanceEntry[]);
  const baselineByService = sessionsForService(
    allSessions.filter((session) => String(session.session_date) >= baseline.startDate && String(session.session_date) <= baseline.endDate),
    grouped,
  );
  const currentByService = sessionsForService(
    allSessions.filter((session) => String(session.session_date) >= current.startDate && String(session.session_date) <= current.endDate),
    grouped,
  );
  const members = await activeCanonicalMembers(context);
  const serviceIds = [...new Set([...baselineByService.keys(), ...currentByService.keys()])];
  const names = await categoryNames(context, serviceIds);
  const eligibleServices = serviceIds.filter((id) =>
    (baselineByService.get(id)?.length ?? 0) >= 4 && (currentByService.get(id)?.length ?? 0) >= 4);
  const rows = eligibleServices.flatMap((serviceId) => {
    const baselineSessions = baselineByService.get(serviceId)!;
    const currentSessions = currentByService.get(serviceId)!;
    return members.flatMap((member) => {
      const id = String(member.id);
      const baselinePresent = attendanceCountForMember(baselineSessions, grouped, id);
      const currentPresent = attendanceCountForMember(currentSessions, grouped, id);
      const baselineRate = baselinePresent / baselineSessions.length;
      const currentRate = currentPresent / currentSessions.length;
      const declinePoints = baselineRate - currentRate;
      if (declinePoints < 0.25 || baselinePresent - currentPresent < 2) return [];
      return [{
        member_id: id,
        member_name: memberName(member),
        service_id: serviceId,
        service: names.get(serviceId) ?? "Service",
        baseline: { attended: baselinePresent, eligible_sessions: baselineSessions.length, attendance_rate: baselineRate },
        current: { attended: currentPresent, eligible_sessions: currentSessions.length, attendance_rate: currentRate },
        decline_percentage_points: declinePoints * 100,
      }];
    });
  }).sort((a, b) => a.member_name.localeCompare(b.member_name)
    || a.service.localeCompare(b.service));
  const totalPublished = allSessions.length;
  const completePublished = allSessions.filter((session) => isMemberCompleteSession(session, grouped)).length;
  return result(rows.length ? "ok" : eligibleServices.length ? "no_records" : "unavailable", {
    baseline: { start_date: baseline.startDate, end_date: baseline.endDate },
    current: { start_date: current.startDate, end_date: current.endDate },
    minimum_sessions_per_period: 4,
    minimum_decline_percentage_points: 25,
    minimum_presence_drop: 2,
    page,
  }, {
    matches: pageRows(rows, page),
    eligible_service_count: eligibleServices.length,
    published_session_count: totalPublished,
    member_complete_session_count: completePublished,
    excluded_session_count: totalPublished - completePublished,
  }, rows.length,
  eligibleServices.length ? undefined : "No service had at least four entirely member-recorded sessions in both periods.");
}

export async function attendanceInconsistency(
  context: NikkyContext,
  args: Record<string, unknown>,
) {
  const { startDate, endDate } = assertDateRange(args.start_date, args.end_date);
  const page = requestedPage(args);
  const { sessions, entries } = await attendanceRows(context, startDate, endDate);
  const allSessions = sessions as PublishedAttendanceSession[];
  const grouped = entriesBySession(entries as PublishedAttendanceEntry[]);
  const byService = sessionsForService(allSessions, grouped);
  const eligible = [...byService.entries()].filter(([, rows]) => rows.length >= 8);
  const members = await activeCanonicalMembers(context);
  const names = await categoryNames(context, eligible.map(([id]) => id));
  const rows = eligible.flatMap(([serviceId, serviceSessions]) => members.flatMap((member) => {
    const attended = attendanceCountForMember(serviceSessions, grouped, String(member.id));
    const missed = serviceSessions.length - attended;
    const rate = attended / serviceSessions.length;
    if (attended < 3 || missed < 3 || rate < 0.25 || rate > 0.75) return [];
    return [{
      member_id: String(member.id),
      member_name: memberName(member),
      service_id: serviceId,
      service: names.get(serviceId) ?? "Service",
      attended,
      missed,
      eligible_sessions: serviceSessions.length,
      attendance_rate: rate,
    }];
  })).sort((a, b) => a.member_name.localeCompare(b.member_name)
    || a.service.localeCompare(b.service));
  const completeCount = allSessions.filter((session) => isMemberCompleteSession(session, grouped)).length;
  return result(rows.length ? "ok" : eligible.length ? "no_records" : "unavailable", {
    start_date: startDate,
    end_date: endDate,
    minimum_eligible_sessions: 8,
    attendance_rate_range: [0.25, 0.75],
    page,
  }, {
    matches: pageRows(rows, page),
    eligible_service_count: eligible.length,
    published_session_count: allSessions.length,
    member_complete_session_count: completeCount,
    excluded_session_count: allSessions.length - completeCount,
  }, rows.length,
  eligible.length ? undefined : "No service had at least eight entirely member-recorded sessions in that period.");
}

export async function attendancePastoralCandidates(
  context: NikkyContext,
  args: Record<string, unknown>,
) {
  assertIsoDate(args.as_of_date, "as_of_date");
  const asOfDate = args.as_of_date;
  const page = requestedPage(args);
  const lookbackStart = isoShiftMonths(asOfDate, -24);
  const { sessions, entries } = await attendanceRows(context, lookbackStart, asOfDate);
  const allSessions = sessions as PublishedAttendanceSession[];
  const grouped = entriesBySession(entries as PublishedAttendanceEntry[]);
  const allByService = new Map<string, PublishedAttendanceSession[]>();
  for (const session of allSessions) {
    const id = String(session.service_category_id);
    allByService.set(id, [...(allByService.get(id) ?? []), session]);
  }
  const eligible = [...allByService.entries()].flatMap(([serviceId, serviceSessions]) => {
    const latest = serviceSessions
      .slice()
      .sort((a, b) => String(b.session_date).localeCompare(String(a.session_date)))
      .slice(0, 12)
      .reverse();
    return latest.length === 12 && latest.every((session) => isMemberCompleteSession(session, grouped))
      ? [[serviceId, latest] as const]
      : [];
  });
  const members = await activeCanonicalMembers(context);
  const names = await categoryNames(context, eligible.map(([id]) => id));
  const rows = eligible.flatMap(([serviceId, serviceSessions]) => {
    const baseline = serviceSessions.slice(0, 8);
    const recent = serviceSessions.slice(8);
    return members.flatMap((member) => {
      const id = String(member.id);
      const baselinePresent = attendanceCountForMember(baseline, grouped, id);
      const recentPresent = attendanceCountForMember(recent, grouped, id);
      if (baselinePresent < 6 || recentPresent !== 0) return [];
      return [{
        member_id: id,
        member_name: memberName(member),
        service_id: serviceId,
        service: names.get(serviceId) ?? "Service",
        baseline_attended: baselinePresent,
        baseline_sessions: 8,
        recent_attended: 0,
        recent_sessions: 4,
        recent_session_dates: recent.map((session) => String(session.session_date)),
        reason: "Attended at least six of the preceding eight complete sessions, then had no recorded attendance in the latest four.",
      }];
    });
  }).sort((a, b) => a.member_name.localeCompare(b.member_name) || a.service.localeCompare(b.service));
  return result(rows.length ? "ok" : eligible.length ? "no_records" : "unavailable", {
    as_of_date: asOfDate,
    lookback_start: lookbackStart,
    required_consecutive_member_complete_sessions: 12,
    baseline_rule: "at_least_6_of_8",
    recent_rule: "0_of_4",
    page,
  }, {
    candidates: pageRows(rows, page),
    eligible_service_count: eligible.length,
    evaluated_active_member_count: members.length,
  }, rows.length,
  eligible.length
    ? "These are attendance-based signals only, not pastoral judgments."
    : "No service has twelve consecutive entirely member-recorded published sessions.");
}

async function attendanceSummary(context: NikkyContext, args: Record<string, unknown>, trends: boolean) {
  const { startDate, endDate } = assertDateRange(args.start_date, args.end_date);
  const { sessions, entries } = await attendanceRows(context, startDate, endDate);
  const totals = new Map<string, number>();
  for (const entry of entries) {
    totals.set(String(entry.session_id), (totals.get(String(entry.session_id)) ?? 0) + Number(entry.count));
  }
  const names = await categoryNames(context, sessions.map((row) => String(row.service_category_id)));
  const rows = sessions.map((session) => ({
    session_id: session.id,
    date: session.session_date,
    service: names.get(String(session.service_category_id)) ?? "Service",
    attendance: totals.get(String(session.id)) ?? 0,
  }));
  const totalAttendance = rows.reduce((sum, row) => sum + row.attendance, 0);
  const data = trends ? rows : {
    total_attendance: totalAttendance,
    session_count: rows.length,
    average_attendance: rows.length ? totalAttendance / rows.length : 0,
    sessions: rows,
  };
  return result(rows.length ? "ok" : "no_records", { start_date: startDate, end_date: endDate }, data, rows.length);
}

export async function attendanceMonthlySummary(
  context: NikkyContext,
  args: Record<string, unknown>,
) {
  const { startDate, endDate } = assertDateRange(args.start_date, args.end_date);
  const { sessions, entries } = await attendanceRows(context, startDate, endDate);
  const months = calendarMonths(startDate, endDate);
  const totals = new Map<
    string,
    { attendance_count: number; sessionIds: Set<string> }
  >(
    months.map((month) => [
      month,
      { attendance_count: 0, sessionIds: new Set<string>() },
    ]),
  );
  const sessionById = new Map(
    sessions.map((session) => [String(session.id), session]),
  );
  for (const session of sessions) {
    const month = String(session.session_date).slice(0, 7);
    totals.get(month)?.sessionIds.add(String(session.id));
  }
  for (const entry of entries) {
    const session = sessionById.get(String(entry.session_id));
    if (!session) continue;
    const month = String(session.session_date).slice(0, 7);
    const current = totals.get(month);
    if (current) current.attendance_count += Number(entry.count);
  }
  const rows = months.map((month) => {
    const value = totals.get(month)!;
    const sessionCount = value.sessionIds.size;
    return {
      month,
      attendance_count: value.attendance_count,
      published_session_count: sessionCount,
      average_per_session: sessionCount
        ? value.attendance_count / sessionCount
        : 0,
    };
  });
  return result(
    sessions.length ? "ok" : "no_records",
    { start_date: startDate, end_date: endDate },
    {
      total_attendance: rows.reduce(
        (sum, row) => sum + row.attendance_count,
        0,
      ),
      published_sessions_in_range: sessions.length,
      months: rows,
    },
    sessions.length,
  );
}

async function attendanceDemographicSummary(context: NikkyContext, args: Record<string, unknown>) {
  const { startDate, endDate } = assertDateRange(args.start_date, args.end_date);
  const filters = demographicFilters(args);
  const { sessions, entries } = await attendanceRows(context, startDate, endDate);
  const matching = entries.filter((entry) => matchesDemographics(entry, filters));
  const groups = new Map<string, { attendance_count: number; entry_record_count: number; sessionIds: Set<string> }>();
  for (const entry of matching) {
    const key = filters.groupBy === "none"
      ? "all"
      : String((entry as DemographicRow)[filters.groupBy as keyof DemographicRow] ?? "unknown");
    const current = groups.get(key) ?? { attendance_count: 0, entry_record_count: 0, sessionIds: new Set<string>() };
    current.attendance_count += Number(entry.count);
    current.entry_record_count += 1;
    current.sessionIds.add(String(entry.session_id));
    groups.set(key, current);
  }
  const breakdown = [...groups.entries()].map(([group, value]) => ({
    group,
    attendance_count: value.attendance_count,
    entry_record_count: value.entry_record_count,
    session_count: value.sessionIds.size,
  })).sort((a, b) => b.attendance_count - a.attendance_count);
  return result(matching.length ? "ok" : "no_records", {
    ...demographicApplied(startDate, endDate, filters),
    demographic_basis: "attendance_entry_snapshot",
  }, {
    attendance_count: matching.reduce((sum, entry) => sum + Number(entry.count), 0),
    entry_record_count: matching.length,
    session_count: new Set(matching.map((entry) => String(entry.session_id))).size,
    published_sessions_in_range: sessions.length,
    breakdown,
  }, matching.length);
}

function demographicGroupValues(filters: DemographicFilters) {
  if (filters.groupBy === "age_group") {
    return filters.ageGroups.length ? filters.ageGroups : [...ageGroups];
  }
  if (filters.groupBy === "segment") {
    return filters.segments.length ? filters.segments : [...segments];
  }
  if (filters.groupBy === "gender") {
    return filters.genders.length ? filters.genders : [...genders];
  }
  return ["all"];
}

function calendarMonths(startDate: string, endDate: string) {
  const [startYear, startMonth] = startDate.split("-").map(Number);
  const endKey = endDate.slice(0, 7);
  const months: string[] = [];
  let year = startYear;
  let month = startMonth;
  while (months.length < 120) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    months.push(key);
    if (key === endKey) break;
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

export async function attendanceDemographicBreakdown(
  context: NikkyContext,
  args: Record<string, unknown>,
) {
  const { startDate, endDate } = assertDateRange(args.start_date, args.end_date);
  const filters = demographicFilters(args);
  const interval = text(args.interval);
  if (!attendanceBreakdownIntervals.includes(interval as (typeof attendanceBreakdownIntervals)[number])) {
    throw new Error("Invalid attendance breakdown interval.");
  }

  const { sessions, entries } = await attendanceRows(context, startDate, endDate);
  const matching = entries.filter((entry) => matchesDemographics(entry, filters));
  const groups = demographicGroupValues(filters);
  const sessionById = new Map(sessions.map((session) => [String(session.id), session]));
  const names = await categoryNames(
    context,
    sessions.map((session) => String(session.service_category_id)),
  );

  const totals = new Map<
    string,
    { attendance_count: number; entry_record_count: number; sessionIds: Set<string> }
  >();
  for (const entry of matching) {
    const session = sessionById.get(String(entry.session_id));
    if (!session) continue;
    const period = interval === "month"
      ? String(session.session_date).slice(0, 7)
      : String(session.id);
    const group = filters.groupBy === "none"
      ? "all"
      : String((entry as DemographicRow)[filters.groupBy as keyof DemographicRow] ?? "unknown");
    const key = `${period}\u0000${group}`;
    const current = totals.get(key) ?? {
      attendance_count: 0,
      entry_record_count: 0,
      sessionIds: new Set<string>(),
    };
    current.attendance_count += Number(entry.count);
    current.entry_record_count += 1;
    current.sessionIds.add(String(entry.session_id));
    totals.set(key, current);
  }

  const periods = interval === "month"
    ? calendarMonths(startDate, endDate)
    : sessions.map((session) => String(session.id));
  if (periods.length * groups.length > 100) {
    return result(
      "unavailable",
      {
        ...demographicApplied(startDate, endDate, filters),
        interval,
        demographic_basis: "attendance_entry_snapshot",
      },
      null,
      matching.length,
      "That breakdown would exceed 100 rows. Narrow the date range or demographic groups.",
    );
  }

  const publishedSessionsByMonth = new Map<string, number>();
  for (const session of sessions) {
    const month = String(session.session_date).slice(0, 7);
    publishedSessionsByMonth.set(month, (publishedSessionsByMonth.get(month) ?? 0) + 1);
  }

  const rows = periods.flatMap((period) =>
    groups.map((group) => {
      const value = totals.get(`${period}\u0000${group}`);
      if (interval === "month") {
        return {
          month: period,
          group,
          attendance_count: value?.attendance_count ?? 0,
          entry_record_count: value?.entry_record_count ?? 0,
          matching_session_count: value?.sessionIds.size ?? 0,
          published_session_count: publishedSessionsByMonth.get(period) ?? 0,
        };
      }
      const session = sessionById.get(period)!;
      return {
        session_id: session.id,
        date: session.session_date,
        service: names.get(String(session.service_category_id)) ?? "Service",
        group,
        attendance_count: value?.attendance_count ?? 0,
        entry_record_count: value?.entry_record_count ?? 0,
      };
    }),
  );

  return result(
    matching.length ? "ok" : "no_records",
    {
      ...demographicApplied(startDate, endDate, filters),
      interval,
      demographic_basis: "attendance_entry_snapshot",
    },
    {
      attendance_count: matching.reduce(
        (sum, entry) => sum + Number(entry.count),
        0,
      ),
      entry_record_count: matching.length,
      matching_session_count: new Set(
        matching.map((entry) => String(entry.session_id)),
      ).size,
      published_sessions_in_range: sessions.length,
      rows,
    },
    matching.length,
  );
}

async function memberAttendanceHistories(
  context: NikkyContext,
  memberIds: string[],
  startDate: string,
  endDate: string,
) {
  const uniqueIds = [...new Set(memberIds)].slice(0, 10);
  if (!uniqueIds.length) throw new Error("Choose at least one member.");
  const { data: members, error: memberError } = await context.supabase
    .from("members")
    .select("id,first_name,last_name")
    .eq("org_id", context.organizationId)
    .in("id", uniqueIds)
    .in("status", ["active", "archived"])
    .eq("membership_stage", "member");
  if (memberError) throw new Error(memberError.message);
  const memberById = new Map((members ?? []).map((member) => [String(member.id), member]));
  const canonicalIds = uniqueIds.filter((id) => memberById.has(id));
  if (!canonicalIds.length) {
    return result("no_records", { members_requested: uniqueIds.length, members_resolved: 0, start_date: startDate, end_date: endDate }, null, 0,
      "No current canonical members matched those identifiers.");
  }
  const attendance = await attendanceRows(context, startDate, endDate);
  const sessions = attendance.sessions as PublishedAttendanceSession[];
  const allEntries = attendance.entries as PublishedAttendanceEntry[];
  const grouped = entriesBySession(allEntries);
  const sessionById = new Map(sessions.map((session) => [String(session.id), session]));
  const entries = allEntries.filter((entry) =>
    entry.entry_source === "member" && entry.member_id && canonicalIds.includes(String(entry.member_id)));
  const memberCompleteSessionCount = sessions.filter((session) => isMemberCompleteSession(session, grouped)).length;
  const incompleteSessionCount = sessions.length - memberCompleteSessionCount;
  const names = await categoryNames(context, sessions.map((row) => String(row.service_category_id)));
  const histories = canonicalIds.map((memberId) => {
    const member = memberById.get(memberId)!;
    const rows = entries
      .filter((entry) => String(entry.member_id) === memberId)
      .map((entry) => {
        const session = sessionById.get(String(entry.session_id));
        return {
          session_id: entry.session_id,
          date: session?.session_date,
          service: names.get(String(session?.service_category_id)) ?? "Service",
          count: Number(entry.count ?? 1),
        };
      })
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return {
      member: { id: member.id, name: `${member.first_name} ${member.last_name ?? ""}`.trim() },
      attendance_record_count: rows.length,
      total_attendance_count: rows.reduce((sum, row) => sum + Number(row.count), 0),
      coverage: {
        published_session_count: sessions.length,
        member_complete_session_count: memberCompleteSessionCount,
        anonymous_or_incomplete_session_count: incompleteSessionCount,
        absence_assessment: incompleteSessionCount === 0
          ? "reliable_for_published_sessions"
          : "partial_only",
      },
      rows,
    };
  });
  return result(entries.length ? "ok" : "no_records", {
    members_requested: uniqueIds.length,
    members_resolved: canonicalIds.length,
    start_date: startDate,
    end_date: endDate,
  }, {
    members: histories,
    coverage_basis: "Positive member check-ins remain valid in mixed sessions; an unlisted member is not treated as absent there.",
  }, entries.length,
  canonicalIds.length < uniqueIds.length
    ? "Some supplied member identifiers were no longer current canonical members."
    : entries.length
      ? undefined
      : "The selected members have no published attendance records in that date range.");
}

async function memberAttendanceHistory(context: NikkyContext, args: Record<string, unknown>) {
  const memberId = text(args.member_id);
  const { startDate, endDate } = assertDateRange(args.start_date, args.end_date);
  const output = await memberAttendanceHistories(context, [memberId], startDate, endDate);
  if (!output.data || typeof output.data !== "object") return output;
  const histories = (output.data as { members: unknown[] }).members;
  return { ...output, data: histories[0] ?? null };
}

async function membersAttendanceHistory(context: NikkyContext, args: Record<string, unknown>) {
  const memberIds = Array.isArray(args.member_ids)
    ? args.member_ids.map(text).filter(Boolean)
    : [];
  const { startDate, endDate } = assertDateRange(args.start_date, args.end_date);
  return memberAttendanceHistories(context, memberIds, startDate, endDate);
}

async function absentMembers(context: NikkyContext, args: Record<string, unknown>) {
  const sessionId = text(args.session_id);
  const { data: session, error: sessionError } = await context.supabase
    .from("attendance_sessions")
    .select("id,session_date,service_category_id,status,deleted_at")
    .eq("org_id", context.organizationId)
    .eq("id", sessionId)
    .eq("status", "published")
    .is("deleted_at", null)
    .maybeSingle();
  if (sessionError) throw new Error(sessionError.message);
  if (!session) return result("no_records", { session_id: sessionId }, null, 0);
  const { data: entries, error: entriesError } = await context.supabase
    .from("attendance_entries")
    .select("entry_source,member_id")
    .eq("org_id", context.organizationId)
    .eq("session_id", sessionId);
  if (entriesError) throw new Error(entriesError.message);
  if (!entries?.length || entries.some((row) => row.entry_source !== "member" || !row.member_id)) {
    return result("unavailable", { session_id: sessionId, session_date: session.session_date }, null, entries?.length ?? 0,
      "Absence is available only for sessions recorded entirely by member.");
  }
  const attended = new Set(entries.map((row) => String(row.member_id)));
  const { data: members, error: memberError } = await context.supabase
    .from("members")
    .select("id,first_name,last_name")
    .eq("org_id", context.organizationId)
    .eq("status", "active")
    .eq("membership_stage", "member")
    .order("last_name")
    .order("first_name");
  if (memberError) throw new Error(memberError.message);
  const absent = (members ?? []).filter((member) => !attended.has(String(member.id))).slice(0, 100);
  return result(absent.length ? "ok" : "no_records", {
    session_id: sessionId, session_date: session.session_date,
  }, absent.map((member) => ({ id: member.id, name: `${member.first_name} ${member.last_name ?? ""}`.trim() })), absent.length);
}

async function visitorList(context: NikkyContext, args: Record<string, unknown>) {
  const { startDate, endDate } = assertDateRange(args.start_date, args.end_date);
  const { data, error } = await context.supabase
    .from("members")
    .select("id,first_name,last_name,email,phone,status,gender,age_group,visitor_details!inner(first_visit_at,follow_up_status,next_follow_up_at,how_heard)")
    .eq("org_id", context.organizationId)
    .in("status", ["active", "archived"])
    .gte("visitor_details.first_visit_at", startDate)
    .lte("visitor_details.first_visit_at", endDate)
    .order("first_name")
    .limit(100);
  if (error) throw new Error(error.message);
  return result(data?.length ? "ok" : "no_records", { start_date: startDate, end_date: endDate }, data ?? [], data?.length ?? 0);
}

async function followupQueue(context: NikkyContext, args: Record<string, unknown>) {
  const timing = text(args.timing);
  assertIsoDate(args.through_date, "through_date");
  const boundary = `${args.through_date}T23:59:59.999Z`;
  let query = context.supabase
    .from("scheduled_followups")
    .select("id,member_id,followup_label,scheduled_for,status,channel")
    .eq("org_id", context.organizationId)
    .eq("status", "pending")
    .is("archived_at", null)
    .order("scheduled_for")
    .limit(100);
  query = timing === "overdue" ? query.lt("scheduled_for", new Date().toISOString()) : query.gte("scheduled_for", new Date().toISOString()).lte("scheduled_for", boundary);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const memberIds = [...new Set((data ?? []).map((row) => String(row.member_id)))];
  const { data: members } = memberIds.length
    ? await context.supabase.from("members").select("id,first_name,last_name").eq("org_id", context.organizationId).in("id", memberIds).in("status", ["active", "archived"])
    : { data: [] };
  const names = new Map((members ?? []).map((member) => [String(member.id), `${member.first_name} ${member.last_name ?? ""}`.trim()]));
  return result(data?.length ? "ok" : "no_records", { timing, through_date: args.through_date }, (data ?? []).map((row) => ({
    id: row.id, member_id: row.member_id, member_name: names.get(String(row.member_id)) ?? "Member",
    label: row.followup_label, scheduled_for: row.scheduled_for, status: row.status, channel: row.channel,
  })), data?.length ?? 0);
}

async function followupHistory(context: NikkyContext, args: Record<string, unknown>) {
  const memberId = text(args.member_id);
  const member = await canonicalMember(context, memberId);
  if (!member) return result("no_records", { member_resolved: false }, null, 0);
  const [scheduled, sent] = await Promise.all([
    context.supabase.from("scheduled_followups").select("id,followup_label,scheduled_for,status,sent_at,cancelled_at,channel").eq("org_id", context.organizationId).eq("member_id", memberId).order("scheduled_for", { ascending: false }).limit(100),
    context.supabase.from("followup_emails").select("id,provider,created_at").eq("org_id", context.organizationId).eq("member_id", memberId).order("created_at", { ascending: false }).limit(100),
  ]);
  if (scheduled.error) throw new Error(scheduled.error.message);
  if (sent.error) throw new Error(sent.error.message);
  const count = (scheduled.data?.length ?? 0) + (sent.data?.length ?? 0);
  return result(count ? "ok" : "no_records", { member_resolved: true }, {
    member: { id: member.id, name: `${member.first_name} ${member.last_name ?? ""}`.trim() },
    scheduled: scheduled.data ?? [], sent: sent.data ?? [],
  }, count);
}

async function scheduleRows(context: NikkyContext, args: Record<string, unknown>) {
  const { startDate, endDate } = assertDateRange(args.start_date, args.end_date);
  let query = context.supabase
    .from("schedule_entries")
    .select("id,date,service_category_id,department_category_id,role,name,status")
    .eq("org_id", context.organizationId)
    .gte("date", startDate)
    .lte("date", endDate)
    .in("status", ["approved", "pending"])
    .order("date")
    .limit(100);
  const assignee = text(args.assignee_name);
  if (assignee) query = query.ilike("name", `%${assignee.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const ids = (data ?? []).flatMap((row) => [String(row.service_category_id ?? ""), String(row.department_category_id ?? "")]);
  const names = await categoryNames(context, ids);
  return result(data?.length ? "ok" : "no_records", {
    start_date: startDate, end_date: endDate, assignee_filter: Boolean(assignee),
  }, (data ?? []).map((row) => ({
    id: row.id, date: row.date, service: names.get(String(row.service_category_id)) ?? "Unspecified",
    department: names.get(String(row.department_category_id)) ?? "Unspecified", role: row.role,
    assignee: row.name, status: row.status,
  })), data?.length ?? 0);
}

async function coverageGaps(context: NikkyContext, args: Record<string, unknown>) {
  const { startDate, endDate } = assertDateRange(args.start_date, args.end_date);
  const { data: requirements, error } = await context.supabase
    .from("schedule_coverage_requirements")
    .select("id,requirement_date,service_category_id,department_category_id,role,required_count")
    .eq("org_id", context.organizationId)
    .gte("requirement_date", startDate)
    .lte("requirement_date", endDate)
    .order("requirement_date");
  if (error) throw new Error(error.message);
  if (!requirements?.length) return result("unavailable", { start_date: startDate, end_date: endDate }, null, 0,
    "No schedule coverage requirements are configured for that range.");
  const { data: entries, error: entryError } = await context.supabase
    .from("schedule_entries")
    .select("date,service_category_id,department_category_id,role,status")
    .eq("org_id", context.organizationId)
    .gte("date", startDate)
    .lte("date", endDate)
    .in("status", ["approved", "pending"]);
  if (entryError) throw new Error(entryError.message);
  const key = (date: string, service: unknown, department: unknown, role: unknown) => `${date}|${service}|${department}|${role}`;
  const approved = new Map<string, number>();
  const pending = new Map<string, number>();
  for (const row of entries ?? []) {
    const map = row.status === "approved" ? approved : pending;
    const k = key(String(row.date), row.service_category_id, row.department_category_id, row.role);
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  const ids = requirements.flatMap((row) => [String(row.service_category_id), String(row.department_category_id)]);
  const names = await categoryNames(context, ids);
  const rows = requirements.map((row) => {
    const k = key(String(row.requirement_date), row.service_category_id, row.department_category_id, row.role);
    const approvedCount = approved.get(k) ?? 0;
    return {
      date: row.requirement_date,
      service: names.get(String(row.service_category_id)) ?? "Service",
      department: names.get(String(row.department_category_id)) ?? "Department",
      role: row.role,
      required: row.required_count,
      approved: approvedCount,
      pending: pending.get(k) ?? 0,
      shortfall: Math.max(0, Number(row.required_count) - approvedCount),
    };
  }).filter((row) => row.shortfall > 0);
  return result(rows.length ? "ok" : "no_records", { start_date: startDate, end_date: endDate }, rows, rows.length,
    rows.length ? undefined : "All configured schedule requirements are covered.");
}

async function individualGiving(context: NikkyContext, args: Record<string, unknown>) {
  if (context.role === "finance") {
    return result("forbidden", {}, null, 0, "Finance users cannot access individual giving through Nikky.");
  }
  const memberId = text(args.member_id);
  const member = await canonicalMember(context, memberId);
  if (!member) return result("no_records", { member_resolved: false }, null, 0);
  const { startDate, endDate } = assertDateRange(args.start_date, args.end_date);
  const { data, error } = await context.supabase
    .from("income_entries")
    .select("session_date,income_category_id,service_category_id,payment_method,amount_cents,entry_type")
    .eq("org_id", context.organizationId)
    .eq("member_id", memberId)
    .gte("session_date", startDate)
    .lte("session_date", endDate)
    .order("session_date", { ascending: false })
    .limit(5000);
  if (error) throw new Error(error.message);
  const total = (data ?? []).reduce((sum, row) => sum + Number(row.amount_cents), 0);
  const categoryIds = (data ?? []).map((row) => String(row.income_category_id ?? "")).filter(Boolean);
  const names = await categoryNames(context, categoryIds);
  const categories = new Map<string, { category_id: string | null; category: string; total_cents: number; record_count: number }>();
  for (const row of data ?? []) {
    const categoryId = row.income_category_id ? String(row.income_category_id) : "uncategorized";
    const current = categories.get(categoryId) ?? {
      category_id: categoryId === "uncategorized" ? null : categoryId,
      category: categoryId === "uncategorized" ? "Uncategorized" : names.get(categoryId) ?? "Unknown category",
      total_cents: 0,
      record_count: 0,
    };
    current.total_cents += Number(row.amount_cents);
    current.record_count += 1;
    categories.set(categoryId, current);
  }
  const categoryBreakdown = [...categories.values()].sort((a, b) => b.total_cents - a.total_cents);
  return result(data?.length ? "ok" : "no_records", { member_resolved: true, start_date: startDate, end_date: endDate }, {
    member: { id: member.id, name: `${member.first_name} ${member.last_name ?? ""}`.trim() },
    total_cents: total,
    category_breakdown: categoryBreakdown,
    rows: (data ?? []).slice(0, 100), rows_limited_to: 100,
    total_matching_rows: data?.length ?? 0,
  }, data?.length ?? 0);
}

type GivingEntry = {
  session_date: unknown;
  member_id: unknown;
  income_category_id: unknown;
  amount_cents: unknown;
  entry_type: unknown;
};

type NamedPatternRow = {
  member_id: string;
  member_name: string;
  [key: string]: unknown;
};

function isoShiftDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isoShiftMonths(value: string, months: number) {
  const [year, month, day] = value.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + months, 1, 12));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0, 12)).getUTCDate();
  first.setUTCDate(Math.min(day, lastDay));
  return first.toISOString().slice(0, 10);
}

function inclusiveDays(start: string, end: string) {
  return Math.round(
    (new Date(`${end}T12:00:00.000Z`).getTime() - new Date(`${start}T12:00:00.000Z`).getTime())
      / 86_400_000,
  ) + 1;
}

function givingSummary(rows: GivingEntry[]) {
  return {
    total_cents: rows.reduce((sum, row) => sum + Number(row.amount_cents ?? 0), 0),
    record_count: rows.length,
    positive_gift_count: rows.filter((row) => Number(row.amount_cents ?? 0) > 0).length,
    giving_months: [...new Set(rows
      .filter((row) => Number(row.amount_cents ?? 0) > 0)
      .map((row) => String(row.session_date).slice(0, 7)))].sort(),
  };
}

async function incomeCategory(
  context: NikkyContext,
  categoryId: string | null,
  exactName?: string,
) {
  let query = context.supabase
    .from("categories")
    .select("id,name,status,type")
    .eq("org_id", context.organizationId)
    .eq("type", "income")
    .eq("status", "active");
  if (categoryId) query = query.eq("id", categoryId);
  const { data, error } = await query.limit(100);
  if (error) throw new Error(error.message);
  const matches = exactName
    ? (data ?? []).filter((row) => String(row.name).trim().toLocaleLowerCase() === exactName.toLocaleLowerCase())
    : data ?? [];
  if (matches.length !== 1) return null;
  return matches[0];
}

async function givingEntries(
  context: NikkyContext,
  startDate: string,
  endDate: string,
  categoryId?: string,
) {
  const rows: GivingEntry[] = [];
  for (let offset = 0; offset < 20_000; offset += 1000) {
    let query = context.supabase
      .from("income_entries")
      .select("session_date,member_id,income_category_id,amount_cents,entry_type")
      .eq("org_id", context.organizationId)
      .gte("session_date", startDate)
      .lte("session_date", endDate);
    if (categoryId) query = query.eq("income_category_id", categoryId);
    const { data, error } = await query.order("session_date").range(offset, offset + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as GivingEntry[]));
    if ((data?.length ?? 0) < 1000) break;
  }
  if (rows.length >= 20_000) throw new Error("Giving analysis exceeds the safe 20,000-row limit. Narrow the date range.");
  return rows;
}

export async function prepareMemberGivingReportSelection(
  context: NikkyContext,
  args: Record<string, unknown>,
) {
  const { startDate, endDate } = assertDateRange(args.start_date, args.end_date);
  enforceFinanceWindow(context, startDate);
  const categoryName = text(args.category_name);
  if (!categoryName) throw new Error("Enter an exact income category name.");
  const includeArchived = args.include_archived === true;

  const { data: categoryRows, error: categoryError } = await context.supabase
    .from("categories")
    .select("id,name,status,type")
    .eq("org_id", context.organizationId)
    .eq("type", "income")
    .eq("status", "active")
    .limit(100);
  if (categoryError) throw new Error(categoryError.message);
  const categoryMatches = (categoryRows ?? []).filter(
    (row) => String(row.name).trim().toLocaleLowerCase() === categoryName.toLocaleLowerCase(),
  );
  if (categoryMatches.length !== 1) {
    return result(
      categoryMatches.length > 1 ? "ambiguous" : "no_records",
      { start_date: startDate, end_date: endDate, category_name: categoryName, include_archived: includeArchived },
      categoryMatches.map((row) => ({ category_id: row.id, category: row.name })),
      categoryMatches.length,
      categoryMatches.length > 1
        ? "More than one active income category has that exact name. Ask the user to choose the category."
        : "No active income category matched that exact name.",
    );
  }

  const category = categoryMatches[0];
  const entries = await givingEntries(context, startDate, endDate, String(category.id));
  const contributorIds = [...new Set(entries
    .map((entry) => entry.member_id ? String(entry.member_id) : "")
    .filter(Boolean))];
  if (contributorIds.length > 500) {
    return result(
      "unavailable",
      { start_date: startDate, end_date: endDate, category_id: category.id, category: category.name, include_archived: includeArchived },
      null,
      contributorIds.length,
      "That report would include more than 500 identifiable members. Narrow the date range.",
    );
  }

  const members: Array<{ id: string; first_name: string | null; last_name: string | null; status: string }> = [];
  for (let offset = 0; offset < contributorIds.length; offset += 100) {
    const batch = contributorIds.slice(offset, offset + 100);
    const { data, error } = await context.supabase
      .from("members")
      .select("id,first_name,last_name,status,membership_stage")
      .eq("org_id", context.organizationId)
      .eq("membership_stage", "member")
      .in("status", includeArchived ? ["active", "archived"] : ["active"])
      .in("id", batch);
    if (error) throw new Error(error.message);
    members.push(...((data ?? []) as typeof members));
  }
  members.sort((a, b) => {
    const aName = `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim();
    const bName = `${b.first_name ?? ""} ${b.last_name ?? ""}`.trim();
    return aName.localeCompare(bName) || a.id.localeCompare(b.id);
  });
  const anonymousEntryCount = entries.filter((entry) => !entry.member_id).length;
  const selectedMemberIds = new Set(members.map((member) => member.id));
  const selectedIdentifiableEntryCount = entries.filter(
    (entry) => entry.member_id && selectedMemberIds.has(String(entry.member_id)),
  ).length;

  return result(
    members.length ? "ok" : "no_records",
    {
      start_date: startDate,
      end_date: endDate,
      category_id: category.id,
      category: category.name,
      include_archived: includeArchived,
    },
    {
      category: { id: category.id, name: category.name },
      member_ids: members.map((member) => member.id),
      identifiable_entry_count: selectedIdentifiableEntryCount,
      excluded_identifiable_entry_count: entries.length - anonymousEntryCount - selectedIdentifiableEntryCount,
      anonymous_entry_count: anonymousEntryCount,
      interpretation: "Members are included only when an identifiable entry for the selected category was recorded in the applied period. Merged tombstones and visitors are excluded.",
    },
    members.length,
    members.length ? undefined : "No canonical members had identifiable giving recorded for that category and period.",
  );
}

function memberGivingMap(rows: GivingEntry[]) {
  const map = new Map<string, GivingEntry[]>();
  for (const row of rows) {
    if (!row.member_id) continue;
    const memberId = String(row.member_id);
    map.set(memberId, [...(map.get(memberId) ?? []), row]);
  }
  return map;
}

export async function regularTitheActivity(
  context: NikkyContext,
  args: Record<string, unknown>,
) {
  const analysis = text(args.analysis);
  if (!["no_recent_tithe", "reduced_tithe"].includes(analysis)) throw new Error("Invalid Tithe analysis.");
  const current = assertDateRange(args.current_start, args.current_end);
  const page = requestedPage(args);
  const tithe = await incomeCategory(context, null, "Tithe");
  if (!tithe) {
    return result("unavailable", {
      analysis,
      current: { start_date: current.startDate, end_date: current.endDate },
      page,
    }, null, 0, "Nikky could not resolve exactly one active Tithe income category.");
  }
  let baseline: ReturnType<typeof assertDateRange> | null = null;
  if (analysis === "reduced_tithe") {
    baseline = assertDateRange(args.baseline_start, args.baseline_end);
    if (baseline.endDate >= current.startDate) {
      throw new Error("The Tithe baseline period must end before the current period begins.");
    }
    if (inclusiveDays(baseline.startDate, baseline.endDate) !== inclusiveDays(current.startDate, current.endDate)) {
      throw new Error("Baseline and current Tithe periods must contain the same number of calendar dates.");
    }
  } else if (args.baseline_start !== null || args.baseline_end !== null) {
    throw new Error("Baseline dates must be null for a no-recent-Tithe analysis.");
  }
  const historyStart = isoShiftMonths(current.startDate, -12);
  const historyEnd = isoShiftDays(current.startDate, -1);
  const earliest = [historyStart, baseline?.startDate ?? current.startDate, current.startDate].sort()[0];
  const entries = await givingEntries(context, earliest, current.endDate, String(tithe.id));
  const historyRows = entries.filter((row) =>
    String(row.session_date) >= historyStart && String(row.session_date) <= historyEnd && Number(row.amount_cents) > 0);
  const currentRows = entries.filter((row) =>
    String(row.session_date) >= current.startDate && String(row.session_date) <= current.endDate);
  const baselineRows = baseline
    ? entries.filter((row) => String(row.session_date) >= baseline!.startDate && String(row.session_date) <= baseline!.endDate)
    : [];
  const historyByMember = memberGivingMap(historyRows);
  const currentByMember = memberGivingMap(currentRows);
  const baselineByMember = memberGivingMap(baselineRows);
  const members = await activeCanonicalMembers(context);
  const memberById = new Map(members.map((member) => [String(member.id), member]));
  const eligible = [...historyByMember.entries()].filter(([memberId, rows]) =>
    memberById.has(memberId) && givingSummary(rows).giving_months.length >= 3);
  const rows: NamedPatternRow[] = [];
  for (const [memberId, history] of eligible) {
    const member = memberById.get(memberId)!;
    const historySummary = givingSummary(history);
    const currentSummary = givingSummary(currentByMember.get(memberId) ?? []);
    const baselineSummary = givingSummary(baselineByMember.get(memberId) ?? []);
    if (analysis === "no_recent_tithe") {
      if (currentSummary.record_count !== 0) continue;
      rows.push({
        member_id: memberId,
        member_name: memberName(member),
        prior_tithe_months: historySummary.giving_months.length,
        recent: currentSummary,
        reason: "No identifiable Tithe entry was recorded in the requested recent period.",
      });
      continue;
    }
    const decline = baselineSummary.total_cents - currentSummary.total_cents;
    if (baselineSummary.total_cents <= 0 || currentSummary.total_cents > baselineSummary.total_cents * 0.5 || decline < 10_000) {
      continue;
    }
    rows.push({
      member_id: memberId,
      member_name: memberName(member),
      prior_tithe_months: historySummary.giving_months.length,
      baseline: baselineSummary,
      current: currentSummary,
      decline_cents: decline,
      decline_percent: decline / baselineSummary.total_cents * 100,
      reason: "Identifiable Tithe decreased by at least 50% and $100 across equal periods.",
    });
  }
  rows.sort((a, b) => a.member_name.localeCompare(b.member_name));
  const anonymousCurrent = currentRows.filter((row) => !row.member_id);
  return result(rows.length ? "ok" : "no_records", {
    analysis,
    category_id: tithe.id,
    category: tithe.name,
    history: { start_date: historyStart, end_date: historyEnd, minimum_distinct_months: 3 },
    baseline: baseline ? { start_date: baseline.startDate, end_date: baseline.endDate } : null,
    current: { start_date: current.startDate, end_date: current.endDate },
    page,
  }, {
    matches: pageRows(rows, page),
    eligible_regular_tithe_giver_count: eligible.length,
    anonymous_baseline_tithe: baseline ? givingSummary(baselineRows.filter((row) => !row.member_id)) : null,
    anonymous_recent_tithe: givingSummary(anonymousCurrent),
    interpretation: "Results describe identifiable Church Admin Tithe records, not a person's actual tithing behavior.",
  }, rows.length);
}

function isFullCalendarMonthRange(startDate: string, endDate: string) {
  if (!startDate.endsWith("-01")) return false;
  const nextMonth = isoShiftMonths(startDate, calendarMonths(startDate, endDate).length);
  return endDate === isoShiftDays(nextMonth, -1);
}

export async function donorGivingPatterns(
  context: NikkyContext,
  args: Record<string, unknown>,
) {
  const analysis = text(args.analysis);
  if (!["reduced_amount", "frequency_change", "stopped_recurring"].includes(analysis)) {
    throw new Error("Invalid donor pattern analysis.");
  }
  const baseline = assertDateRange(args.baseline_start, args.baseline_end);
  const current = assertDateRange(args.current_start, args.current_end);
  if (baseline.endDate >= current.startDate) {
    throw new Error("The giving baseline period must end before the current period begins.");
  }
  if (inclusiveDays(baseline.startDate, baseline.endDate) !== inclusiveDays(current.startDate, current.endDate)) {
    throw new Error("Baseline and current giving periods must contain the same number of calendar dates.");
  }
  const page = requestedPage(args);
  const categoryId = args.category_id === null ? null : text(args.category_id);
  let category: { id: unknown; name: unknown } | null = null;
  if (categoryId) {
    category = await incomeCategory(context, categoryId);
    if (!category) throw new Error("The selected active income category was not found in this organization.");
  }
  const earliest = [baseline.startDate, current.startDate].sort()[0];
  const latest = [baseline.endDate, current.endDate].sort().at(-1)!;
  const entries = await givingEntries(context, earliest, latest, categoryId || undefined);
  const baselineRows = entries.filter((row) =>
    String(row.session_date) >= baseline.startDate && String(row.session_date) <= baseline.endDate);
  const currentRows = entries.filter((row) =>
    String(row.session_date) >= current.startDate && String(row.session_date) <= current.endDate);
  const baselineByMember = memberGivingMap(baselineRows);
  const currentByMember = memberGivingMap(currentRows);
  const members = await activeCanonicalMembers(context);
  const memberById = new Map(members.map((member) => [String(member.id), member]));
  const baselineMonths = calendarMonths(baseline.startDate, baseline.endDate);
  const requiresRecurring = analysis !== "frequency_change";
  if (requiresRecurring && (baselineMonths.length < 3 || !isFullCalendarMonthRange(baseline.startDate, baseline.endDate))) {
    throw new Error("Recurring-donor analysis requires a baseline of at least three complete calendar months.");
  }
  const candidateIds = [...new Set([...baselineByMember.keys(), ...currentByMember.keys()])]
    .filter((memberId) => memberById.has(memberId));
  const rows = candidateIds.flatMap((memberId) => {
    const member = memberById.get(memberId)!;
    const baselineSummary = givingSummary(baselineByMember.get(memberId) ?? []);
    const currentSummary = givingSummary(currentByMember.get(memberId) ?? []);
    const recurring = baselineMonths.every((month) => baselineSummary.giving_months.includes(month));
    if (requiresRecurring && !recurring) return [];
    if (analysis === "reduced_amount") {
      const decline = baselineSummary.total_cents - currentSummary.total_cents;
      if (baselineSummary.total_cents <= 0 || currentSummary.total_cents > baselineSummary.total_cents * 0.5 || decline < 10_000) return [];
      return [{
        member_id: memberId,
        member_name: memberName(member),
        baseline: baselineSummary,
        current: currentSummary,
        change_cents: currentSummary.total_cents - baselineSummary.total_cents,
        change_percent: (currentSummary.total_cents - baselineSummary.total_cents) / baselineSummary.total_cents * 100,
        reason: "Identifiable giving decreased by at least 50% and $100 across equal periods.",
      }];
    }
    if (analysis === "stopped_recurring") {
      if (currentSummary.positive_gift_count !== 0) return [];
      return [{
        member_id: memberId,
        member_name: memberName(member),
        baseline: baselineSummary,
        current: currentSummary,
        reason: "The member gave in every baseline month and has no identifiable positive gift in the current period.",
      }];
    }
    const frequencyChange = currentSummary.positive_gift_count - baselineSummary.positive_gift_count;
    if (Math.abs(frequencyChange) < 3) return [];
    return [{
      member_id: memberId,
      member_name: memberName(member),
      baseline: baselineSummary,
      current: currentSummary,
      frequency_change: frequencyChange,
      direction: frequencyChange > 0 ? "increase" : "decrease",
      reason: "Identifiable positive-gift frequency changed by at least three transactions.",
    }];
  }).sort((a, b) => a.member_name.localeCompare(b.member_name));
  return result(rows.length ? "ok" : "no_records", {
    analysis,
    category_id: category?.id ?? null,
    category: category?.name ?? "All income categories",
    baseline: { start_date: baseline.startDate, end_date: baseline.endDate },
    current: { start_date: current.startDate, end_date: current.endDate },
    amount_decline_threshold: analysis === "reduced_amount" ? { percent: 50, cents: 10_000 } : null,
    frequency_change_threshold: analysis === "frequency_change" ? 3 : null,
    page,
  }, {
    matches: pageRows(rows, page),
    anonymous_baseline_giving: givingSummary(baselineRows.filter((row) => !row.member_id)),
    anonymous_current_giving: givingSummary(currentRows.filter((row) => !row.member_id)),
    interpretation: "Results describe identifiable Church Admin giving records only.",
  }, rows.length);
}

export async function executeDataTool(
  context: NikkyContext,
  conversationId: string,
  name: string,
  args: Record<string, unknown>,
) {
  const started = Date.now();
  let output: NikkyToolResult;
  try {
    if (!canUseNikkyDataTool(context, name)) {
      output = result("forbidden", {}, null, 0,
        "This named member cohort analysis is available only to organization owners and admins.");
    }
    else if (name === "financial_summary") output = await financialSummary(context, args);
    else if (name === "compare_financial_periods") output = await financialComparison(context, args);
    else if (name === "income_breakdown") output = await breakdown(context, args, "income");
    else if (name === "income_monthly_breakdown") output = await incomeMonthlyBreakdown(context, args);
    else if (name === "expense_breakdown") output = await breakdown(context, args, "expense");
    else if (name === "giving_demographic_summary") output = await givingDemographicSummary(context, args);
    else if (name === "search_members") output = await searchMembers(context, args);
    else if (name === "member_profile") output = await memberProfile(context, args);
    else if (name === "member_milestone_summary") output = await memberMilestoneSummary(context, args);
    else if (name === "member_population_summary") output = await memberPopulationSummary(context);
    else if (name === "attendance_summary") output = await attendanceSummary(context, args, false);
    else if (name === "attendance_trends") output = await attendanceSummary(context, args, true);
    else if (name === "attendance_monthly_summary") output = await attendanceMonthlySummary(context, args);
    else if (name === "attendance_demographic_summary") output = await attendanceDemographicSummary(context, args);
    else if (name === "attendance_demographic_breakdown") output = await attendanceDemographicBreakdown(context, args);
    else if (name === "member_attendance_history") output = await memberAttendanceHistory(context, args);
    else if (name === "members_attendance_history") output = await membersAttendanceHistory(context, args);
    else if (name === "absent_members") output = await absentMembers(context, args);
    else if (name === "sunday_member_checkins") output = await sundayMemberCheckins(context, args);
    else if (name === "attendance_member_changes") output = await attendanceMemberChanges(context, args);
    else if (name === "attendance_inconsistency") output = await attendanceInconsistency(context, args);
    else if (name === "attendance_pastoral_candidates") output = await attendancePastoralCandidates(context, args);
    else if (name === "visitor_list") output = await visitorList(context, args);
    else if (name === "followup_queue") output = await followupQueue(context, args);
    else if (name === "followup_history") output = await followupHistory(context, args);
    else if (name === "upcoming_schedules" || name === "schedule_assignments") output = await scheduleRows(context, args);
    else if (name === "schedule_coverage_gaps") output = await coverageGaps(context, args);
    else if (name === "individual_giving") output = await individualGiving(context, args);
    else if (name === "prepare_member_giving_report_selection") output = await prepareMemberGivingReportSelection(context, args);
    else if (name === "regular_tithe_activity") output = await regularTitheActivity(context, args);
    else if (name === "donor_giving_patterns") output = await donorGivingPatterns(context, args);
    else throw new Error("Unknown or unauthorized Nikky tool.");

    const identifiableFinancial = ["individual_giving", "prepare_member_giving_report_selection", "regular_tithe_activity", "donor_giving_patterns"].includes(name);
    const attendanceCohort = [
      "members_attendance_history",
      "absent_members",
      "sunday_member_checkins",
      "attendance_member_changes",
      "attendance_inconsistency",
      "attendance_pastoral_candidates",
    ].includes(name);
    await appendNikkyAudit(context, {
      conversationId,
      toolName: name,
      requested: safeAuditParameters(args),
      applied: output.applied,
      authorizationOutcome: output.outcome === "forbidden" ? "denied" : "allowed",
      outcome: output.outcome,
      classifications: identifiableFinancial
        ? [name === "individual_giving" ? "financial_identifiable_individual" : "financial_identifiable_cohort"]
        : attendanceCohort ? ["member_attendance_sensitive"] : name.includes("financial") || name.includes("income") || name.includes("expense") || name.includes("giving")
          ? ["financial_aggregate"]
          : [name],
      recordCount: output.record_count,
      durationMs: Date.now() - started,
      memberId: text(args.member_id) || undefined,
    });
    return output;
  } catch (error) {
    const outside = error instanceof Error && error.name === "OutsideFinanceWindowError";
    output = result(outside ? "outside_finance_window" : "calculation_failed", safeAuditParameters(args), null, 0,
      error instanceof Error ? error.message : "Tool failed.");
    await appendNikkyAudit(context, {
      conversationId,
      toolName: name,
      requested: safeAuditParameters(args),
      applied: output.applied,
      authorizationOutcome: outside ? "denied" : "allowed",
      outcome: output.outcome,
      errorCode: outside ? "outside_finance_window" : "tool_error",
      recordCount: 0,
      durationMs: Date.now() - started,
      memberId: text(args.member_id) || undefined,
    });
    return output;
  }
}
