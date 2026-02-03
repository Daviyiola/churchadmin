import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveOrgByToken } from "@/lib/schedule/public";
import { cleanStr, isYYYYMM } from "@/lib/schedule/util";

type ErrorJson = { error: string };

export async function POST(req: Request) {
  const bodyUnknown: unknown = await req.json().catch(() => null);
  if (!bodyUnknown || typeof bodyUnknown !== "object") {
    return NextResponse.json<ErrorJson>({ error: "Invalid payload" }, { status: 400 });
  }
  const body = bodyUnknown as Record<string, unknown>;

  const token = cleanStr(body.token);
  const month = cleanStr(body.month);
  const code = cleanStr(body.code);

  if (!token) return NextResponse.json<ErrorJson>({ error: "Missing token" }, { status: 400 });
  if (!month || !isYYYYMM(month)) return NextResponse.json<ErrorJson>({ error: "Invalid month" }, { status: 400 });
  if (!code) return NextResponse.json<ErrorJson>({ error: "Missing code" }, { status: 400 });

  const resolved = await resolveOrgByToken(token);
  if (!resolved.ok) {
    return NextResponse.json<ErrorJson>({ error: resolved.error }, { status: resolved.status });
  }

  const { data: ok, error: vErr } = await supabaseAdmin.rpc("schedule_verify_month_code", {
    p_org_id: resolved.org_id,
    p_month: month,
    p_code: code,
  });

  if (vErr) return NextResponse.json<ErrorJson>({ error: vErr.message }, { status: 400 });

  return NextResponse.json({ ok: true, valid: Boolean(ok) });
}
