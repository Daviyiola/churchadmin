import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import crypto from "crypto";

type Role = "owner" | "admin" | "finance" | "member";

export async function POST(req: Request) {
  const { organization_id, invited_email, role } = await req.json();

  if (!organization_id || !invited_email) {
    return NextResponse.json(
      { error: "organization_id and invited_email are required" },
      { status: 400 }
    );
  }

  const authHeader = req.headers.get("authorization") || "";
  const accessToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;

  if (!accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: userRes, error: userErr } =
    await supabaseAdmin.auth.getUser(accessToken);

  if (userErr || !userRes?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = userRes.user.id;

  const { data: membership, error: memErr } = await supabaseAdmin
    .from("user_organizations")
    .select("role")
    .eq("organization_id", organization_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (memErr) {
    return NextResponse.json({ error: memErr.message }, { status: 400 });
  }

  const myRole = (membership?.role ?? null) as Role | null;
  if (myRole !== "admin" && myRole !== "owner") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const email = String(invited_email).toLowerCase().trim();


  const nowIso = new Date().toISOString();
  const { data: existing, error: exErr } = await supabaseAdmin
    .from("invites")
    .select("token, expires_at")
    .eq("organization_id", organization_id)
    .eq("invited_email", email)
    .is("used_at", null)
    .gt("expires_at", nowIso)
    .maybeSingle();

  if (exErr) {
    return NextResponse.json({ error: exErr.message }, { status: 400 });
  }

  if (existing?.token) {
    const inviteUrl = `${
      process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
    }/invite/${existing.token}`;
    return NextResponse.json({ inviteUrl, reused: true });
  }

  // 2) Otherwise create a new invite
  const token = crypto.randomUUID();

  const { error } = await supabaseAdmin.from("invites").insert({
    token,
    organization_id,
    invited_email: email,
    role: role || "member",
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const inviteUrl = `${
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  }/invite/${token}`;
  return NextResponse.json({ inviteUrl, reused: false });
}
