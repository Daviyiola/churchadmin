import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireActorId } from "@/lib/server/authUser";
import { requireOrgOperator } from "@/lib/schedule/admin_auth";

export async function requirePeopleOperator(req: Request, orgId: string) {
  const actorId = await requireActorId(req);
  const access = await requireOrgOperator(actorId, orgId);
  if (!access.ok) throw new Error(access.error);
  return { actorId, role: access.role };
}

export async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

export async function directoryMembers(orgId: string) {
  return fetchAll<Record<string, unknown>>((from, to) => supabaseAdmin.from("members")
    .select("id,first_name,last_name,email,status,joined_at")
    .eq("org_id", orgId).eq("membership_stage", "member").in("status", ["active", "archived"])
    .order("first_name").order("last_name").range(from, to));
}

export function apiStatus(message: string) {
  if (message === "UNAUTHORIZED") return 401;
  if (message.startsWith("Forbidden")) return 403;
  if (message.includes("not found") || message.includes("INVALID")) return 404;
  return 400;
}
