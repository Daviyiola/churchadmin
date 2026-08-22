// lib/server/reports/memberGiving.ts
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getReportRequestContext,
  requireReportRoles,
  requireValidReportDateRange,
} from "@/lib/server/reports/requestSupabase";
import type {
  RunMemberGivingBody,
  MemberGivingReport,
  Branding,
  PaymentMethod,
  MemberGivingMode,
} from "@/lib/reports/members/types";

type OrgSettingsRow = {
  organization_id: string;
  logo_path: string | null;
  use_default_logo: boolean;
  report_header_text: string | null;
  report_subheader_text: string | null;
};

type MemberRow = { id: string; first_name: string; last_name: string };

type CategoryRow = {
  id: string;
  name: string;
  type: "income" | "expense" | "services";
  status: "active" | "archived";
};

type IncomeEntryRow = {
  id: string;
  session_date: string;
  service_category_id: string;
  member_id: string;
  income_category_id: string;
  payment_method: PaymentMethod;
  amount_cents: number;
  entry_type: "normal" | "adjustment";
};

function isNonEmptyArray<T>(v: T[] | undefined | null): v is T[] {
  return Array.isArray(v) && v.length > 0;
}

function dollarsFromCents(cents: number): number {
  return Number(cents ?? 0) / 100;
}

function yyyymmLabel(ym: string): string {
  const [y, m] = ym.split("-");
  const monthIndex = Number(m) - 1;
  const d = new Date(Number(y), monthIndex, 1);
  return d.toLocaleString(undefined, { month: "long", year: "numeric" });
}

function memberName(m: MemberRow): string {
  const last = (m.last_name ?? "").trim();
  const first = (m.first_name ?? "").trim();
  const base = [last, first].filter(Boolean).join(", ");
  return base || "Unknown member";
}

function uniqueMemberIds(body: RunMemberGivingBody) {
  const ids = body.member_ids?.length
    ? body.member_ids
    : body.member_id
      ? [body.member_id]
      : [];
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

function monthKeys(start: string, end: string) {
  const keys: string[] = [];
  const [startYear, startMonth] = start.split("-").map(Number);
  const [endYear, endMonth] = end.split("-").map(Number);
  let year = startYear;
  let month = startMonth;
  while (year < endYear || (year === endYear && month <= endMonth)) {
    keys.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
  return keys;
}

async function fetchIncomeEntries(
  supabase: SupabaseClient,
  orgId: string,
  memberIds: string[],
  body: RunMemberGivingBody,
) {
  const rows: IncomeEntryRow[] = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    let query = supabase
      .from("income_entries")
      .select("id,session_date,service_category_id,member_id,income_category_id,payment_method,amount_cents,entry_type")
      .eq("org_id", orgId)
      .in("member_id", memberIds)
      .gte("session_date", body.start_date)
      .lte("session_date", body.end_date);

    if (isNonEmptyArray(body.service_ids)) query = query.in("service_category_id", body.service_ids);
    if (isNonEmptyArray(body.category_ids)) query = query.in("income_category_id", body.category_ids);
    if (isNonEmptyArray(body.payment_methods)) query = query.in("payment_method", body.payment_methods);

    const { data, error } = await query
      .order("session_date", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);

    const page = (data ?? []) as unknown as IncomeEntryRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
    if (rows.length >= 50_000) {
      throw new Error("This report exceeds the safe 50,000-entry limit. Narrow the date range or member selection.");
    }
  }

  return rows;
}

async function getBranding(
  supabase: SupabaseClient,
  orgId: string,
): Promise<Branding> {
  const { data: org, error: orgErr } = await supabase
    .from("organizations")
    .select("id,name")
    .eq("id", orgId)
    .maybeSingle<{ id: string; name: string }>();

  if (orgErr) throw new Error(orgErr.message);

  const { data: s, error: sErr } = await supabase
    .from("organization_settings")
    .select("organization_id,logo_path,use_default_logo,report_header_text,report_subheader_text")
    .eq("organization_id", orgId)
    .maybeSingle();

  if (sErr) throw new Error(sErr.message);

  const settings = (s ?? null) as OrgSettingsRow | null;

  let logo_url: string | null = null;
  if (settings && !settings.use_default_logo && settings.logo_path) {
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from("org-logos")
      .createSignedUrl(settings.logo_path, 60 * 60);
    if (signErr) throw new Error(signErr.message);
    logo_url = signed?.signedUrl ?? null;
  }

  const orgName = (org?.name ?? "Organization").trim() || "Organization";

  return {
    logo_url,
    header_text: settings?.report_header_text ?? orgName,
    subheader_text: settings?.report_subheader_text ?? "Member giving report",
    generated_at_iso: new Date().toISOString(),
  };
}

async function getIncomeCategoryNameMap(
  supabase: SupabaseClient,
  orgId: string,
) {
  const { data, error } = await supabase
    .from("categories")
    .select("id,name,type,status")
    .eq("org_id", orgId)
    .eq("type", "income");

  if (error) throw new Error(error.message);

  const map = new Map<string, string>();
  for (const r of (data ?? []) as unknown as CategoryRow[]) {
    map.set(r.id, r.name);
  }
  return map;
}

export async function runMemberGivingReportFromToken(
  body: RunMemberGivingBody,
  accessToken: string,
): Promise<MemberGivingReport> {
  requireValidReportDateRange(body.start_date, body.end_date);

  const { supabase, role } = await getReportRequestContext(
    accessToken,
    body.organization_id,
  );
  requireReportRoles(role, ["owner", "admin"]);

  const memberIds = uniqueMemberIds(body);
  if (memberIds.length === 0) throw new Error("Select at least one member.");
  if (memberIds.length > 500) throw new Error("Select no more than 500 members per report.");
  if (body.mode !== "monthly" && memberIds.length !== 1) {
    throw new Error("Summary and detailed reports require exactly one member.");
  }

  // --- Members ---
  const { data: memberRows, error: mem2Err } = await supabase
    .from("members")
    .select("id,first_name,last_name")
    .eq("org_id", body.organization_id)
    .in("id", memberIds)
    .in("status", ["active", "archived"]);

  if (mem2Err) throw new Error(mem2Err.message);
  const members = ((memberRows ?? []) as unknown as MemberRow[])
    .map((member) => ({ ...member, name: memberName(member) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (members.length !== memberIds.length) {
    throw new Error("One or more selected members are unavailable, merged, or outside this organization.");
  }
  const member = members[0];

  const branding = await getBranding(supabase, body.organization_id);
  const categoryNameById = await getIncomeCategoryNameMap(
    supabase,
    body.organization_id,
  );

  const entries = await fetchIncomeEntries(
    supabase,
    body.organization_id,
    memberIds,
    body,
  );

  const start = body.start_date;
  const end = body.end_date;
  const view: MemberGivingMode = body.mode;

  if (view === "monthly") {
    const requestedCategoryIds = isNonEmptyArray(body.category_ids)
      ? [...new Set(body.category_ids)]
      : [...new Set(entries.map((entry) => entry.income_category_id))];
    const categories = requestedCategoryIds
      .map((id) => ({ id, name: categoryNameById.get(id) }))
      .filter((category): category is { id: string; name: string } => Boolean(category.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (categories.length !== requestedCategoryIds.length) {
      throw new Error("One or more selected income categories are unavailable or outside this organization.");
    }

    const amountByMonthMemberCategory = new Map<string, number>();
    const amountByMemberCategory = new Map<string, number>();
    for (const entry of entries) {
      const key = `${entry.session_date.slice(0, 7)}:${entry.member_id}:${entry.income_category_id}`;
      amountByMonthMemberCategory.set(
        key,
        (amountByMonthMemberCategory.get(key) ?? 0) + dollarsFromCents(entry.amount_cents),
      );
      const totalKey = `${entry.member_id}:${entry.income_category_id}`;
      amountByMemberCategory.set(
        totalKey,
        (amountByMemberCategory.get(totalKey) ?? 0) + dollarsFromCents(entry.amount_cents),
      );
    }

    const months = monthKeys(start, end).map((key) => {
      const monthStart = `${key}-01`;
      const [year, month] = key.split("-").map(Number);
      const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
      const covered_start = monthStart < start ? start : monthStart;
      const covered_end = monthEnd > end ? end : monthEnd;
      const rows = members.map((selectedMember) => {
        const category_amounts = Object.fromEntries(
          categories.map((category) => [
            category.id,
            amountByMonthMemberCategory.get(`${key}:${selectedMember.id}:${category.id}`) ?? 0,
          ]),
        );
        return {
          member_id: selectedMember.id,
          member_name: selectedMember.name,
          category_amounts,
          total: Object.values(category_amounts).reduce((sum, amount) => sum + amount, 0),
        };
      });
      const category_totals = Object.fromEntries(
        categories.map((category) => [
          category.id,
          rows.reduce((sum, row) => sum + (row.category_amounts[category.id] ?? 0), 0),
        ]),
      );
      return {
        key,
        label: yyyymmLabel(key),
        covered_start,
        covered_end,
        rows,
        category_totals,
        subtotal: Object.values(category_totals).reduce((sum, amount) => sum + amount, 0),
      };
    });

    const member_totals = members.map((selectedMember) => {
      const category_amounts = Object.fromEntries(
        categories.map((category) => [
          category.id,
          amountByMemberCategory.get(`${selectedMember.id}:${category.id}`) ?? 0,
        ]),
      );
      return {
        member_id: selectedMember.id,
        member_name: selectedMember.name,
        category_amounts,
        total: Object.values(category_amounts).reduce((sum, amount) => sum + amount, 0),
      };
    });
    const category_totals = Object.fromEntries(
      categories.map((category) => [
        category.id,
        member_totals.reduce((sum, row) => sum + (row.category_amounts[category.id] ?? 0), 0),
      ]),
    );

    return {
      ok: true,
      mode: "member_giving",
      branding,
      meta: { role, view: "monthly" },
      members: members.map(({ id, name }) => ({ id, name })),
      period: { start, end },
      monthly: {
        categories,
        months,
        member_totals,
        category_totals,
        grand_total: Object.values(category_totals).reduce((sum, amount) => sum + amount, 0),
      },
    };
  }

  // ======================
  // SUMMARY
  // ======================
  if (view === "summary") {
    const sums = new Map<string, number>();

    for (const e of entries) {
      const cid = e.income_category_id;
      const add = dollarsFromCents(e.amount_cents);
      sums.set(cid, (sums.get(cid) ?? 0) + add);
    }

    const rows = Array.from(sums.entries())
      .map(([category_id, amount]) => ({
        category_id,
        category_name: categoryNameById.get(category_id) ?? "Unknown category",
        amount,
      }))
      .filter((r) => Math.abs(r.amount) > 0.000001)
      .sort((a, b) => a.category_name.localeCompare(b.category_name));

    const grand_total = rows.reduce((acc, r) => acc + r.amount, 0);

    return {
      ok: true,
      mode: "member_giving",
      branding,
      meta: { role, view: "summary" },
      member: { id: member.id, name: member.name },
      period: { start, end },
      summary: { rows, grand_total },
    };
  }

  // ======================
  // DETAILED
  // ======================
  const txRows = entries
    .map((e) => ({
      date: e.session_date,
      category_id: e.income_category_id,
      category_name: categoryNameById.get(e.income_category_id) ?? "Unknown category",
      payment_method: e.payment_method,
      amount: dollarsFromCents(e.amount_cents),
      entry_type: e.entry_type,
    }))
    .filter((r) => Math.abs(r.amount) > 0.000001);

  const monthMap = new Map<string, typeof txRows>();
  for (const r of txRows) {
    const ym = r.date.slice(0, 7);
    const arr = monthMap.get(ym) ?? [];
    arr.push(r);
    monthMap.set(ym, arr);
  }

  const months = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ym, rows]) => {
      rows.sort((a, b) =>
        a.date !== b.date ? a.date.localeCompare(b.date) : a.category_name.localeCompare(b.category_name),
      );
      const subtotal = rows.reduce((acc, r) => acc + r.amount, 0);
      return { label: yyyymmLabel(ym), rows, subtotal };
    });

  const grand_total = months.reduce((acc, m) => acc + m.subtotal, 0);

  return {
    ok: true,
    mode: "member_giving",
    branding,
    meta: { role, view: "detailed" },
    member: { id: member.id, name: member.name },
    period: { start, end },
    detailed: { months, grand_total },
  };
}
