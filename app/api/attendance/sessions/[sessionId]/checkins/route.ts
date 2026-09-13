import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAttendanceStaff, routeError, normalizeName } from "@/lib/server/attendance/checkin";

export const dynamic = "force-dynamic";

export async function GET(req: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await context.params;
    const { data: session } = await supabaseAdmin.from("attendance_sessions").select("org_id,status,unresolved_checkins_at_publish,attendance_completeness").eq("id", sessionId).maybeSingle();
    if (!session) return Response.json({ error: "Attendance session not found." }, { status: 404 });
    await requireAttendanceStaff(req, session.org_id);
    const { data, error } = await supabaseAdmin.from("attendance_public_checkins")
      .select("id,state,submitted_first_name,submitted_last_name,submitted_phone,submitted_email,remember_requested,created_at,resolution_reason,resolved_at,attendance_checkin_codes(name)")
      .eq("session_id", sessionId).order("created_at", { ascending: true }).range(0, 499);
    if (error) throw error;
    const unresolved = (data ?? []).filter((item) => ["unresolved", "awaiting_confirmation"].includes(item.state));
    const warnings = new Map<string, Array<{ id: string; name: string; kind: string }>>();
    if (unresolved.length) {
      const { data: visitors } = await supabaseAdmin.from("members").select("id,first_name,last_name,membership_stage").eq("org_id", session.org_id).eq("status", "active").eq("membership_stage", "visitor").range(0, 9999);
      for (const item of unresolved) {
        const wanted = normalizeName(`${item.submitted_first_name ?? ""} ${item.submitted_last_name ?? ""}`);
        warnings.set(item.id, (visitors ?? []).filter((person) => normalizeName(`${person.first_name} ${person.last_name ?? ""}`) === wanted).map((person) => ({ id: person.id, name: `${person.first_name} ${person.last_name ?? ""}`.trim(), kind: "first-timer" })));
      }
    }
    return Response.json({
      checkins: (data ?? []).map((item) => ({ ...item, person_warnings: warnings.get(item.id) ?? [] })),
      session,
    });
  } catch (error) { return routeError(error); }
}
