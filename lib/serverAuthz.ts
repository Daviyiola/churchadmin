// lib/serverAuthz.ts
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  canSendBroadcastEmail,
  canSendMemberGivingEmail,
  type OrganizationRole,
} from "@/lib/emailPermissions";

export type OrgRole = OrganizationRole;

export function getBearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice("Bearer ".length).trim();
  return token || null;
}

export async function requireUser(req: Request): Promise<
  | { ok: true; userId: string }
  | { ok: false; status: 401; error: string }
> {
  const token = getBearerToken(req);
  if (!token) return { ok: false, status: 401, error: "Unauthorized" };

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return { ok: false, status: 401, error: "Unauthorized" };

  return { ok: true, userId: data.user.id };
}

export async function requireOrgOwnerOrAdmin(
  organizationId: string,
  userId: string,
): Promise<
  | { ok: true; role: "owner" | "admin" }
  | { ok: false; status: 400 | 403; error: string }
> {
  const { data, error } = await supabaseAdmin
    .from("user_organizations")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle<{ role: OrgRole }>();

  if (error) return { ok: false, status: 400, error: error.message };
  if (!data || !canSendMemberGivingEmail(data.role)) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  return { ok: true, role: data.role };
}

export async function requireOrgFinanceOrAbove(
  organizationId: string,
  userId: string,
): Promise<
  | { ok: true; role: "owner" | "admin" | "finance" }
  | { ok: false; status: 400 | 403; error: string }
> {
  const { data, error } = await supabaseAdmin
    .from("user_organizations")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle<{ role: OrgRole }>();

  if (error) return { ok: false, status: 400, error: error.message };
  if (!data || !canSendBroadcastEmail(data.role)) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  return { ok: true, role: data.role };
}
