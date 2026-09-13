import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAttendanceStaff, routeError } from "@/lib/server/attendance/checkin";

export async function POST(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;
    if (Object.keys(body).some((key) => key !== "checkin_id")) return Response.json({ error:"Invalid request." }, { status:400 });
    const { data: checkin } = await supabaseAdmin.from("attendance_public_checkins").select("org_id,remembered_device_id").eq("id",String(body.checkin_id??"")).maybeSingle();
    if (!checkin) return Response.json({ error:"Check-in not found." }, { status:404 });
    const actor = await requireAttendanceStaff(req,checkin.org_id);
    if (!checkin.remembered_device_id) return Response.json({ ok:true });
    const now=new Date().toISOString();
    await supabaseAdmin.from("attendance_remembered_devices").update({revoked_at:now,revoked_reason:`staff:${actor.userId}`}).eq("id",checkin.remembered_device_id);
    await supabaseAdmin.from("attendance_remembered_profiles").update({revoked_at:now}).eq("device_id",checkin.remembered_device_id).is("revoked_at",null);
    return Response.json({ok:true});
  } catch(error){return routeError(error);}
}
