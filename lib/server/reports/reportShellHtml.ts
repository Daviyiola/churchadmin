import type { NikkyContext } from "@/lib/server/nikky/types";
import type { CanonicalReportParameters, GeneratedReport } from "@/lib/server/reports/registry";

type Branding = { header: string; subheader: string; logoUrl: string | null };
const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const money = (value: unknown) => Number(value ?? 0).toLocaleString(undefined, { style: "currency", currency: "USD" });
const label = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

async function getBranding(context: NikkyContext, reportTitle: string): Promise<Branding> {
  const { data } = await context.supabase.from("organization_settings").select("logo_path,use_default_logo,report_header_text").eq("organization_id", context.organizationId).maybeSingle();
  let logoUrl: string | null = null;
  if (data?.logo_path && !data.use_default_logo) {
    const signed = await context.supabase.storage.from("org-logos").createSignedUrl(String(data.logo_path), 3600);
    logoUrl = signed.data?.signedUrl ?? null;
  }
  return { header: String(data?.report_header_text || context.organizationName), subheader: reportTitle, logoUrl };
}

function filterLine(p: CanonicalReportParameters) {
  const parts: string[] = [];
  if (p.service_ids.length) parts.push(`Services: ${p.service_ids.length}`);
  if (p.category_ids.length) parts.push(`Categories: ${p.category_ids.length}`);
  if (p.payment_methods.length) parts.push(`Methods: ${p.payment_methods.map(label).join(", ")}`);
  if (p.report_type === "first_timers") {
    parts.push(p.include_archived ? "Including archived" : "Active only");
    if (p.joined !== "all") parts.push(p.joined === "joined" ? "Joined only" : "Not joined");
  } else if (["baptisms", "new_converts", "combined"].includes(p.report_type)) parts.push(p.include_archived ? "Including archived" : "Active only");
  return parts.join(" · ");
}

function simpleTable(columns: string[], rows: Array<Record<string, unknown>>) {
  const body = rows.length ? rows.map((row, index) => `<tr>${columns.map((column) => `<td>${column === "#" ? index + 1 : esc(row[column])}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${columns.length}" class="empty">No records in this range.</td></tr>`;
  return `<table><thead><tr>${columns.map((column) => `<th>${esc(label(column))}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>`;
}

function incomeStatement(data: GeneratedReport) {
  const section = (name: "Income" | "Expense", totalLabel: string) => {
    const rows = data.rows.filter((row) => row.section === name);
    const total = name === "Income" ? data.summary.total_income : data.summary.total_expense;
    return `<section><h3>${name === "Expense" ? "Expenses" : name}</h3><table class="statement"><thead><tr><th>Category</th><th>Amount</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${esc(row.category)}</td><td class="number">${money(row.amount)}</td></tr>`).join("")}<tr class="total"><td>${totalLabel}</td><td class="number">${money(total)}</td></tr></tbody></table></section>`;
  };
  return `${section("Income", "Total Income")}${section("Expense", "Total Expense")}<table class="statement net"><tbody><tr class="total"><td>Net Income</td><td class="number">${money(data.summary.net_income)}</td></tr></tbody></table>`;
}

function quickIncome(data: GeneratedReport) {
  const categories = [...new Set(data.rows.map((row) => String(row.category)))].sort();
  const donors = new Map<string, Record<string, number>>();
  for (const row of data.rows) {
    const donor = String(row.member), values = donors.get(donor) ?? {}, category = String(row.category);
    values[category] = (values[category] ?? 0) + Number(row.amount ?? 0); donors.set(donor, values);
  }
  const columns = ["Member", ...categories, "Total"];
  const rows = [...donors].sort(([a], [b]) => a.localeCompare(b)).map(([member, values]) => ({ Member: member, ...Object.fromEntries(categories.map((category) => [category, values[category] ? money(values[category]) : ""])), Total: money(Object.values(values).reduce((sum, value) => sum + value, 0)) }));
  return `${simpleTable(columns, rows)}<div class="grand-total">Grand total <strong>${money(data.summary.total)}</strong></div>`;
}

function quickExpense(data: GeneratedReport) {
  const rows = data.rows.map((row) => ({ date: row.date, description: row.description || "—", vendor: row.vendor || "—", category: row.category, amount: money(row.amount) }));
  return `${simpleTable(["date", "description", "vendor", "category", "amount"], rows)}<div class="grand-total">Grand total <strong>${money(data.summary.total)}</strong></div>`;
}

function attendance(data: GeneratedReport) {
  const grouped = new Map<string, Record<string, unknown>>();
  for (const row of data.rows) {
    const key = `${row.date}:${row.service}`;
    const current = grouped.get(key) ?? { date: row.date, service: row.service, girls: 0, boys: 0, women: 0, men: 0, total: 0 };
    const segment = String(row.segment ?? ""), count = Number(row.count ?? 0);
    if (["girls", "boys", "women", "men"].includes(segment)) current[segment] = Number(current[segment]) + count;
    current.total = Number(current.total) + count; grouped.set(key, current);
  }
  return simpleTable(["date", "service", "girls", "boys", "women", "men", "total"], [...grouped.values()]);
}

function firstTimers(data: GeneratedReport) {
  const total = Number(data.summary.total_visitors ?? data.rows.length), joined = Number(data.summary.total_joined ?? 0);
  const cards = `<div class="summary-grid"><div><span>Total first-timers</span><strong>${total}</strong></div><div><span>Total joined</span><strong>${joined}</strong></div><div><span>Percentage joined</span><strong>${total ? Math.round((joined / total) * 10000) / 100 : 0}%</strong></div></div>`;
  const rows = data.rows.map((row) => ({ "#": "", first_visit_at: row.first_visit_at, name: row.name, demographics: [row.gender, row.age_group].filter(Boolean).map((x) => label(String(x))).join(" · ") || "—", how_heard: row.how_heard || "—", joined: row.joined ? "Yes" : "No" }));
  return cards + simpleTable(["#", "first_visit_at", "name", "demographics", "how_heard", "joined"], rows);
}

function converts(data: GeneratedReport, p: CanonicalReportParameters) {
  const born = p.report_type !== "baptisms", baptized = p.report_type !== "new_converts";
  const summary = `<table class="summary-table"><tbody>${born ? `<tr><td>Total born again</td><td>${esc(data.summary.total_born_again)}</td></tr>` : ""}${baptized ? `<tr><td>Total baptized</td><td>${esc(data.summary.total_baptized)}</td></tr>` : ""}</tbody></table>`;
  const rows = data.rows.map((row) => ({ "#": "", name: row.name, demographics: [row.gender, row.age_group].filter(Boolean).map((x) => label(String(x))).join(" · ") || "—", ...(born ? { born_again_date: row.born_again_date || "—" } : {}), ...(baptized ? { baptism_date: row.baptism_date || "—" } : {}) }));
  return summary + simpleTable(["#", "name", "demographics", ...(born ? ["born_again_date"] : []), ...(baptized ? ["baptism_date"] : [])], rows);
}

function reportBody(data: GeneratedReport, p: CanonicalReportParameters) {
  if (p.report_type === "income_statement") return incomeStatement(data);
  if (p.report_type === "quick_income") return quickIncome(data);
  if (p.report_type === "quick_expense") return quickExpense(data);
  if (p.report_type === "quick_attendance") return attendance(data);
  if (p.report_type === "first_timers") return firstTimers(data);
  if (["baptisms", "new_converts", "combined"].includes(p.report_type)) return converts(data, p);
  return simpleTable(data.columns, data.rows);
}

export async function renderExistingReportShellHtml(context: NikkyContext, p: CanonicalReportParameters, data: GeneratedReport) {
  const brand = await getBranding(context, data.title), filters = filterLine(p);
  const landscape = p.report_type.startsWith("quick_") || p.report_type === "first_timers" || ["baptisms", "new_converts", "combined"].includes(p.report_type);
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial;margin:0;color:#0f172a}.wrap{padding:28px 36px}.header{text-align:center;margin-bottom:28px}.logo{width:80px;height:80px;object-fit:contain;margin-bottom:8px}.h1{font-size:22pt;font-weight:700}.h2{font-size:18pt;font-weight:700;margin-top:6pt}.meta{font-size:10pt;font-weight:600;margin-top:10pt}.filters{font-size:9pt;color:#475569;margin-top:4pt}section{margin-bottom:28px}h3{font-size:11pt;margin:0 0 8px}table{border-collapse:collapse;table-layout:fixed;width:auto;max-width:100%;margin-top:12px}th,td{border:1px solid #000;padding:6px 8px;font-size:10.5pt;text-align:left;overflow:hidden;text-overflow:ellipsis}th{background:#f1f5f9;font-weight:700}.number{text-align:center;font-variant-numeric:tabular-nums}.total{font-weight:800;background:#f1f5f9}.statement{width:680px}.statement th:first-child,.statement td:first-child{width:520px}.statement th:last-child,.statement td:last-child{width:160px}.net{margin-top:8px}.empty{padding:14px;color:#475569}.grand-total{width:max-content;min-width:320px;border:1px solid #000;border-top:0;background:#f1f5f9;padding:7px 9px;display:flex;justify-content:space-between;gap:60px}.summary-grid{display:flex;gap:12px;margin-bottom:18px}.summary-grid div{border:1px solid #000;min-width:180px;padding:8px;background:#f8fafc}.summary-grid span,.summary-grid strong{display:block}.summary-grid strong{font-size:16pt;margin-top:4px}.summary-table{width:700px;margin-bottom:18px}.summary-table td:first-child{width:520px;font-weight:700;background:#f1f5f9}.summary-table td:last-child{width:180px;font-weight:700;text-align:center}tr{break-inside:avoid;page-break-inside:avoid}@page{size:${landscape ? "Letter landscape" : "Letter"};margin:.55in}</style></head><body><div class="wrap"><header class="header">${brand.logoUrl ? `<img class="logo" src="${esc(brand.logoUrl)}" alt="">` : ""}<div class="h1">${esc(brand.header)}</div><div class="h2">${esc(brand.subheader)}</div><div class="meta">Time Period: ${esc(p.start_date)} to ${esc(p.end_date)}</div>${filters ? `<div class="filters">${esc(filters)}</div>` : ""}</header>${reportBody(data, p)}</div></body></html>`;
  return { html, landscape };
}
