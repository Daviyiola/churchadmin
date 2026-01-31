import { runMemberGivingReportFromToken } from "@/lib/server/reports/memberGiving";
import type { RunMemberGivingBody, ErrorResponse } from "@/lib/reports/members/types";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body: RunMemberGivingBody = await req.json();

    if (!body.organization_id || !body.member_id || !body.mode || !body.start_date || !body.end_date) {
      return NextResponse.json(
        { error: "organization_id, member_id, mode, start_date, end_date are required" } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    const authHeader = req.headers.get("authorization") || "";
    const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    if (!accessToken) {
      return NextResponse.json({ error: "Unauthorized" } satisfies ErrorResponse, { status: 401 });
    }

    const report = await runMemberGivingReportFromToken(body, accessToken);
    return NextResponse.json(report);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg } satisfies ErrorResponse, { status: 400 });
  }
}
