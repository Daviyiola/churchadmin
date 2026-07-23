export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { Page } from "puppeteer-core";
import { launchBrowser } from "@/lib/server/pdf/launchBrowser";

import type { RunMemberGivingBody, ErrorResponse } from "@/lib/reports/members/types";
import { runMemberGivingReportFromToken } from "@/lib/server/reports/memberGiving";
import { renderMemberGivingHtml } from "@/lib/server/reports/memberGivingHtml";
import {
  getBearerToken,
  reportErrorStatus,
} from "@/lib/server/reports/requestSupabase";

type OkJson = {
  ok: true;
  filename: string;
  contentType: "application/pdf";
  base64: string;
};

function safeFilePart(s: string) {
  return s.replace(/[^\w\-]+/g, "_").slice(0, 80);
}

export async function POST(req: Request) {
  let page: Page | null = null;

  try {
    const body: RunMemberGivingBody = await req.json();

    if (
      !body.organization_id ||
      !body.member_id ||
      !body.mode ||
      !body.start_date ||
      !body.end_date
    ) {
      return NextResponse.json(
        {
          error:
            "organization_id, member_id, mode, start_date, end_date are required",
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    const accessToken = getBearerToken(req);

    if (!accessToken) {
      return NextResponse.json(
        { error: "Unauthorized" } satisfies ErrorResponse,
        { status: 401 },
      );
    }

    const report = await runMemberGivingReportFromToken(body, accessToken);

    const filtersLineParts: string[] = [];
    if (body.service_ids?.length)
      filtersLineParts.push(`Services: ${body.service_ids.length}`);
    if (body.category_ids?.length)
      filtersLineParts.push(`Categories: ${body.category_ids.length}`);
    if (body.payment_methods?.length)
      filtersLineParts.push(`Methods: ${body.payment_methods.join(", ")}`);
    const filtersLine = filtersLineParts.join(" • ");

    const html = renderMemberGivingHtml(report, filtersLine);

    const browser = await launchBrowser();
    page = await browser.newPage();

    await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 200));

    const pdf = await page.pdf({
      format: "Letter",
      printBackground: true,
      margin: { top: "0.4in", bottom: "0.4in", left: "0.4in", right: "0.4in" },
    });

    const base64 = Buffer.from(pdf).toString("base64");

    const memberPart = safeFilePart(report.member.name || "member");
    const viewPart = report.meta.view;
    const filename = `Member_Giving_${viewPart}_${memberPart}_${body.start_date}_to_${body.end_date}.pdf`;

    return NextResponse.json<OkJson>({
      ok: true,
      filename,
      contentType: "application/pdf",
      base64,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg } satisfies ErrorResponse, {
      status: reportErrorStatus(e),
    });
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {
        // ignore
      }
    }
  }
}
