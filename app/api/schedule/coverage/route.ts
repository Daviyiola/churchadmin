import { nikkyErrorResponse, requireSelectedNikkyMembership } from "@/lib/server/nikky/auth";

export const runtime = "nodejs";
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const ROLE = new Set(["lead", "asst", "member"]);

export async function GET(req: Request) {
  try {
    const actor = await requireSelectedNikkyMembership(req);
    const month = new URL(req.url).searchParams.get("month") ?? "";
    if (!MONTH.test(month)) return Response.json({ error: "month must be YYYY-MM" }, { status: 400 });
    const [monthResult, categories, defaults] = await Promise.all([
      actor.supabase.from("schedule_months").select("id,month").eq("org_id", actor.organizationId).eq("month", month).maybeSingle(),
      actor.supabase.from("categories").select("id,name,type").eq("org_id", actor.organizationId).eq("status", "active").in("type", ["services", "department"]).order("name"),
      actor.supabase.from("schedule_coverage_requirements").select("id,is_default,requirement_date,service_category_id,department_category_id,role,required_count").eq("org_id", actor.organizationId).eq("is_default", true).order("created_at"),
    ]);
    if (monthResult.error) throw new Error(monthResult.error.message);
    if (categories.error) throw new Error(categories.error.message);
    if (defaults.error) throw new Error(defaults.error.message);
    let dateTargets: unknown[] = [];
    if (monthResult.data) {
      const rows = await actor.supabase.from("schedule_coverage_requirements")
        .select("id,is_default,requirement_date,service_category_id,department_category_id,role,required_count")
        .eq("org_id", actor.organizationId).eq("month_id", monthResult.data.id).eq("is_default", false).order("requirement_date");
      if (rows.error) throw new Error(rows.error.message);
      dateTargets = rows.data ?? [];
    }
    return Response.json({ month_id: monthResult.data?.id ?? null, categories: categories.data ?? [], default_targets: defaults.data ?? [], date_targets: dateTargets });
  } catch (error) {
    return nikkyErrorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    const actor = await requireSelectedNikkyMembership(req);
    const body = (await req.json()) as Record<string, unknown>;
    if (body.action === "delete") {
      if (Object.keys(body).some((key) => !["action", "requirement_id"].includes(key)) || typeof body.requirement_id !== "string") return Response.json({ error: "Invalid delete request." }, { status: 400 });
      const { error } = await actor.supabase.rpc("delete_schedule_coverage_requirement", { p_requirement_id: body.requirement_id });
      if (error) throw new Error(error.message);
      return new Response(null, { status: 204 });
    }
    if (body.action === "create_category") {
      if (Object.keys(body).some((key) => !["action", "type", "name"].includes(key)) || !["services", "department"].includes(String(body.type))) return Response.json({ error: "Invalid category request." }, { status: 400 });
      const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
      if (!name || name.length > 120) return Response.json({ error: "Enter a valid category name." }, { status: 400 });
      const type = String(body.type);
      const existing = await actor.supabase.from("categories").select("id,name,type").eq("org_id", actor.organizationId).eq("type", type).ilike("name", name).maybeSingle();
      if (existing.error) throw new Error(existing.error.message);
      if (existing.data) return Response.json({ category: existing.data });
      const { data, error } = await actor.supabase.from("categories").insert({ org_id: actor.organizationId, name, type, status: "active", created_by: actor.user.id }).select("id,name,type").single();
      if (error) throw new Error(error.message);
      return Response.json({ category: data });
    }
    const allowed = ["action", "scope", "month_id", "requirement_date", "service_category_id", "department_category_id", "role", "required_count"];
    if (Object.keys(body).some((key) => !allowed.includes(key)) || body.action !== "upsert") return Response.json({ error: "Invalid staffing target request." }, { status: 400 });
    const scope = String(body.scope ?? "");
    if (!["default", "date"].includes(scope) || !ROLE.has(String(body.role))) return Response.json({ error: "Invalid staffing target request." }, { status: 400 });
    const { data, error } = await actor.supabase.rpc("upsert_schedule_staffing_target", {
      p_org_id: actor.organizationId,
      p_scope: scope,
      p_month_id: scope === "date" ? body.month_id : null,
      p_requirement_date: scope === "date" ? body.requirement_date : null,
      p_service_category_id: body.service_category_id,
      p_department_category_id: body.department_category_id,
      p_role: body.role,
      p_required_count: body.required_count,
    });
    if (error) throw new Error(error.message);
    return Response.json({ requirement: data });
  } catch (error) {
    return nikkyErrorResponse(error);
  }
}
