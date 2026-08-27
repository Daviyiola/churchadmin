import { requireActorId } from "@/lib/server/authUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function requireBillingActor(req: Request, organizationId: string, mutate = false) {
  const userId = await requireActorId(req);
  const { data, error } = await supabaseAdmin.from("user_organizations").select("role")
    .eq("organization_id", organizationId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  const role = String(data?.role ?? "");
  if (!(["owner","admin","finance"].includes(role)) || (mutate && role !== "owner")) throw new Error("FORBIDDEN");
  return { userId, role };
}
