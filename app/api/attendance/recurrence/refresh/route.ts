import { requireAttendanceStaff, routeError } from "@/lib/server/attendance/checkin";
export async function POST(req: Request) {
  try {
    const orgId = req.headers.get("x-organization-id") ?? "";
    if (!orgId) return Response.json({ error: "Select an organization." }, { status: 400 });
    const actor = await requireAttendanceStaff(req, orgId);
    const { error } = await actor.supabase.rpc("refresh_attendance_checkin_schedules", { p_org_id: orgId });
    if (error) throw new Error(error.message);
    return Response.json({ ok: true });
  } catch (error) { return routeError(error); }
}
