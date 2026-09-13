import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAttendanceStaff, routeError } from "@/lib/server/attendance/checkin";
import { validateRecurrence } from "@/lib/attendance/recurrence";

async function actorFor(req: Request, codeId: string) {
  const { data, error } = await supabaseAdmin.from("attendance_checkin_codes").select("org_id").eq("id", codeId).maybeSingle();
  if (error || !data) throw Object.assign(new Error("QR code not found."), { status: 404 });
  return requireAttendanceStaff(req, data.org_id);
}
export async function PUT(req: Request, context: { params: Promise<{ codeId: string }> }) {
  try {
    const { codeId } = await context.params;
    const actor = await actorFor(req, codeId);
    const settings = validateRecurrence(await req.json());
    const { error } = await actor.supabase.rpc("save_attendance_checkin_schedule", { p_code_id: codeId, p_settings: settings });
    if (error) throw new Error(error.message);
    return Response.json({ ok: true });
  } catch (error) { return routeError(error); }
}
export async function PATCH(req: Request, context: { params: Promise<{ codeId: string }> }) {
  try {
    const { codeId } = await context.params;
    const actor = await actorFor(req, codeId);
    const body = await req.json();
    if (!body || Object.keys(body).some(key => !["action", "date"].includes(key)) || !["pause", "resume", "skip"].includes(body.action)) throw new Error("Choose pause, resume, or skip.");
    const { error } = await actor.supabase.rpc("act_attendance_checkin_schedule", { p_code_id: codeId, p_action: body.action, p_date: body.date || null });
    if (error) throw new Error(error.message);
    return Response.json({ ok: true });
  } catch (error) { return routeError(error); }
}
