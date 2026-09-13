import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAttendanceStaff, routeError } from "@/lib/server/attendance/checkin";

export async function PATCH(req: Request, context: { params: Promise<{ windowId: string }> }) {
  try {
    const { windowId } = await context.params;
    const { data: window } = await supabaseAdmin.from("attendance_checkin_windows").select("org_id,status").eq("id", windowId).maybeSingle();
    if (!window) return Response.json({ error: "Check-in window not found." }, { status: 404 });
    const actor = await requireAttendanceStaff(req, window.org_id);
    const body = await req.json() as Record<string, unknown>;
    if (Object.keys(body).some((key) => key !== "action") || !["close", "cancel"].includes(String(body.action))) return Response.json({ error: "Choose close or cancel." }, { status: 400 });
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin.from("attendance_checkin_windows").update({ status: body.action === "close" ? "closed" : "cancelled", closed_at: now, closed_by: actor.userId, updated_at: now }).eq("id", windowId).in("status", ["scheduled", "open"]);
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (error) { return routeError(error); }
}
