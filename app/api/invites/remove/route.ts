import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type Role = "owner" | "admin" | "finance" | "viewer" | "member";

export async function POST(req: Request) {
  const { organization_id, token } = await req.json();

  if (!organization_id || !token) {
    return NextResponse.json(
      { error: "organization_id and token are required" },
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

  const role = (membership?.role ?? null) as Role | null;
  if (role !== "admin" && role !== "owner") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: deleted, error: delErr } = await supabaseAdmin
    .from("invites")
    .delete()
    .eq("organization_id", organization_id)
    .eq("token", token)
    .is("used_at", null)
    .select("token");

  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 400 });
  }

  if (!deleted || deleted.length === 0) {
    return NextResponse.json(
      { error: "Invite not found or already used." },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true });
}
