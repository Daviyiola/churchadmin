import { createHash, randomUUID } from "node:crypto";
import { launchBrowser } from "@/lib/server/pdf/launchBrowser";
import { assertDateRange, enforceFinanceWindow } from "@/lib/server/nikky/dates";
import type { NikkyContext, NikkyRole } from "@/lib/server/nikky/types";
import { runMemberGivingReportFromToken } from "@/lib/server/reports/memberGiving";
import { renderMemberGivingHtml } from "@/lib/server/reports/memberGivingHtml";
import { renderExistingReportShellHtml } from "@/lib/server/reports/reportShellHtml";
import type { MemberGivingReport } from "@/lib/reports/members/types";

export const REPORT_TYPES = [
  "quick_income", "quick_expense", "quick_attendance", "income_statement",
  "member_giving", "first_timers", "baptisms", "new_converts", "combined",
] as const;
export type NikkyReportType = (typeof REPORT_TYPES)[number];
export type ReportFormat = "pdf" | "csv";
export type ReportDetail = "summary" | "detailed";

export type CanonicalReportParameters = {
  report_type: NikkyReportType;
  format: ReportFormat;
  start_date: string;
  end_date: string;
  detail_level: ReportDetail;
  include_archived: boolean;
  joined: "all" | "joined" | "not_joined";
  service_ids: string[];
  category_ids: string[];
  payment_methods: Array<"cash" | "cheque" | "online">;
  member_id: string | null;
};

type Definition = {
  name: string;
  description: string;
  roles: NikkyRole[];
  financial: boolean;
  classification: string;
};

export const REPORT_REGISTRY: Record<NikkyReportType, Definition> = {
  quick_income: { name: "Quick Income", description: "Income by donor and category for the selected period.", roles: ["owner", "admin", "finance"], financial: true, classification: "financial_identifiable_bulk" },
  quick_expense: { name: "Quick Expense", description: "Expense ledger with dates, categories, vendors, and amounts.", roles: ["owner", "admin", "finance"], financial: true, classification: "financial_detail" },
  quick_attendance: { name: "Quick Attendance", description: "Published attendance summary or member-level detail.", roles: ["owner", "admin", "finance"], financial: false, classification: "attendance" },
  income_statement: { name: "Income Statement", description: "Income, expenses, and net income grouped by category.", roles: ["owner", "admin", "finance"], financial: true, classification: "financial_aggregate" },
  member_giving: { name: "Member Giving", description: "Giving for one selected member, in summary or detailed form.", roles: ["owner", "admin"], financial: true, classification: "financial_identifiable_individual" },
  first_timers: { name: "First-Timers", description: "Visitors whose first visit falls in the selected period; Nikky omits follow-up notes.", roles: ["owner", "admin", "finance"], financial: false, classification: "visitor" },
  baptisms: { name: "Baptisms", description: "Members baptized in the selected period.", roles: ["owner", "admin", "finance"], financial: false, classification: "member_sacrament" },
  new_converts: { name: "New Converts", description: "Members marked born again in the selected period.", roles: ["owner", "admin", "finance"], financial: false, classification: "member_sacrament" },
  combined: { name: "Converts & Baptisms", description: "Combined converts and baptisms in the selected period.", roles: ["owner", "admin", "finance"], financial: false, classification: "member_sacrament" },
};

function arrayOfStrings(value: unknown, allowed?: readonly string[]) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error("Invalid report filter list.");
  const clean = [...new Set(value as string[])].slice(0, 100);
  if (allowed && clean.some((item) => !allowed.includes(item))) throw new Error("Invalid report filter value.");
  return clean;
}

export function canonicalizeReportParameters(context: NikkyContext, raw: Record<string, unknown>): CanonicalReportParameters {
  const allowed = new Set(["report_type","format","start_date","end_date","detail_level","include_archived","joined","service_ids","category_ids","payment_methods","member_id"]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) throw new Error("Unknown report parameter.");
  const reportType = String(raw.report_type) as NikkyReportType;
  if (!REPORT_TYPES.includes(reportType)) throw new Error("Unsupported report type.");
  const definition = REPORT_REGISTRY[reportType];
  if (!definition.roles.includes(context.role)) throw new Error("This report is not available for your role.");
  const { startDate, endDate } = assertDateRange(raw.start_date, raw.end_date);
  if (definition.financial) enforceFinanceWindow(context, startDate);
  const format = raw.format === "pdf" || raw.format === "csv" ? raw.format : null;
  if (!format) throw new Error("Report format must be PDF or CSV.");
  const detail = raw.detail_level === "detailed" ? "detailed" : "summary";
  const joined = raw.joined === "joined" || raw.joined === "not_joined" ? raw.joined : "all";
  const memberId = raw.member_id == null ? null : String(raw.member_id);
  if (memberId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(memberId)) throw new Error("Invalid member ID.");
  if (context.role === "finance" && memberId) throw new Error("Finance users cannot target a donor in financial reports.");
  if (reportType === "member_giving" && !memberId) throw new Error("Member Giving requires an unambiguous selected member.");
  if (reportType !== "member_giving" && memberId) throw new Error("This report does not accept a member filter.");
  return {
    report_type: reportType, format, start_date: startDate, end_date: endDate,
    detail_level: detail,
    include_archived: raw.include_archived !== false,
    joined,
    service_ids: arrayOfStrings(raw.service_ids),
    category_ids: arrayOfStrings(raw.category_ids),
    payment_methods: arrayOfStrings(raw.payment_methods, ["cash", "cheque", "online"]) as CanonicalReportParameters["payment_methods"],
    member_id: memberId,
  };
}

export function reportParametersHash(parameters: CanonicalReportParameters) {
  return createHash("sha256").update(JSON.stringify(parameters)).digest("hex");
}

function cents(value: unknown) { return Number(value ?? 0); }
function name(row: { first_name?: string | null; last_name?: string | null }) { return `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || "Unknown"; }

async function categoryMap(context: NikkyContext) {
  const { data, error } = await context.supabase.from("categories").select("id,name").eq("org_id", context.organizationId);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((row) => [String(row.id), String(row.name)]));
}

export type GeneratedReport = { title: string; columns: string[]; rows: Array<Record<string, unknown>>; summary: Record<string, unknown>; recordCount: number; memberGivingReport?: MemberGivingReport };

export async function buildReportData(context: NikkyContext, p: CanonicalReportParameters): Promise<GeneratedReport> {
  const categories = await categoryMap(context);
  if (p.report_type === "quick_income") {
    let q = context.supabase.from("income_entries").select("session_date,member_id,income_category_id,payment_method,amount_cents").eq("org_id", context.organizationId).gte("session_date", p.start_date).lte("session_date", p.end_date).limit(10000);
    if (p.service_ids.length) q = q.in("service_category_id", p.service_ids);
    if (p.category_ids.length) q = q.in("income_category_id", p.category_ids);
    if (p.payment_methods.length) q = q.in("payment_method", p.payment_methods);
    const { data, error } = await q; if (error) throw new Error(error.message);
    const ids = [...new Set((data ?? []).map((r) => String(r.member_id)))];
    const members = ids.length ? await context.supabase.from("members").select("id,first_name,last_name").eq("org_id", context.organizationId).in("id", ids) : { data: [], error: null };
    if (members.error) throw new Error(members.error.message);
    const memberNames = new Map((members.data ?? []).map((r) => [String(r.id), name(r)]));
    const rows = (data ?? []).map((r) => ({ date: r.session_date, member: memberNames.get(String(r.member_id)) ?? "Unknown", category: categories.get(String(r.income_category_id)) ?? "Unknown", method: r.payment_method, amount: cents(r.amount_cents) / 100 }));
    return { title: "Quick Income", columns: ["date","member","category","method","amount"], rows, summary: { total: rows.reduce((s,r) => s + Number(r.amount), 0) }, recordCount: rows.length };
  }
  if (p.report_type === "quick_expense") {
    let q = context.supabase.from("expense_entries").select("expense_date,description,vendor,expense_category_id,payment_method,amount_cents").eq("org_id", context.organizationId).gte("expense_date", p.start_date).lte("expense_date", p.end_date).limit(10000);
    if (p.category_ids.length) q = q.in("expense_category_id", p.category_ids);
    if (p.payment_methods.length) q = q.in("payment_method", p.payment_methods);
    const { data, error } = await q; if (error) throw new Error(error.message);
    const rows = (data ?? []).map((r) => ({ date: r.expense_date, description: r.description, vendor: r.vendor, category: categories.get(String(r.expense_category_id)) ?? "Unknown", method: r.payment_method, amount: cents(r.amount_cents) / 100 }));
    return { title: "Quick Expense", columns: ["date","description","vendor","category","method","amount"], rows, summary: { total: rows.reduce((s,r) => s + Number(r.amount), 0) }, recordCount: rows.length };
  }
  if (p.report_type === "quick_attendance") {
    let q = context.supabase.from("attendance_entries").select("session_date,service_category_id,entry_source,member_id,segment,count").eq("org_id", context.organizationId).gte("session_date", p.start_date).lte("session_date", p.end_date).limit(10000);
    if (p.service_ids.length) q = q.in("service_category_id", p.service_ids);
    const { data, error } = await q; if (error) throw new Error(error.message);
    const rows = (data ?? []).map((r) => ({ date: r.session_date, service: categories.get(String(r.service_category_id)) ?? "Unknown", source: r.entry_source, segment: r.segment, count: Number(r.count ?? 0) }));
    return { title: "Quick Attendance", columns: ["date","service","source","segment","count"], rows, summary: { total: rows.reduce((s,r) => s + Number(r.count), 0) }, recordCount: rows.length };
  }
  if (p.report_type === "income_statement") {
    const [income, expense] = await Promise.all([
      context.supabase.from("income_entries").select("income_category_id,amount_cents").eq("org_id", context.organizationId).gte("session_date", p.start_date).lte("session_date", p.end_date),
      context.supabase.from("expense_entries").select("expense_category_id,amount_cents").eq("org_id", context.organizationId).gte("expense_date", p.start_date).lte("expense_date", p.end_date),
    ]);
    if (income.error) throw new Error(income.error.message); if (expense.error) throw new Error(expense.error.message);
    const grouped = new Map<string, { section: string; category: string; amount: number }>();
    for (const r of income.data ?? []) { const id=String(r.income_category_id); const k=`income:${id}`; grouped.set(k,{section:"Income",category:categories.get(id)??"Unknown",amount:(grouped.get(k)?.amount??0)+cents(r.amount_cents)/100}); }
    for (const r of expense.data ?? []) { const id=String(r.expense_category_id); const k=`expense:${id}`; grouped.set(k,{section:"Expense",category:categories.get(id)??"Unknown",amount:(grouped.get(k)?.amount??0)+cents(r.amount_cents)/100}); }
    const rows=[...grouped.values()]; const totalIncome=rows.filter(r=>r.section==="Income").reduce((s,r)=>s+r.amount,0); const totalExpense=rows.filter(r=>r.section==="Expense").reduce((s,r)=>s+r.amount,0);
    return { title:"Income Statement", columns:["section","category","amount"], rows, summary:{ total_income:totalIncome,total_expense:totalExpense,net_income:totalIncome-totalExpense }, recordCount:(income.data?.length??0)+(expense.data?.length??0) };
  }
  if (p.report_type === "first_timers") {
    const statuses = p.include_archived ? ["active","archived"] : ["active"];
    let q = context.supabase.from("members").select("id,first_name,last_name,gender,age_group,status,visitor_details!inner(first_visit_at,follow_up_status,how_heard)").eq("org_id", context.organizationId).eq("membership_stage","visitor").in("status",statuses).gte("visitor_details.first_visit_at",p.start_date).lte("visitor_details.first_visit_at",p.end_date).limit(10000);
    if (p.joined === "joined") q=q.eq("visitor_details.follow_up_status","joined"); else if(p.joined==="not_joined") q=q.neq("visitor_details.follow_up_status","joined");
    const {data,error}=await q;if(error)throw new Error(error.message);
    const rows=(data??[]).map((r)=>{const vd=Array.isArray(r.visitor_details)?r.visitor_details[0]:r.visitor_details;return {first_visit_at:vd?.first_visit_at,name:name(r),gender:r.gender,age_group:r.age_group,how_heard:vd?.how_heard,joined:vd?.follow_up_status==="joined"};});
    return {title:"First-Timers",columns:["first_visit_at","name","gender","age_group","how_heard","joined"],rows,summary:{total_visitors:rows.length,total_joined:rows.filter(r=>r.joined).length},recordCount:rows.length};
  }
  if (p.report_type === "member_giving") {
    const report = await runMemberGivingReportFromToken({ organization_id: context.organizationId, member_id: p.member_id!, mode: p.detail_level, start_date: p.start_date, end_date: p.end_date, service_ids: p.service_ids, category_ids: p.category_ids, payment_methods: p.payment_methods }, context.accessToken);
    if ("summary" in report) {
      const rows = report.summary.rows.map((r) => ({ category: r.category_name, amount: r.amount }));
      return { title: `Member Giving — ${report.member.name}`, columns: ["category","amount"], rows, summary: { grand_total: report.summary.grand_total }, recordCount: rows.length, memberGivingReport: report };
    }
    const rows = report.detailed.months.flatMap((month) => month.rows.map((r) => ({ month: month.label, date: r.date, category: r.category_name, method: r.payment_method, entry_type: r.entry_type, amount: r.amount })));
    return { title: `Member Giving — ${report.member.name}`, columns: ["month","date","category","method","entry_type","amount"], rows, summary: { grand_total: report.detailed.grand_total }, recordCount: rows.length, memberGivingReport: report };
  }

  const statuses=p.include_archived?["active","archived"]:["active"];
  const {data,error}=await context.supabase.from("members").select("first_name,last_name,gender,age_group,baptized,baptism_date,born_again,born_again_date").eq("org_id",context.organizationId).in("status",statuses).limit(10000);
  if(error)throw new Error(error.message);
  const rows=(data??[]).filter((r)=> p.report_type==="baptisms" ? r.baptized&&r.baptism_date>=p.start_date&&r.baptism_date<=p.end_date : p.report_type==="new_converts" ? r.born_again&&r.born_again_date>=p.start_date&&r.born_again_date<=p.end_date : (r.baptized&&r.baptism_date>=p.start_date&&r.baptism_date<=p.end_date)||(r.born_again&&r.born_again_date>=p.start_date&&r.born_again_date<=p.end_date)).map(r=>({name:name(r),gender:r.gender,age_group:r.age_group,born_again_date:r.born_again_date,baptism_date:r.baptism_date}));
  return {title:REPORT_REGISTRY[p.report_type].name,columns:["name","gender","age_group","born_again_date","baptism_date"],rows,summary:{total_born_again:rows.filter(r=>r.born_again_date&&r.born_again_date>=p.start_date&&r.born_again_date<=p.end_date).length,total_baptized:rows.filter(r=>r.baptism_date&&r.baptism_date>=p.start_date&&r.baptism_date<=p.end_date).length},recordCount:rows.length};
}

function csvCell(value: unknown) { const text=String(value??""); return /[",\n\r]/.test(text)?`"${text.replaceAll('"','""')}"`:text; }
export async function renderReport(context: NikkyContext,p:CanonicalReportParameters,data:GeneratedReport) {
  if(p.format==="csv") {
    const lines=[data.columns.map(csvCell).join(","),...data.rows.map(row=>data.columns.map(column=>csvCell(row[column])).join(","))];
    return {bytes:Buffer.from(`\uFEFF${lines.join("\r\n")}`,"utf8"),contentType:"text/csv; charset=utf-8"};
  }
  const browser=await launchBrowser(); const page=await browser.newPage();
  try {
    const shell = data.memberGivingReport
      ? { html: renderMemberGivingHtml(data.memberGivingReport, "Generated by Nikky"), landscape: false }
      : await renderExistingReportShellHtml(context, p, data);
    await page.setContent(shell.html,{waitUntil:"load",timeout:30_000});
    const bytes=Buffer.from(await page.pdf({format:"Letter",landscape:shell.landscape,printBackground:true,margin:{top:"0.4in",right:"0.4in",bottom:"0.4in",left:"0.4in"}}));
    return {bytes,contentType:"application/pdf"};
  } finally { await page.close(); }
}

export function reportFilename(p:CanonicalReportParameters){return `${p.report_type}-${p.start_date}-to-${p.end_date}-${randomUUID().slice(0,8)}.${p.format}`;}
