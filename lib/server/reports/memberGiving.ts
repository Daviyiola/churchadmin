// lib/server/reports/memberGiving.ts
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type {
  RunMemberGivingBody,
  MemberGivingReport,
  ErrorResponse,
  Branding,
  PaymentMethod,
  MemberGivingMode,
} from "@/lib/reports/members/types";

type Role = "owner" | "admin" | "finance" | "member";
type UserOrgRow = { role: string };

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
  session_date: string;
  service_category_id: string;
  member_id: string;
  income_category_id: string;
  payment_method: PaymentMethod;
  amount_cents: number;
  entry_type: "normal" | "adjustment";
};

function asRole(raw: unknown): Role {
  const v = String(raw);
  if (v === "owner" || v === "admin" || v === "finance" || v === "member") return v;
  return "member";
}

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

async function getBranding(orgId: string): Promise<Branding> {
  const { data: org, error: orgErr } = await supabaseAdmin
    .from("organizations")
    .select("id,name")
    .eq("id", orgId)
    .maybeSingle<{ id: string; name: string }>();

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

  const orgName = (org?.name ?? "Organization").trim() || "Organization";

  return {
    logo_url,
    header_text: settings?.report_header_text ?? orgName,
    subheader_text: settings?.report_subheader_text ?? "Member giving report",
    generated_at_iso: new Date().toISOString(),
  };
}

async function getIncomeCategoryNameMap(orgId: string) {
  const { data, error } = await supabaseAdmin
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
  // --- Validate user ---
  const { data: userRes, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
  if (userErr || !userRes?.user) throw new Error("Unauthorized");
  const userId = userRes.user.id;

  // --- Membership + role ---
  const { data: membership, error: memErr } = await supabaseAdmin
    .from("user_organizations")
    .select("role")
    .eq("organization_id", body.organization_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (memErr) throw new Error(memErr.message);
  if (!membership) throw new Error("Forbidden");

  const role = asRole((membership as unknown as UserOrgRow).role);

  // --- Member ---
  const { data: memRow, error: mem2Err } = await supabaseAdmin
    .from("members")
    .select("id,first_name,last_name")
    .eq("org_id", body.organization_id)
    .eq("id", body.member_id)
    .maybeSingle();

  if (mem2Err) throw new Error(mem2Err.message);
  if (!memRow) throw new Error("Member not found");

  const member = memRow as unknown as MemberRow;

  const branding = await getBranding(body.organization_id);
  const categoryNameById = await getIncomeCategoryNameMap(body.organization_id);

  // --- Income entries for this member ---
  let q = supabaseAdmin
    .from("income_entries")
    .select("session_date,service_category_id,member_id,income_category_id,payment_method,amount_cents,entry_type")
    .eq("org_id", body.organization_id)
    .eq("member_id", body.member_id)
    .gte("session_date", body.start_date)
    .lte("session_date", body.end_date)
    .order("session_date", { ascending: true });

  if (isNonEmptyArray(body.service_ids)) q = q.in("service_category_id", body.service_ids);
  if (isNonEmptyArray(body.category_ids)) q = q.in("income_category_id", body.category_ids);
  if (isNonEmptyArray(body.payment_methods)) q = q.in("payment_method", body.payment_methods);

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const entries = (data ?? []) as unknown as IncomeEntryRow[];

  const start = body.start_date;
  const end = body.end_date;
  const view: MemberGivingMode = body.mode;

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
      member: { id: member.id, name: memberName(member) },
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
    member: { id: member.id, name: memberName(member) },
    period: { start, end },
    detailed: { months, grand_total },
  };
}
