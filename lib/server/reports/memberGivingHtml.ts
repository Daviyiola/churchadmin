import type {
  MemberGivingReport,
  MemberGivingSummaryReport,
  MemberGivingDetailedReport,
  MemberGivingMonthlyReport,
} from "@/lib/reports/members/types";

function isSummary(r: MemberGivingReport): r is MemberGivingSummaryReport {
  return r.meta.view === "summary";
}
function isMonthly(r: MemberGivingReport): r is MemberGivingMonthlyReport {
  return r.meta.view === "monthly";
}
function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function money(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}
function moneyOrEmpty(n: number) {
  return Math.abs(n) < 0.000001 ? "" : money(n);
}

export function renderMemberGivingHtml(report: MemberGivingReport, filtersLine?: string) {
  const logo = report.branding.logo_url;
  const header = esc(report.branding.header_text ?? "Report");
  const subheader = esc(report.branding.subheader_text ?? "Member giving report");
  const memberLine = isMonthly(report)
    ? `Members: ${report.members.length} selected`
    : `Member: ${esc(report.member.name)}`;
  const period = `${esc(report.period.start)} to ${esc(report.period.end)}`;

  const css = `
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 0; color: #0f172a; }
    .wrap { padding: 28px 36px; }
    .center { text-align: center; }
    .muted { color: #475569; }
    .h1 { font-size: 22pt; font-weight: 800; margin-top: 6px; }
    .h2 { font-size: 18pt; font-weight: 800; margin-top: 6px; }
    .meta { font-size: 10pt; font-weight: 600; margin-top: 10px; }
    .meta2 { font-size: 10pt; font-weight: 600; margin-top: 4px; }
    .filters { font-size: 9pt; margin-top: 4px; color: #475569; }
    .spacer { height: 18px; }
    table { border-collapse: collapse; table-layout: fixed; width: auto; }
    th, td { border: 1px solid #000; padding: 6px 8px; font-size: 11pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    th { background: #f1f5f9; font-weight: 700; }
    .right { text-align: right; }
    .centerCell { text-align: center; }
    .bold { font-weight: 800; }
    .break-avoid { break-inside: avoid; page-break-inside: avoid; }
    .monthly { width: 100%; table-layout: fixed; }
    .monthly th, .monthly td { padding: 4px 5px; font-size: 8pt; white-space: normal; overflow-wrap: anywhere; }
    .monthly .member-col { width: 18%; text-align: left; }
  `;

  const headerHtml = `
    <div class="center">
      ${logo ? `<div style="margin-bottom:8px;"><img src="${esc(logo)}" style="height:80px;width:80px;object-fit:contain" /></div>` : `<div style="height:10px;"></div>`}
      <div class="h1">${header}</div>
      <div class="h2">${subheader}</div>
      <div class="meta">Time Period: ${period}</div>
      <div class="meta2">${memberLine}</div>
      ${filtersLine ? `<div class="filters">${esc(filtersLine)}</div>` : ``}
    </div>
  `;

  const bodyHtml = isSummary(report)
    ? renderSummary(report)
    : isMonthly(report)
      ? renderMonthly(report)
      : renderDetailed(report as MemberGivingDetailedReport);

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>${css}</style>
</head>
<body>
  <div class="wrap">
    ${headerHtml}
    <div class="spacer"></div>
    ${bodyHtml}
  </div>
</body>
</html>`;
}

function renderSummary(r: MemberGivingSummaryReport) {
  const CAT_W = 420;
  const AMT_W = 160;

  const rows = r.summary.rows
    .map(
      (x) => `
      <tr>
        <td title="${esc(x.category_name)}" style="width:${CAT_W}px">${esc(x.category_name)}</td>
        <td class="centerCell bold" style="width:${AMT_W}px">${esc(moneyOrEmpty(x.amount))}</td>
      </tr>`,
    )
    .join("");

  return `
    <table>
      <thead>
        <tr>
          <th style="width:${CAT_W}px;text-align:left;">Category</th>
          <th style="width:${AMT_W}px;" class="centerCell">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        <tr>
          <td class="bold">Grand total</td>
          <td class="centerCell bold">${esc(moneyOrEmpty(r.summary.grand_total))}</td>
        </tr>
      </tbody>
    </table>
  `;
}

function renderDetailed(r: MemberGivingDetailedReport) {
  const DATE_W = 120;
  const CAT_W = 320;
  const METHOD_W = 120;
  const AMT_W = 140;

  const blocks = r.detailed.months
    .map((m) => {
      const rows = m.rows
        .map(
          (t) => `
        <tr>
          <td style="width:${DATE_W}px">${esc(t.date)}</td>
          <td style="width:${CAT_W}px" title="${esc(t.category_name)}">${esc(t.category_name)}</td>
          <td style="width:${METHOD_W}px" class="centerCell">${esc(t.payment_method)}</td>
          <td style="width:${AMT_W}px" class="centerCell bold">${esc(moneyOrEmpty(t.amount))}</td>
        </tr>`,
        )
        .join("");

      return `
        <div class="break-avoid" style="margin-bottom:22px;">
          <table>
            <thead>
              <tr><th colspan="4" style="text-align:left;">${esc(m.label)}</th></tr>
              <tr>
                <th style="width:${DATE_W}px;text-align:left;">Date</th>
                <th style="width:${CAT_W}px;text-align:left;">Category</th>
                <th style="width:${METHOD_W}px" class="centerCell">Method</th>
                <th style="width:${AMT_W}px" class="centerCell">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
              <tr>
                <td colspan="3" class="bold">${esc(m.label)} subtotal</td>
                <td class="centerCell bold">${esc(moneyOrEmpty(m.subtotal))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      `;
    })
    .join("");

  const grand = `
    <table>
      <tbody>
        <tr>
          <td class="bold" style="width:560px;background:#f1f5f9;">Grand total</td>
          <td class="centerCell bold" style="width:140px;background:#f1f5f9;">${esc(moneyOrEmpty(r.detailed.grand_total))}</td>
        </tr>
      </tbody>
    </table>
  `;

  return `${blocks}${grand}`;
}

function renderMonthly(r: MemberGivingMonthlyReport) {
  const categories = r.monthly.categories;
  const table = (
    rows: MemberGivingMonthlyReport["monthly"]["member_totals"],
    categoryTotals: Record<string, number>,
    total: number,
    totalLabel: string,
  ) => `
    <table class="monthly">
      <thead><tr>
        <th class="member-col">Member</th>
        ${categories.map((category) => `<th class="right">${esc(category.name)}</th>`).join("")}
        <th class="right">Total</th>
      </tr></thead>
      <tbody>
        ${rows.map((row) => `<tr>
          <td class="member-col">${esc(row.member_name)}</td>
          ${categories.map((category) => `<td class="right">${esc(money(row.category_amounts[category.id] ?? 0))}</td>`).join("")}
          <td class="right bold">${esc(money(row.total))}</td>
        </tr>`).join("")}
        <tr>
          <td class="member-col bold" style="background:#f1f5f9">${esc(totalLabel)}</td>
          ${categories.map((category) => `<td class="right bold" style="background:#f1f5f9">${esc(money(categoryTotals[category.id] ?? 0))}</td>`).join("")}
          <td class="right bold" style="background:#f1f5f9">${esc(money(total))}</td>
        </tr>
      </tbody>
    </table>`;

  const months = r.monthly.months.map((month) => `
    <section class="break-avoid" style="margin-bottom:22px;">
      <div style="border:1px solid #000;border-bottom:0;background:#f1f5f9;padding:5px 7px;font-size:10pt;font-weight:700;">
        ${esc(month.label)} <span class="muted" style="font-weight:400">(${esc(month.covered_start)} to ${esc(month.covered_end)})</span>
      </div>
      ${table(month.rows, month.category_totals, month.subtotal, `${month.label} total`)}
    </section>`).join("");

  return `${months}
    <section class="break-avoid">
      <div style="border:1px solid #000;border-bottom:0;background:#e2e8f0;padding:5px 7px;font-size:10pt;font-weight:700;">Report totals</div>
      ${table(r.monthly.member_totals, r.monthly.category_totals, r.monthly.grand_total, "Grand total")}
    </section>`;
}
