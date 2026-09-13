import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAttendanceStaff, routeError } from "@/lib/server/attendance/checkin";

export async function POST(req: Request) {
  try {
    const orgId = req.headers.get("x-organization-id")?.trim() ?? "";
    if (!orgId) return Response.json({ error: "Select an organization." }, { status: 400 });
    const actor = await requireAttendanceStaff(req, orgId);
    const body = await req.json() as Record<string, unknown>;
    if (Object.keys(body).some((key) => key !== "name")) return Response.json({ error: "Unsupported field." }, { status: 400 });
    const name = String(body.name ?? "").trim().replace(/\s+/g, " ");
    if (!name || name.length > 100) return Response.json({ error: "Enter a service name." }, { status: 400 });
    const nameNorm = name.toLowerCase();
    const { data: existing, error: lookupError } = await supabaseAdmin.from("categories").select("id,name,status").eq("org_id", orgId).eq("type", "services").eq("name_norm", nameNorm).maybeSingle();
    if (lookupError) throw lookupError;
    if (existing?.status === "archived") return Response.json({ error: "A service with this name is archived. An owner or admin can restore it in Categories." }, { status: 409 });
    if (existing) return Response.json({ service: existing });
    const { data, error } = await supabaseAdmin.from("categories").insert({ org_id: orgId, name, type: "services", status: "active", created_by: actor.userId }).select("id,name,status").single();
    if (error) {
      const { data: concurrent } = await supabaseAdmin.from("categories").select("id,name,status").eq("org_id", orgId).eq("type", "services").eq("name_norm", nameNorm).maybeSingle();
      if (concurrent?.status === "active") return Response.json({ service: concurrent });
      throw error;
    }
    return Response.json({ service: data }, { status: 201 });
  } catch (error) { return routeError(error); }
}
