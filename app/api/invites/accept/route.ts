import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Server-side "verify user" helper using the user's access token
const supabaseVerify = createClient(url, anon, { auth: { persistSession: false } });

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!jwt) return NextResponse.json({ error: "Missing auth token" }, { status: 401 });

  const { data: userData, error: userErr } = await supabaseVerify.auth.getUser(jwt);
  if (userErr || !userData.user) return NextResponse.json({ error: "Invalid auth token" }, { status: 401 });

  const user = userData.user;

  const { token } = await req.json();
  if (!token) return NextResponse.json({ error: "Missing invite token" }, { status: 400 });

  const { data: invite, error: invErr } = await supabaseAdmin
    .from("invites")
    .select("*")
    .eq("token", token)
    .is("used_at", null)
    .maybeSingle();

  if (invErr || !invite) return NextResponse.json({ error: "Invite not found or already used" }, { status: 400 });

  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "Invite has expired" }, { status: 400 });
  }

  const invitedEmail = String(invite.invited_email).toLowerCase();
  const userEmail = String(user.email || "").toLowerCase();

  if (invitedEmail !== userEmail) {
    return NextResponse.json({ error: "This invite is for a different email address" }, { status: 403 });
  }

  const { data: organizationId, error: acceptError } = await supabaseAdmin.rpc(
    "accept_organization_invite",
    { p_token: token, p_user_id: user.id },
  );
  if (acceptError) {
    const capacity = acceptError.message.includes("PLAN_CAPACITY_REACHED");
    return NextResponse.json(
      { error: capacity ? "This organization has reached its management-seat limit. Ask an owner to upgrade or free a seat." : acceptError.message },
      { status: capacity ? 409 : 400 },
    );
  }
  return NextResponse.json({ ok: true, organization_id: organizationId });
}
