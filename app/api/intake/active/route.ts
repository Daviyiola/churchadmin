import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const memberId = String(searchParams.get("member_id") ?? "").trim();
  if (!memberId) return NextResponse.json({ error: "Missing member_id" }, { status: 400 });

  const { data: tok, error } = await supabaseAdmin
    .from("intake_tokens")
    .select("token,expires_at,used_at")
    .eq("member_id", memberId)
    .is("used_at", null)
    .order("expires_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!tok) return NextResponse.json({ ok: true, intakeUrl: null });

  if (new Date(tok.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ ok: true, intakeUrl: null });
  }

  const base = process.env.NEXT_PUBLIC_APP_URL!.replace(/\/$/, "");
  return NextResponse.json({
    ok: true,
    intakeUrl: `${base}/intake/${tok.token}`,
    expires_at: tok.expires_at,
  });
}
