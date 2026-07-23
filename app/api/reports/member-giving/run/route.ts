import { runMemberGivingReportFromToken } from "@/lib/server/reports/memberGiving";
import type { RunMemberGivingBody, ErrorResponse } from "@/lib/reports/members/types";
import { NextResponse } from "next/server";
import {
  getBearerToken,
  reportErrorStatus,
} from "@/lib/server/reports/requestSupabase";

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

    const accessToken = getBearerToken(req);
    if (!accessToken) {
      return NextResponse.json({ error: "Unauthorized" } satisfies ErrorResponse, { status: 401 });
    }

    const report = await runMemberGivingReportFromToken(body, accessToken);
    return NextResponse.json(report);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: msg } satisfies ErrorResponse,
      { status: reportErrorStatus(e) },
    );
  }
}
