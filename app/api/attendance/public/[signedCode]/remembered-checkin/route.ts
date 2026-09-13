import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { CHECKIN_COOKIE, deviceTokenHash, publicCheckinContext, readCookie, routeError } from "@/lib/server/attendance/checkin";

export async function POST(req: Request, context: { params: Promise<{ signedCode: string }> }) {
  try {
    const { signedCode } = await context.params;
    const ctx = await publicCheckinContext(signedCode);
    if (!ctx.open || !ctx.window) return Response.json({ error: "Check-in is not open right now." }, { status: 410 });
    const device = readCookie(req, CHECKIN_COOKIE);
    if (!device) return Response.json({ error: "This device has no remembered profiles." }, { status: 400 });
    const body = await req.json() as Record<string, unknown>;
    if (Object.keys(body).some((key) => !["profile_id","request_id"].includes(key))) return Response.json({ error: "Invalid request." }, { status: 400 });
    const { data, error } = await supabaseAdmin.rpc("record_remembered_attendance_checkin", { p_code_id:ctx.code.id,p_window_id:ctx.window.id,p_request_id:String(body.request_id ?? ""),p_profile_id:String(body.profile_id ?? ""),p_device_token_hash:deviceTokenHash(device) });
    if (error) throw error;
    return Response.json(data);
  } catch (error) { return routeError(error); }
}
