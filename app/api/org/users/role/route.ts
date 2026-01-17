import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type Role = "owner" | "admin" | "finance" | "viewer" | "member";

export async function POST(req: Request) {
  const { organization_id, user_id, role: newRole } = (await req.json()) as {
    organization_id: string;
    user_id: string;
    role: Role;
  };

  if (!organization_id || !user_id || !newRole) {
    return NextResponse.json(
      { error: "organization_id, user_id, and role are required" },
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

  const callerId = userRes.user.id;

  if (callerId === user_id) {
    return NextResponse.json(
      { error: "You cannot change your own role." },
      { status: 400 }
    );
  }

  const { data: callerMembership, error: callerMemErr } = await supabaseAdmin
    .from("user_organizations")
    .select("role")
    .eq("organization_id", organization_id)
    .eq("user_id", callerId)
    .maybeSingle();

  if (callerMemErr) {
    return NextResponse.json({ error: callerMemErr.message }, { status: 400 });
  }

  const callerRole = (callerMembership?.role ?? null) as Role | null;
  const callerIsAdmin = callerRole === "admin" || callerRole === "owner";
  const callerIsOwner = callerRole === "owner";

  if (!callerIsAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: targetMembership, error: targetMemErr } = await supabaseAdmin
    .from("user_organizations")
    .select("role")
    .eq("organization_id", organization_id)
    .eq("user_id", user_id)
    .maybeSingle();

  if (targetMemErr) {
    return NextResponse.json({ error: targetMemErr.message }, { status: 400 });
  }

  if (!targetMembership) {
    return NextResponse.json({ error: "User is not in this organization." }, { status: 404 });
  }

  const targetRole = (targetMembership.role ?? null) as Role | null;


  if (newRole === "owner" && !callerIsOwner) {
    return NextResponse.json(
      { error: "Only an owner can promote someone to owner." },
      { status: 403 }
    );
  }

  if (targetRole === "admin" && newRole !== "admin" && !callerIsOwner) {
    return NextResponse.json(
      { error: "Only an owner can demote an admin." },
      { status: 403 }
    );
  }

  const { error: updErr } = await supabaseAdmin
    .from("user_organizations")
    .update({ role: newRole })
    .eq("organization_id", organization_id)
    .eq("user_id", user_id);

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
