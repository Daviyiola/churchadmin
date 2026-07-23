import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { chromium } from "playwright";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getBearerToken,
  getReportRequestContext,
  reportErrorStatus,
  requireFinanceDateWindow,
  requireReportRoles,
  requireValidReportDateRange,
} from "@/lib/server/reports/requestSupabase";

type Mode = "income" | "expense" | "attendance";

type PaymentMethod = "cash" | "cheque" | "online";

type AttendanceView = "summary" | "detailed";

type QuickReportRequest = {
  organization_id: string;
  mode: Mode;
  start_date: string; // yyyy-mm-dd
  end_date: string;   // yyyy-mm-dd

  // categories table ids
  service_ids?: string[];   // categories.type='services'
  category_ids?: string[];  // income or expense depending on mode

  payment_methods?: PaymentMethod[];

  // expense
  vendors?: string[];

  // attendance
  segments?: ("men" | "women" | "boys" | "girls")[];
  age_groups?: string[]; // whatever you store
  attendance_view?: AttendanceView;
};

type BuildReportArgs = {
  supabase: SupabaseClient;
  organizationId: string;
  mode: Mode;
  body: QuickReportRequest;
};

export async function GET() {
  return NextResponse.json(
    { error: "PDF endpoint not implemented yet" },
    { status: 501 }
  );
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as QuickReportRequest;
    const { organization_id, mode } = body;

    if (!organization_id || !mode || !body.start_date || !body.end_date) {
      return NextResponse.json(
        { error: "organization_id, mode, start_date, and end_date are required" },
        { status: 400 },
      );
    }

    const accessToken = getBearerToken(req);
    if (!accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    requireValidReportDateRange(body.start_date, body.end_date);

    const { supabase, role } = await getReportRequestContext(
      accessToken,
      organization_id,
    );
    requireReportRoles(role, ["owner", "admin", "finance"]);
    if (mode === "income" || mode === "expense") {
      requireFinanceDateWindow(role, body.start_date);
    }

    // --- Fetch org settings for header/subheader + logo path ---
    const { data: orgSettings } = await supabase
      .from("organization_settings")
      .select("report_header_text,report_subheader_text,report_banner_bg_rgb,report_banner_text_rgb")
      .eq("organization_id", organization_id)
      .maybeSingle();

    // --- Resolve logo (signed url recommended) ---
    const logoPath = `org/${organization_id}/logo.png`; // adjust if you store extension dynamically
    const { data: signed } = await supabaseAdmin.storage
      .from("org-logos")
      .createSignedUrl(logoPath, 60);

    const logoUrl = signed?.signedUrl ?? null;

    // --- Query data depending on mode ---
    // NOTE: implement these 3 functions as pure helpers that return {title, filtersLine, tableHtml}
    const report = await buildReportHtml({
      supabase,
      organizationId: organization_id,
      mode,
      body,
    });

    const generatedAt = new Date();
    const generatedText = generatedAt.toISOString().slice(0, 16).replace("T", " ");

    const html = renderFullHtml({
      orgHeader: orgSettings?.report_header_text ?? "",
      orgSubheader: orgSettings?.report_subheader_text ?? "",
      logoUrl,
      bannerBg: orgSettings?.report_banner_bg_rgb ?? "15 23 42",
      bannerText: orgSettings?.report_banner_text_rgb ?? "255 255 255",
      timePeriod: `${body.start_date} to ${body.end_date}`,
      filtersLine: report.filtersLine,
      contentHtml: report.contentHtml,
    });

    // --- Playwright PDF ---
    const browser = await chromium.launch();
    const page = await browser.newPage();

    await page.setContent(html, { waitUntil: "networkidle" });

    const pdf = await page.pdf({
      format: "Letter",
      landscape: true,
      printBackground: true,
      displayHeaderFooter: true,
      margin: { top: "18mm", right: "10mm", bottom: "18mm", left: "10mm" },
      footerTemplate: `
        <div style="width:100%; font-size:10px; padding:0 10mm; display:flex; justify-content:space-between;">
          <div>Generated: ${generatedText}</div>
          <div>Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>
        </div>
      `,
      headerTemplate: `<div></div>`,
    });

    await page.close();
    await browser.close();

    const pdfBytes = new Uint8Array(pdf);

    return new NextResponse(pdfBytes, {
    status: 200,
    headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="quick-report-${mode}.pdf"`,
    },
    });
  } catch (e: unknown) {
  const message = e instanceof Error ? e.message : "Unknown error";
  return NextResponse.json({ error: message }, { status: reportErrorStatus(e) });
}
}

// You’ll implement these:
async function buildReportHtml({ mode, body }: BuildReportArgs) {
  return {
    filtersLine: `Mode: ${mode}, Period: ${body.start_date} to ${body.end_date}`,
    contentHtml: "<div>TODO</div>",
  };
}

function renderFullHtml(args: {
  orgHeader: string;
  orgSubheader: string;
  logoUrl: string | null;
  bannerBg: string;      // "r g b"
  bannerText: string;    // "r g b"
  timePeriod: string;
  filtersLine: string;
  contentHtml: string;
}) {
  const { orgHeader, orgSubheader, logoUrl, bannerBg, bannerText, timePeriod, filtersLine, contentHtml } = args;

  const logoImg = logoUrl
    ? `<img src="${logoUrl}" style="width:56px;height:56px;object-fit:contain;border-radius:12px;" />`
    : `<div style="width:56px;height:56px;"></div>`;

  const filtersHtml = filtersLine
    ? `<div style="margin-top:6px;font-size:11px;color:#334155;">${escapeHtml(filtersLine)}</div>`
    : "";

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 0; color: #0f172a; }
  .page { padding: 10mm; }
  .banner { padding: 14px 16px; border-radius: 18px; background: rgb(${bannerBg}); color: rgb(${bannerText}); }
  .bannerGrid { display: grid; grid-template-columns: 72px 1fr 72px; align-items: center; }
  .title { font-size: 26px; font-weight: 800; text-align: center; line-height: 1.1; }
  .subtitle { font-size: 18px; font-weight: 700; text-align: center; opacity: .95; margin-top: 4px; }
  .meta { margin-top: 10px; font-size: 12px; color: #334155; }
  .meta strong { color: #0f172a; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { border: 1px solid #cbd5e1; padding: 8px 10px; font-size: 11px; }
  th { background: #e2e8f0; text-align: left; font-weight: 700; }
  .right { text-align: right; }
  .center { text-align: center; }
  .totals { background: #f1f5f9; font-weight: 800; }
  .section { margin-top: 14px; }
  .sectionTitle { font-size: 13px; font-weight: 800; margin: 12px 0 6px; }
</style>
</head>
<body>
  <div class="page">
    <div class="banner">
      <div class="bannerGrid">
        <div>${logoImg}</div>
        <div>
          <div class="title">${escapeHtml(orgHeader || "")}</div>
          <div class="subtitle">${escapeHtml(orgSubheader || "")}</div>
        </div>
        <div style="width:72px;"></div>
      </div>
    </div>

    <div class="meta">
      <div><strong>Time Period:</strong> ${escapeHtml(timePeriod)}</div>
      ${filtersHtml}
    </div>

    ${contentHtml}
  </div>
</body>
</html>`;
}

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
