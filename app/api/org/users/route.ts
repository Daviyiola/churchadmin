import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type ProfileShape = { email: string | null };

type UserOrgRow = {
  user_id: string;
  role: string;
  created_at: string;
  profiles?: ProfileShape | ProfileShape[] | null;
};

type InviteRow = {
  invited_email: string;
  role: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  token: string;
};

type Role = "owner" | "admin" | "finance" | "member";

function asRole(raw: unknown): Role {
  const v = String(raw);
  if (v === "owner" || v === "admin" || v === "finance" || v === "member") {
    return v;
  }
  return "member"; // fallback
}


export async function POST(req: Request) {
  const { organization_id } = await req.json();

  if (!organization_id) {
    return NextResponse.json(
      { error: "organization_id is required" },
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

  const { data: userRes, error: userErrAuth } =
    await supabaseAdmin.auth.getUser(accessToken);

  if (userErrAuth || !userRes?.user) {
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

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // (Optional) If you want only admin/owner to see invites later:
  // const myRole = (membership.role as Role) ?? "member";
  // const isAdmin = myRole === "admin" || myRole === "owner";

  // Active users (linked)
  const { data: userRows, error: userErr } = await supabaseAdmin
    .from("user_organizations")
    .select(
      `
      user_id,
      role,
      created_at,
      profiles:profiles ( email )
    `
    )
    .eq("organization_id", organization_id)
    .order("created_at", { ascending: true });

  if (userErr) {
    return NextResponse.json({ error: userErr.message }, { status: 400 });
  }

  const activeUsers = ((userRows ?? []) as UserOrgRow[]).map((row) => {
    const p = row.profiles;
    const email = Array.isArray(p) ? p[0]?.email ?? "" : p?.email ?? "";

    return {
      key: row.user_id,
      user_id: row.user_id,
      email,
      role: asRole(row.role),
      joined_at: row.created_at,
      status: "active" as const,
    };
  });

  // Pending invites (not used, not expired)
  const nowIso = new Date().toISOString();

  const { data: inviteRows, error: invErr } = await supabaseAdmin
    .from("invites")
    .select("invited_email,role,created_at,expires_at,used_at,token")
    .eq("organization_id", organization_id)
    .is("used_at", null)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false });

  if (invErr) {
    return NextResponse.json({ error: invErr.message }, { status: 400 });
  }

  const invitedUsers = ((inviteRows ?? []) as InviteRow[]).map((inv) => ({
  key: `invite:${inv.token}`,
  user_id: null as string | null,
  email: inv.invited_email,
  role: asRole(inv.role), 
  joined_at: inv.created_at,
  status: "invited" as const,
  token: inv.token,
  expires_at: inv.expires_at,
}));

  return NextResponse.json({
    users: [...activeUsers, ...invitedUsers],
  });
}
