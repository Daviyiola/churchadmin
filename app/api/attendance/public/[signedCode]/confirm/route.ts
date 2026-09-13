import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { CHECKIN_COOKIE, deviceTokenHash, publicCheckinContext, readCookie, routeError, verifyConfirmation } from "@/lib/server/attendance/checkin";

export async function POST(req: Request, context: { params: Promise<{ signedCode: string }> }) {
  try {
    const { signedCode } = await context.params;
    const ctx = await publicCheckinContext(signedCode);
    if (!ctx.open) return Response.json({ error: "Check-in is not open right now." }, { status: 410 });
    const body = await req.json() as Record<string, unknown>;
    if (Object.keys(body).some((key) => !["confirmation_handle", "accepted"].includes(key))) return Response.json({ error: "Invalid confirmation." }, { status: 400 });
    const checkinId = verifyConfirmation(String(body.confirmation_handle ?? ""));
    if (!checkinId) return Response.json({ error: "That confirmation has expired. Please start again." }, { status: 400 });
    if (body.accepted === false) {
      const { data: pending } = await supabaseAdmin.from("attendance_public_checkins").select("id,code_id,state").eq("id", checkinId).maybeSingle();
      if (!pending || pending.code_id !== ctx.code.id || pending.state !== "awaiting_confirmation") return Response.json({ error: "That confirmation is no longer available." }, { status: 400 });
      await supabaseAdmin.from("attendance_public_checkins").update({ state: "unresolved", candidate_person_id: null }).eq("id", checkinId).eq("state", "awaiting_confirmation");
      return Response.json({ state: "unresolved", message: "Thanks. Church staff will review your check-in." });
    }
    const device = readCookie(req, CHECKIN_COOKIE);
    const { data, error } = await supabaseAdmin.rpc("confirm_public_attendance_checkin", { p_checkin_id:checkinId,p_device_token_hash:device ? deviceTokenHash(device) : null });
    if (error) throw error;
    return Response.json(data);
  } catch (error) { return routeError(error); }
}
