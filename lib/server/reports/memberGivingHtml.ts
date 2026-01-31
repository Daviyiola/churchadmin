import type {
  MemberGivingReport,
  MemberGivingSummaryReport,
  MemberGivingDetailedReport,
} from "@/lib/reports/members/types";

function isSummary(r: MemberGivingReport): r is MemberGivingSummaryReport {
  return r.meta.view === "summary";
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
  const memberName = esc(report.member.name);
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
  `;

  const headerHtml = `
    <div class="center">
      ${logo ? `<div style="margin-bottom:8px;"><img src="${esc(logo)}" style="height:80px;width:80px;object-fit:contain" /></div>` : `<div style="height:10px;"></div>`}
      <div class="h1">${header}</div>
      <div class="h2">${subheader}</div>
      <div class="meta">Time Period: ${period}</div>
      <div class="meta2">Member: ${memberName}</div>
      ${filtersLine ? `<div class="filters">${esc(filtersLine)}</div>` : ``}
    </div>
  `;

  const bodyHtml = isSummary(report) ? renderSummary(report) : renderDetailed(report as MemberGivingDetailedReport);

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
