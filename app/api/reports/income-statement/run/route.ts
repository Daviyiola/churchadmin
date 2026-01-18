export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type {
  RunIncomeStatementBody,
  IncomeStatementReport,
  ErrorResponse,
  Role,
  Branding,
} from "@/lib/reports/income-statement/types";

type OrgRow = { id: string; name: string };

type OrgSettingsRow = {
  organization_id: string;
  logo_path: string | null;
  use_default_logo: boolean;
  report_header_text: string | null;
  report_subheader_text: string | null;
};

type UserOrgRow = { role: string };

type CategoryRow = {
  id: string;
  name: string;
  type: "income" | "expense" | "services";
  status: "active" | "archived";
};

type IncomeEntryRow = {
  income_category_id: string;
  service_category_id: string;
  payment_method: "cash" | "cheque" | "online";
  amount_cents: number;
  entry_type: "normal" | "adjustment";
  session_date: string; // date
};

type ExpenseEntryRow = {
  expense_category_id: string;
  amount_cents: number;
  entry_type: "normal" | "adjustment";
  expense_date: string; // date
};

function asRole(raw: unknown): Role {
  const v = String(raw);
  if (v === "owner" || v === "admin" || v === "finance" || v === "member") return v;
  return "member";
}

function isNonEmptyArray<T>(v: T[] | undefined | null): v is T[] {
  return Array.isArray(v) && v.length > 0;
}

function moneyFromCents(cents: number): number {
  return (cents ?? 0) / 100;
}

function isNonZero(n: number, eps = 1e-9): boolean {
  return Math.abs(n) > eps;
}

async function getBranding(orgId: string): Promise<Branding> {
  const { data: org, error: orgErr } = await supabaseAdmin
    .from("organizations")
    .select("id,name")
    .eq("id", orgId)
    .maybeSingle();

  if (orgErr) throw new Error(orgErr.message);

  const { data: s, error: sErr } = await supabaseAdmin
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

  const orgName = (org as OrgRow | null)?.name ?? "Organization";

  return {
    logo_url,
    header_text: settings?.report_header_text ?? orgName,
    subheader_text: settings?.report_subheader_text ?? "Income Statement",
    generated_at_iso: new Date().toISOString(),
  };
}

async function getCategoryMaps(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from("categories")
    .select("id,name,type,status")
    .eq("org_id", orgId);

  if (error) throw new Error(error.message);

  const byId = new Map<string, CategoryRow>();
  const incomeIds: string[] = [];
  const expenseIds: string[] = [];

  for (const r of (data ?? []) as CategoryRow[]) {
    byId.set(r.id, r);
    if (r.type === "income") incomeIds.push(r.id);
    if (r.type === "expense") expenseIds.push(r.id);
  }

  return { byId, incomeIds, expenseIds };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RunIncomeStatementBody;

    if (!body.organization_id || !body.start_date || !body.end_date) {
      return NextResponse.json(
        { error: "organization_id, start_date, end_date are required" } satisfies ErrorResponse,
        { status: 400 }
      );
    }

    // ---- Auth ----
    const authHeader = req.headers.get("authorization") || "";
    const accessToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : null;

    if (!accessToken) return NextResponse.json({ error: "Unauthorized" } satisfies ErrorResponse, { status: 401 });

    const { data: userRes, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (userErr || !userRes?.user) return NextResponse.json({ error: "Unauthorized" } satisfies ErrorResponse, { status: 401 });

    const userId = userRes.user.id;

    const { data: membership, error: memErr } = await supabaseAdmin
      .from("user_organizations")
      .select("role")
      .eq("organization_id", body.organization_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (memErr) return NextResponse.json({ error: memErr.message } satisfies ErrorResponse, { status: 400 });
    if (!membership) return NextResponse.json({ error: "Forbidden" } satisfies ErrorResponse, { status: 403 });

    const role = asRole((membership as UserOrgRow).role);

    const branding = await getBranding(body.organization_id);
    const { byId } = await getCategoryMaps(body.organization_id);

    // ======================
    // INCOME side
    // ======================
    let incomeQ = supabaseAdmin
      .from("income_entries")
      .select("income_category_id,service_category_id,payment_method,amount_cents,entry_type,session_date")
      .eq("org_id", body.organization_id)
      .gte("session_date", body.start_date)
      .lte("session_date", body.end_date);

    if (isNonEmptyArray(body.service_ids)) incomeQ = incomeQ.in("service_category_id", body.service_ids);
    if (isNonEmptyArray(body.income_category_ids)) incomeQ = incomeQ.in("income_category_id", body.income_category_ids);
    if (isNonEmptyArray(body.payment_methods)) incomeQ = incomeQ.in("payment_method", body.payment_methods);

    const { data: incomeRows, error: incErr } = await incomeQ;
    if (incErr) return NextResponse.json({ error: incErr.message } satisfies ErrorResponse, { status: 400 });

    const incomeEntries = (incomeRows ?? []) as IncomeEntryRow[];

    const incomeTotalsByCat = new Map<string, number>();
    for (const e of incomeEntries) {
      const cid = e.income_category_id;
      const amt = moneyFromCents(e.amount_cents);
      incomeTotalsByCat.set(cid, (incomeTotalsByCat.get(cid) ?? 0) + amt);
    }

    // ======================
    // EXPENSE side
    // ======================
    let expenseQ = supabaseAdmin
      .from("expense_entries")
      .select("expense_category_id,amount_cents,entry_type,expense_date")
      .eq("org_id", body.organization_id)
      .gte("expense_date", body.start_date)
      .lte("expense_date", body.end_date);

    if (isNonEmptyArray(body.expense_category_ids)) expenseQ = expenseQ.in("expense_category_id", body.expense_category_ids);

    const { data: expenseRows, error: expErr } = await expenseQ;
    if (expErr) return NextResponse.json({ error: expErr.message } satisfies ErrorResponse, { status: 400 });

    const expenseEntries = (expenseRows ?? []) as ExpenseEntryRow[];

    const expenseTotalsByCat = new Map<string, number>();
    for (const e of expenseEntries) {
      const cid = e.expense_category_id;
      const amt = moneyFromCents(e.amount_cents);
      expenseTotalsByCat.set(cid, (expenseTotalsByCat.get(cid) ?? 0) + amt);
    }

    // ======================
    // Build lines + ZERO FILTER
    // ======================
    const incomeLines = Array.from(incomeTotalsByCat.entries())
      .map(([category_id, amount]) => {
        const name = byId.get(category_id)?.name ?? "Unknown category";
        return { category_id, category_name: name, amount };
      })
      .filter((x) => isNonZero(x.amount))
      .sort((a, b) => a.category_name.localeCompare(b.category_name));

    const expenseLines = Array.from(expenseTotalsByCat.entries())
      .map(([category_id, amount]) => {
        const name = byId.get(category_id)?.name ?? "Unknown category";
        return { category_id, category_name: name, amount };
      })
      .filter((x) => isNonZero(x.amount))
      .sort((a, b) => a.category_name.localeCompare(b.category_name));

    const total_income = incomeLines.reduce((s, x) => s + x.amount, 0);
    const total_expense = expenseLines.reduce((s, x) => s + x.amount, 0);
    const net_income = total_income - total_expense;

    const resp: IncomeStatementReport = {
      ok: true,
      mode: "income_statement",
      branding,
      meta: { role },
      statement: {
        income: incomeLines,
        expenses: expenseLines,
        totals: { total_income, total_expense, net_income },
      },
    };

    return NextResponse.json(resp);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg } satisfies ErrorResponse, { status: 400 });
  }
}
