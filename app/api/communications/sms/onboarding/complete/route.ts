import { NextResponse } from "next/server";
import { requireSmsOperator, smsRouteError } from "@/lib/server/sms/auth";
import { completeSmsOnboarding } from "@/lib/server/sms/repository";
import { SMS_ATTESTATION_STATEMENT, SMS_ATTESTATION_VERSION } from "@/lib/sms/attestation";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    const orgId = String(body?.organization_id ?? "").trim();
    if (!orgId || body?.confirmed !== true || body?.statement_version !== SMS_ATTESTATION_VERSION) throw new Error("Confirm the current consent attestation to complete setup.");
    const actor = await requireSmsOperator(req, orgId);
    const result = await completeSmsOnboarding(orgId, actor.userId, actor.role);
    return NextResponse.json({ result, statement: SMS_ATTESTATION_STATEMENT, sending_enabled: false });
  } catch (error) {
    const result = smsRouteError(error);
    return NextResponse.json({ error: result.message }, { status: result.status });
  }
}
