import { NextResponse } from "next/server";
import { requireSmsOperator, smsRouteError } from "@/lib/server/sms/auth";
import { saveSmsOnboarding } from "@/lib/server/sms/repository";

export const runtime = "nodejs";

export async function PATCH(req: Request) {
  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body.organization_id !== "string" || !body.draft || typeof body.draft !== "object") throw new Error("Invalid setup request.");
    const actor = await requireSmsOperator(req, body.organization_id);
    const draft = await saveSmsOnboarding(body.organization_id, actor.userId, body.draft as Record<string, unknown>);
    return NextResponse.json({ onboarding: draft });
  } catch (error) {
    const result = smsRouteError(error);
    return NextResponse.json({ error: result.message }, { status: result.status });
  }
}
