export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type {
  RunQuickReportBody,
  PaymentMethod,
  AttendanceView,
  IncomeReport,
  ExpenseReport,
  AttendanceReport,
} from "@/lib/reports/quick/types";

type Role = "owner" | "admin" | "finance" | "member";

type OrgRow = { id: string; name: string };

type OrgSettingsRow = {
  organization_id: string;
  logo_path: string | null;
  use_default_logo: boolean;
  report_header_text: string | null;
  report_subheader_text: string | null;
  report_banner_bg_rgb: string | null;
  report_banner_text_rgb: string | null;
};

type UserOrgRow = { role: string };

type CategoryRow = { id: string; name: string; type: string; status: string };

// Segments are stored in DB as: men/women/boys/girls
type Segment = "girls" | "boys" | "women" | "men";
const SEGMENTS: Segment[] = ["girls", "boys", "women", "men"];

type MemberRow = {
  id: string;
  first_name: string;
  last_name: string;
  segment?: Segment; // for attendance detailed
};

function asRole(raw: unknown): Role {
  const v = String(raw);
  if (v === "owner" || v === "admin" || v === "finance" || v === "member")
    return v;
  return "member";
}

function isNonEmptyArray<T>(v: T[] | undefined | null): v is T[] {
  return Array.isArray(v) && v.length > 0;
}

function safeTrim(v: string | null | undefined): string {
  return (v ?? "").trim();
}

function moneyFromCents(cents: number): number {
  return (cents ?? 0) / 100;
}

function makeMemberName(m: MemberRow): string {
  const a = safeTrim(m.last_name);
  const b = safeTrim(m.first_name);
  if (a && b) return `${a}, ${b}`;
  return a || b || "Unknown member";
}

function isNonZero(n: number, eps = 1e-9): boolean {
  return Math.abs(n) > eps;
}

function pickRecord<T extends Record<string, number>>(
  obj: T,
  keys: string[]
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = obj[k] ?? 0;
  return out;
}

async function getCategoryNameMap(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from("categories")
    .select("id,name,type,status")
    .eq("org_id", orgId);

  if (error) throw new Error(error.message);

  const map = new Map<string, CategoryRow>();
  for (const r of (data ?? []) as CategoryRow[]) {
    map.set(r.id, r);
  }
  return map;
}

async function getBranding(orgId: string) {
  const { data: org, error: orgErr } = await supabaseAdmin
    .from("organizations")
    .select("id,name")
    .eq("id", orgId)
    .maybeSingle();

  if (orgErr) throw new Error(orgErr.message);

  const { data: s, error: sErr } = await supabaseAdmin
    .from("organization_settings")
    .select(
      "organization_id,logo_path,use_default_logo,report_header_text,report_subheader_text,report_banner_bg_rgb,report_banner_text_rgb"
    )
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

  const orgName = (org as OrgRow | null)?.name ?? "Organization";

  return {
    logo_url,
    header_text: settings?.report_header_text ?? orgName,
    subheader_text: settings?.report_subheader_text ?? "Report",
    banner_bg_rgb: settings?.report_banner_bg_rgb ?? null,
    banner_text_rgb: settings?.report_banner_text_rgb ?? null,
    generated_at_iso: new Date().toISOString(),
  };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RunQuickReportBody;

    if (
      !body.organization_id ||
      !body.mode ||
      !body.start_date ||
      !body.end_date
    ) {
      return NextResponse.json(
        { error: "organization_id, mode, start_date, end_date are required" },
        { status: 400 }
      );
    }

    // --- Auth header ---
    const authHeader = req.headers.get("authorization") || "";
    const accessToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : null;

    if (!accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // --- Validate user ---
    const { data: userRes, error: userErr } = await supabaseAdmin.auth.getUser(
      accessToken
    );
    if (userErr || !userRes?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = userRes.user.id;

    // --- Membership + role ---
    const { data: membership, error: memErr } = await supabaseAdmin
      .from("user_organizations")
      .select("role")
      .eq("organization_id", body.organization_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (memErr)
      return NextResponse.json({ error: memErr.message }, { status: 400 });
    if (!membership)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const role = asRole((membership as UserOrgRow).role);

    // Shared lookups
    const categoryMap = await getCategoryNameMap(body.organization_id);
    const branding = await getBranding(body.organization_id);

    const categoryNameById = new Map<string, string>();
    for (const c of categoryMap.values()) categoryNameById.set(c.id, c.name);

    // =========================
    // INCOME (pivot)
    // =========================
    if (body.mode === "income") {
      type IncomeEntryRow = {
        session_date: string;
        service_category_id: string;
        member_id: string;
        income_category_id: string;
        payment_method: PaymentMethod;
        amount_cents: number;
        entry_type: "normal" | "adjustment";
      };

      let q = supabaseAdmin
        .from("income_entries")
        .select(
          "session_date,service_category_id,member_id,income_category_id,payment_method,amount_cents,entry_type"
        )
        .eq("org_id", body.organization_id)
        .gte("session_date", body.start_date)
        .lte("session_date", body.end_date);

      if (isNonEmptyArray(body.service_ids))
        q = q.in("service_category_id", body.service_ids);
      if (isNonEmptyArray(body.category_ids))
        q = q.in("income_category_id", body.category_ids);
      if (isNonEmptyArray(body.payment_methods))
        q = q.in("payment_method", body.payment_methods);

      const { data, error } = await q;
      if (error)
        return NextResponse.json({ error: error.message }, { status: 400 });

      const entries = (data ?? []) as IncomeEntryRow[];
      const memberIds = Array.from(new Set(entries.map((e) => e.member_id)));

      const catIds = isNonEmptyArray(body.category_ids)
        ? body.category_ids
        : Array.from(new Set(entries.map((e) => e.income_category_id)));

      // Fetch member names
      const { data: memRows, error: mem2Err } = await supabaseAdmin
        .from("members")
        .select("id,first_name,last_name")
        .eq("org_id", body.organization_id)
        .in("id", memberIds);

      if (mem2Err)
        return NextResponse.json({ error: mem2Err.message }, { status: 400 });

      const members = (memRows ?? []) as MemberRow[];
      const memberNameById = new Map<string, string>();
      for (const m of members) memberNameById.set(m.id, makeMemberName(m));

      const columns = catIds
        .map((id) => ({
          id,
          name: categoryNameById.get(id) ?? "Unknown category",
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      type PivotRow = {
        member_id: string;
        member_name: string;
        values: Record<string, number>;
        total: number;
      };

      const rowMap = new Map<string, PivotRow>();

      for (const e of entries) {
        const mid = e.member_id;
        const cid = e.income_category_id;
        const add = moneyFromCents(e.amount_cents);

        let row = rowMap.get(mid);
        if (!row) {
          row = {
            member_id: mid,
            member_name: memberNameById.get(mid) ?? "Unknown member",
            values: {},
            total: 0,
          };
          rowMap.set(mid, row);
        }

        row.values[cid] = (row.values[cid] ?? 0) + add;
        row.total += add;
      }

      const rows = Array.from(rowMap.values()).sort((a, b) =>
        a.member_name.localeCompare(b.member_name)
      );

      const colTotals: Record<string, number> = {};
      let grandTotal = 0;

      for (const r of rows) {
        grandTotal += r.total;
        for (const c of columns) {
          colTotals[c.id] = (colTotals[c.id] ?? 0) + (r.values[c.id] ?? 0);
        }
      }

      const rowsNZ = rows.filter((r) => isNonZero(r.total));

      // 2) Drop columns with col total = 0
      const keptColIds = columns
        .filter((c) => isNonZero(colTotals[c.id] ?? 0))
        .map((c) => c.id);

      const columnsNZ = columns.filter((c) => keptColIds.includes(c.id));

      // 3) Prune values to kept columns
      const rowsPruned = rowsNZ.map((r) => ({
        ...r,
        values: pickRecord(r.values, keptColIds),
      }));

      // 4) Rebuild colTotals from filtered rows (authoritative)
      const colTotalsNZ: Record<string, number> = {};
      for (const cid of keptColIds) colTotalsNZ[cid] = 0;

      let grandTotalNZ = 0;
      for (const r of rowsPruned) {
        grandTotalNZ += r.total;
        for (const cid of keptColIds) {
          colTotalsNZ[cid] += r.values[cid] ?? 0;
        }
      }

      const resp: IncomeReport = {
        ok: true,
        mode: "income",
        branding,
        meta: { role },
        table: {
          columns: columnsNZ,
          rows: rowsPruned,
          colTotals: colTotalsNZ,
          grandTotal: grandTotalNZ,
        },
      };

      return NextResponse.json(resp);
    }

    // =========================
    // EXPENSE (pivot by description; column totals only)
    // =========================
    if (body.mode === "expense") {
      type ExpenseEntry = {
        expense_category_id: string;
        description: string | null;
        amount_cents: number;
        entry_type: "normal" | "adjustment";
      };

      let q = supabaseAdmin
        .from("expense_entries")
        .select("expense_category_id,description,amount_cents,entry_type")
        .eq("org_id", body.organization_id)
        .gte("expense_date", body.start_date)
        .lte("expense_date", body.end_date);

      if (isNonEmptyArray(body.category_ids)) {
        q = q.in("expense_category_id", body.category_ids);
      }

      const { data, error } = await q;
      if (error)
        return NextResponse.json({ error: error.message }, { status: 400 });

      const entries = (data ?? []) as ExpenseEntry[];

      const usedCategoryIds = new Set<string>();
      for (const e of entries) usedCategoryIds.add(e.expense_category_id);

      const columnIds = isNonEmptyArray(body.category_ids)
        ? body.category_ids.filter(
            (id) => usedCategoryIds.has(id) || categoryNameById.has(id)
          )
        : Array.from(usedCategoryIds);

      const columns = columnIds
        .map((id) => ({ id, name: categoryNameById.get(id) ?? "Unknown" }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const rowMap = new Map<
        string,
        { description: string; values: Record<string, number> }
      >();
      const colTotals: Record<string, number> = {};

      for (const e of entries) {
        const desc = safeTrim(e.description) || "—";
        const cid = e.expense_category_id;
        const amt = moneyFromCents(e.amount_cents);

        let row = rowMap.get(desc);
        if (!row) {
          row = { description: desc, values: {} };
          rowMap.set(desc, row);
        }

        row.values[cid] = (row.values[cid] ?? 0) + amt;
        colTotals[cid] = (colTotals[cid] ?? 0) + amt;
      }

      const rows = Array.from(rowMap.values()).sort((a, b) =>
        a.description.localeCompare(b.description)
      );

      // --- ZERO FILTERING (Expense) ---
      // 1) Drop columns whose total is 0
      const keptColIds = columns
        .filter((c) => isNonZero(colTotals[c.id] ?? 0))
        .map((c) => c.id);

      const columnsNZ = columns.filter((c) => keptColIds.includes(c.id));

      // 2) Drop rows where all kept columns are 0
      const rowsNZ = rows.filter((r) =>
        keptColIds.some((cid) => isNonZero(r.values[cid] ?? 0))
      );

      // 3) Prune values
      const rowsPruned = rowsNZ.map((r) => ({
        ...r,
        values: pickRecord(r.values, keptColIds),
      }));

      // 4) Rebuild colTotals from filtered rows (authoritative)
      const colTotalsNZ: Record<string, number> = {};
      for (const cid of keptColIds) colTotalsNZ[cid] = 0;

      for (const r of rowsPruned) {
        for (const cid of keptColIds) {
          colTotalsNZ[cid] += r.values[cid] ?? 0;
        }
      }

      const resp: ExpenseReport = {
        ok: true,
        mode: "expense",
        branding,
        meta: { role },
        table: { columns: columnsNZ, rows: rowsPruned, colTotals: colTotalsNZ },
      };

      return NextResponse.json(resp);
    }

    // =========================
    // ATTENDANCE (summary or detailed)
    // =========================
    if (body.mode === "attendance") {
      const view: AttendanceView = body.view ?? "summary";

      type AttendanceEntry = {
        session_date: string;
        service_category_id: string;
        entry_source: "member" | "headcount";
        member_id: string | null;
        segment: Segment;
        age_group: string;
        count: number;
      };

      let q = supabaseAdmin
        .from("attendance_entries")
        .select(
          "session_date,service_category_id,entry_source,member_id,segment,age_group,count"
        )
        .eq("org_id", body.organization_id)
        .gte("session_date", body.start_date)
        .lte("session_date", body.end_date);

      if (isNonEmptyArray(body.service_ids))
        q = q.in("service_category_id", body.service_ids);
      if (isNonEmptyArray(body.segments))
        q = q.in("segment", body.segments as Segment[]);
      if (isNonEmptyArray(body.age_groups))
        q = q.in("age_group", body.age_groups);

      const { data, error } = await q;
      if (error)
        return NextResponse.json({ error: error.message }, { status: 400 });

      const entries = (data ?? []) as AttendanceEntry[];

      const serviceName = (id: string) =>
        categoryNameById.get(id) ?? "Unknown service";

      // ---- Summary ----
      if (view === "summary") {
        type SummaryRow = {
          date: string;
          service_id: string;
          service_name: string;
          girls: number;
          boys: number;
          women: number;
          men: number;
          total: number;
        };

        const key = (d: string, s: string) => `${d}__${s}`;
        const rowMap = new Map<string, SummaryRow>();

        for (const e of entries) {
          const k = key(e.session_date, e.service_category_id);
          let r = rowMap.get(k);
          if (!r) {
            r = {
              date: e.session_date,
              service_id: e.service_category_id,
              service_name: serviceName(e.service_category_id),
              girls: 0,
              boys: 0,
              women: 0,
              men: 0,
              total: 0,
            };
            rowMap.set(k, r);
          }

          const add = Number(e.count ?? 0);
          r[e.segment] += add;
          r.total += add;
        }

        const rows = Array.from(rowMap.values()).sort((a, b) => {
          if (a.date !== b.date) return a.date.localeCompare(b.date);
          return a.service_name.localeCompare(b.service_name);
        });

        // AttendanceReport type must match this shape:
        // { summary: { rows } }
        const resp: AttendanceReport = {
          ok: true,
          mode: "attendance",
          branding,
          meta: { role, view: "summary" },
          summary: { rows },
        };

        return NextResponse.json(resp);
      }

      // ---- Detailed ----
      // detailed is per service -> segment blocks -> list members with counts
      // NOTE: headcount rows have no member list, so we ignore headcount in detailed.
      const memberEntries = entries.filter(
        (e) => e.entry_source === "member" && e.member_id
      );

      const memberIds = Array.from(
        new Set(memberEntries.map((e) => e.member_id!))
      );

      const { data: memData, error: memErr } = await supabaseAdmin
        .from("members")
        .select("id,first_name,last_name,segment")
        .eq("org_id", body.organization_id)
        .in("id", memberIds);

      if (memErr)
        return NextResponse.json({ error: memErr.message }, { status: 400 });

      const members = (memData ?? []) as MemberRow[];
      const memberById = new Map<string, MemberRow>();
      for (const m of members) memberById.set(m.id, m);

      type SegmentBlock = {
        segment: Segment;
        rows: { member_id: string; member_name: string; count: number }[];
        total: number;
      };

      type ServiceBlock = {
        service_id: string;
        service_name: string;
        segments: SegmentBlock[];
        grand_total: number;
      };

      // service -> segment -> member -> count
      const serviceMap = new Map<string, Map<Segment, Map<string, number>>>();

      for (const e of memberEntries) {
        const mid = e.member_id!;
        const m = memberById.get(mid);
        if (!m || !m.segment) continue;

        let segMap = serviceMap.get(e.service_category_id);
        if (!segMap) {
          segMap = new Map<Segment, Map<string, number>>();
          for (const s of SEGMENTS) segMap.set(s, new Map<string, number>());
          serviceMap.set(e.service_category_id, segMap);
        }

        const memberCounts = segMap.get(m.segment);
        if (!memberCounts) continue;

        memberCounts.set(mid, (memberCounts.get(mid) ?? 0) + 1);
      }

      const services: ServiceBlock[] = Array.from(serviceMap.entries())
        .map(([service_id, segMap]) => {
          let serviceGrand = 0;

          const segments: SegmentBlock[] = SEGMENTS.map((seg) => {
            const memberCounts = segMap.get(seg) ?? new Map<string, number>();

            const rows = Array.from(memberCounts.entries())
              .map(([member_id, count]) => {
                const m = memberById.get(member_id);
                return {
                  member_id,
                  member_name: m ? makeMemberName(m) : "Unknown member",
                  count,
                };
              })
              .sort((a, b) => a.member_name.localeCompare(b.member_name));

            const total = rows.reduce((sum, r) => sum + r.count, 0);
            serviceGrand += total;

            return { segment: seg, rows, total };
          });

          return {
            service_id,
            service_name: serviceName(service_id),
            segments,
            grand_total: serviceGrand,
          };
        })
        .sort((a, b) => a.service_name.localeCompare(b.service_name));

      const resp: AttendanceReport = {
        ok: true,
        mode: "attendance",
        branding,
        meta: { role, view: "detailed" },
        detailed: { services },
      };

      return NextResponse.json(resp);
    }

    return NextResponse.json({ error: "Unsupported mode." }, { status: 400 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
