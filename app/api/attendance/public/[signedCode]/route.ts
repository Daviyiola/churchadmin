import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { CHECKIN_COOKIE, deviceTokenHash, publicCheckinContext, readCookie, routeError } from "@/lib/server/attendance/checkin";

export const dynamic = "force-dynamic";

export async function GET(req: Request, context: { params: Promise<{ signedCode: string }> }) {
  try {
    const { signedCode } = await context.params;
    const ctx = await publicCheckinContext(signedCode);
    let profiles: Array<{ id: string; label: string }> = [];
    const deviceToken = readCookie(req, CHECKIN_COOKIE);
    if (deviceToken) {
      const { data: device } = await supabaseAdmin.from("attendance_remembered_devices").select("id").eq("token_hash", deviceTokenHash(deviceToken)).is("revoked_at", null).maybeSingle();
      if (device) {
        const { data } = await supabaseAdmin.from("attendance_remembered_profiles").select("id,label,person_id,members!attendance_remembered_profiles_person_org_fk(status,membership_stage,merged_into_member_id)").eq("device_id", device.id).eq("org_id", ctx.code.org_id).is("revoked_at", null).order("last_used_at", { ascending: false });
        profiles = (data ?? []).filter((row) => {
          const member = Array.isArray(row.members) ? row.members[0] : row.members;
          return member?.status === "active" && member?.membership_stage === "member";
        }).map((row) => ({ id: row.id, label: row.label }));
      }
    }
    let logoUrl: string | null = null;
    if (ctx.settings?.logo_path && !ctx.settings.use_default_logo) {
      const { data } = await supabaseAdmin.storage.from("org-logos").createSignedUrl(ctx.settings.logo_path, 3600);
      logoUrl = data?.signedUrl ?? null;
    }
    const category = ctx.session?.categories;
    return Response.json({
      organization: { name: ctx.org?.name ?? "Church", logo_url: logoUrl },
      qr_name: ctx.code.name,
      service_name: Array.isArray(category) ? category[0]?.name ?? "Service" : category?.name ?? ctx.upcoming?.service_name ?? "Service",
      session_date: ctx.session?.session_date ?? ctx.upcoming?.date ?? null,
      timezone: ctx.settings?.timezone_name ?? "UTC",
      window: ctx.expired ? null : ctx.window ? { opens_at: ctx.window.opens_at, closes_at: ctx.window.closes_at } : ctx.upcoming ? { opens_at: ctx.upcoming.opens_at, closes_at: ctx.upcoming.closes_at } : null,
      status: ctx.expired ? "closed" : ctx.open ? "open" : ctx.upcoming?.preparing ? "preparing" : (ctx.window && Date.now() < Date.parse(ctx.window.opens_at)) || (ctx.upcoming && Date.now() < Date.parse(ctx.upcoming.opens_at)) ? "scheduled" : "closed",
      remembered_profiles: profiles,
    });
  } catch (error) { return routeError(error); }
}
