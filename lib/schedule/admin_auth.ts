import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type OrgRole = "owner" | "admin" | "finance" | "member" | "viewer";

export async function requireOrgOperator(actorId: string, orgId: string) {
  const { data: link, error } = await supabaseAdmin
    .from("user_organizations")
    .select("role")
    .eq("user_id", actorId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (error) return { ok: false as const, error: error.message, status: 400 };
  if (!link) return { ok: false as const, error: "Forbidden", status: 403 };

  const role = String(link.role) as OrgRole;
  if (!["owner", "admin", "finance"].includes(role)) {
    return { ok: false as const, error: "Forbidden: insufficient role", status: 403 };
  }
  return { ok: true as const, role };
}
