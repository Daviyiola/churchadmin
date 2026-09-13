import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAttendanceStaff, routeError } from "@/lib/server/attendance/checkin";

export async function POST(req: Request, context: { params: Promise<{ checkinId: string }> }) {
  try {
    const { checkinId } = await context.params;
    const { data: checkin } = await supabaseAdmin.from("attendance_public_checkins").select("org_id").eq("id", checkinId).maybeSingle();
    if (!checkin) return Response.json({ error: "Check-in not found." }, { status: 404 });
    const actor = await requireAttendanceStaff(req, checkin.org_id);
    const body = await req.json() as Record<string, unknown>;
    const allowed = new Set(["action", "person_id", "gender", "age_group", "reason"]);
    if (Object.keys(body).some((key) => !allowed.has(key))) return Response.json({ error: "Unsupported field." }, { status: 400 });
    const action = String(body.action ?? "");
    const createStage = action === "create_member" ? "member" : action === "create_first_timer" ? "visitor" : null;
    const call = createStage
      ? await actor.supabase.rpc("create_person_from_attendance_checkin", { p_checkin_id: checkinId, p_membership_stage: createStage, p_gender: String(body.gender ?? ""), p_age_group: String(body.age_group ?? "") })
      : await actor.supabase.rpc("resolve_attendance_public_checkin", { p_checkin_id: checkinId, p_action: action, p_person_id: body.person_id || null, p_gender: body.gender || null, p_age_group: body.age_group || null, p_reason: body.reason || null });
    if (call.error) throw call.error;
    return Response.json({ result: call.data });
  } catch (error) { return routeError(error); }
}
