import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAttendanceStaff, routeError } from "@/lib/server/attendance/checkin";

async function codeContext(codeId: string) {
  const { data, error } = await supabaseAdmin.from("attendance_checkin_codes").select("*").eq("id", codeId).maybeSingle();
  if (error || !data) throw Object.assign(new Error("QR code not found."), { status: 404 });
  return data;
}

export async function PATCH(req: Request, context: { params: Promise<{ codeId: string }> }) {
  try {
    const { codeId } = await context.params;
    const code = await codeContext(codeId);
    const actor = await requireAttendanceStaff(req, code.org_id);
    const body = await req.json() as Record<string, unknown>;
    const allowed = new Set(["name", "default_service_category_id", "expires_on"]);
    if (Object.keys(body).some((key) => !allowed.has(key))) return Response.json({ error: "Unsupported field." }, { status: 400 });
    const patch: Record<string, unknown> = { updated_by: actor.userId, updated_at: new Date().toISOString() };
    if ("name" in body) patch.name = String(body.name ?? "").trim();
    if ("default_service_category_id" in body) patch.default_service_category_id = body.default_service_category_id || null;
    if ("expires_on" in body) patch.expires_on = body.expires_on || null;
    const { data, error } = await supabaseAdmin.from("attendance_checkin_codes").update(patch).eq("id", code.id).eq("org_id", code.org_id).eq("status", "active").select().single();
    if (error) throw error;
    return Response.json({ code: data });
  } catch (error) { return routeError(error); }
}

export async function DELETE(req: Request, context: { params: Promise<{ codeId: string }> }) {
  try {
    const { codeId } = await context.params;
    const code = await codeContext(codeId);
    const actor = await requireAttendanceStaff(req, code.org_id);
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin.from("attendance_checkin_codes").update({ status: "revoked", revoked_at: now, revoked_by: actor.userId, updated_at: now, updated_by: actor.userId, token_version: code.token_version + 1 }).eq("id", code.id).eq("status", "active");
    if (error) throw error;
    await supabaseAdmin.from("attendance_checkin_windows").update({ status: "cancelled", closed_at: now, closed_by: actor.userId, updated_at: now }).eq("code_id", code.id).in("status", ["scheduled", "open"]);
    return Response.json({ ok: true });
  } catch (error) { return routeError(error); }
}
