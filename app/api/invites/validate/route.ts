import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  const { token, email } = await req.json();

  if (!token || !email) {
    return NextResponse.json({ error: "token and email are required" }, { status: 400 });
  }

  const { data: invite, error } = await supabaseAdmin
    .from("invites")
    .select("id, invited_email, expires_at, used_at")
    .eq("token", token)
    .maybeSingle();

  if (error || !invite) {
    return NextResponse.json({ error: "Invite not found" }, { status: 400 });
  }

  if (invite.used_at) {
    return NextResponse.json({ error: "Invite already used" }, { status: 400 });
  }

  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "Invite expired" }, { status: 400 });
  }

  const invited = String(invite.invited_email).toLowerCase();
  const entered = String(email).toLowerCase().trim();

  if (invited !== entered) {
    return NextResponse.json({ error: "This invite is for a different email address" }, { status: 403 });
  }

  return NextResponse.json({ ok: true });
}
