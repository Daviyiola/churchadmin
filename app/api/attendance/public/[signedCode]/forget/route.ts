import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { CHECKIN_COOKIE, deviceTokenHash, publicCheckinContext, readCookie, routeError } from "@/lib/server/attendance/checkin";

export async function POST(req: Request, context: { params: Promise<{ signedCode: string }> }) {
  try {
    const { signedCode } = await context.params;
    const ctx = await publicCheckinContext(signedCode);
    const token = readCookie(req, CHECKIN_COOKIE);
    if (!token) return Response.json({ ok:true });
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (Object.keys(body).some((key) => key !== "profile_id")) return Response.json({ error:"Invalid request." }, { status:400 });
    const profileId = body.profile_id ? String(body.profile_id) : null;
    const { error } = await supabaseAdmin.rpc("forget_attendance_profile", { p_device_token_hash:deviceTokenHash(token),p_profile_id:profileId,p_org_id:ctx.code.org_id });
    if (error) throw error;
    const response = NextResponse.json({ ok:true });
    if (!profileId) response.cookies.set(CHECKIN_COOKIE,"",{ path:"/",maxAge:0 });
    return response;
  } catch (error) { return routeError(error); }
}
