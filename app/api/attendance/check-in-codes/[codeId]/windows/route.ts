import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAttendanceStaff, routeError } from "@/lib/server/attendance/checkin";

export async function POST(req: Request, context: { params: Promise<{ codeId: string }> }) {
  try {
    const { codeId } = await context.params;
    const { data: code } = await supabaseAdmin.from("attendance_checkin_codes").select("org_id").eq("id", codeId).maybeSingle();
    if (!code) return Response.json({ error: "QR code not found." }, { status: 404 });
    const actor = await requireAttendanceStaff(req, code.org_id);
    const body = await req.json() as Record<string, unknown>;
    const allowed = new Set(["session_id", "opens_at", "closes_at"]);
    if (Object.keys(body).some((key) => !allowed.has(key))) return Response.json({ error: "Unsupported field." }, { status: 400 });
    const { data, error } = await actor.supabase.rpc("open_attendance_checkin_window", {
      p_code_id: codeId,
      p_session_id: String(body.session_id ?? ""),
      p_opens_at: String(body.opens_at ?? ""),
      p_closes_at: String(body.closes_at ?? ""),
    });
    if (error) throw error;
    return Response.json({ window: data }, { status: 201 });
  } catch (error) { return routeError(error); }
}
