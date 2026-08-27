import { NextResponse } from "next/server";
import { requireSmsOperator, smsRouteError } from "@/lib/server/sms/auth";
import { getSmsAudienceOptions } from "@/lib/server/sms/audienceResolver";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const orgId = new URL(req.url).searchParams.get("organization_id")?.trim() ?? "";
    if (!orgId) throw new Error("organization_id required");
    await requireSmsOperator(req, orgId);
    return NextResponse.json(await getSmsAudienceOptions(orgId));
  } catch (error) {
    const result = smsRouteError(error);
    return NextResponse.json({ error: result.message }, { status: result.status });
  }
}
