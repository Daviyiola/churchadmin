import { NextResponse } from "next/server";
import { requireSmsOperator, smsRouteError } from "@/lib/server/sms/auth";
import { ensureSmsSettings, getSmsState } from "@/lib/server/sms/repository";
import { getSmsReadiness } from "@/lib/server/sms/audienceResolver";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const orgId = new URL(req.url).searchParams.get("organization_id")?.trim() ?? "";
    if (!orgId) throw new Error("organization_id required");
    const actor = await requireSmsOperator(req, orgId);
    await ensureSmsSettings(orgId, actor.userId);
    const [state, readiness] = await Promise.all([getSmsState(orgId), getSmsReadiness(orgId)]);
    return NextResponse.json({ ...state, readiness, actor_role: actor.role, sending_enabled: false });
  } catch (error) {
    const result = smsRouteError(error);
    return NextResponse.json({ error: result.message }, { status: result.status });
  }
}
