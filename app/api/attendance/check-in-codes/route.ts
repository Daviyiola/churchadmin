import { signCheckinCode, requireAttendanceStaff, routeError } from "@/lib/server/attendance/checkin";
import { nextOccurrences } from "@/lib/attendance/recurrence";

export const dynamic = "force-dynamic";

function organizationId(req: Request) { return req.headers.get("x-organization-id")?.trim() ?? ""; }

export async function GET(req: Request) {
  try {
    const orgId = organizationId(req);
    if (!orgId) return Response.json({ error: "Select an organization." }, { status: 400 });
    const actor = await requireAttendanceStaff(req, orgId);
    const [{ data: codes, error }, { data: settings }, { data: windows, error: windowError }, { data: schedules, error: scheduleError }, { data: skips, error: skipError }, { data: finished, error: finishedError }] = await Promise.all([
      actor.supabase.from("attendance_checkin_codes")
        .select("id,name,default_service_category_id,token_version,expires_on,status,created_at,updated_at")
        .eq("org_id", orgId).order("updated_at", { ascending: false }),
      actor.supabase.from("organization_settings").select("timezone_name,timezone_confirmed").eq("organization_id", orgId).maybeSingle(),
      actor.supabase.from("attendance_checkin_windows")
        .select("id,code_id,session_id,opens_at,closes_at,status,attendance_sessions(session_date,service_category_id,categories(name))")
        .eq("org_id", orgId).in("status", ["scheduled", "open"]).gt("closes_at", new Date().toISOString()).order("opens_at").limit(5),
      actor.supabase.from("attendance_checkin_schedules").select("*").eq("org_id", orgId),
      actor.supabase.from("attendance_checkin_skips").select("code_id,occurrence_date").gte("occurrence_date", new Date(Date.now() - 86400000).toISOString().slice(0, 10)),
      actor.supabase.from("attendance_checkin_windows").select("code_id,occurrence_date").eq("org_id", orgId).in("status", ["closed", "cancelled"]).not("occurrence_date", "is", null).gte("occurrence_date", new Date(Date.now() - 86400000).toISOString().slice(0, 10)),
    ]);
    if (error) throw error;
    if (windowError) throw windowError;
    const recurrenceErrors = [scheduleError, skipError, finishedError].filter(Boolean);
    const missingSchema = (code?: string) => ["PGRST205", "PGRST204", "42P01", "42703"].includes(code ?? "");
    const recurrenceAvailable = recurrenceErrors.length === 0;
    for (const failure of recurrenceErrors) {
      if (!missingSchema(failure?.code)) throw new Error(failure?.message);
    }
    const base = (process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin).replace(/\/$/, "");
    return Response.json({
      codes: (codes ?? []).map((code) => {
        const schedule = recurrenceAvailable ? schedules?.find(row => row.code_id === code.id) : null;
        const closedDates = new Set((finished ?? []).filter(row => row.code_id === code.id).map(row => row.occurrence_date));
        return { ...code, schedule: schedule ? { ...schedule, upcoming: nextOccurrences(schedule, schedule.timezone_name, new Date(), (skips ?? []).filter(row => row.code_id === code.id).map(row => row.occurrence_date), code.expires_on, 10).filter(item => item.skipped || !closedDates.has(item.date)).slice(0, 5) } : null,
          attendance_checkin_windows: (windows ?? []).filter(window => window.code_id === code.id), public_url: `${base}/check-in/${signCheckinCode(code.id, code.token_version)}` };
      }),
      timezone: settings ?? null,
      recurrence_available: recurrenceAvailable,
    });
  } catch (error) { return routeError(error); }
}

export async function POST(req: Request) {
  try {
    const orgId = organizationId(req);
    if (!orgId) return Response.json({ error: "Select an organization." }, { status: 400 });
    const actor = await requireAttendanceStaff(req, orgId);
    const body = await req.json() as Record<string, unknown>;
    const allowed = new Set(["name", "default_service_category_id", "expires_on"]);
    if (Object.keys(body).some((key) => !allowed.has(key))) return Response.json({ error: "Unsupported field." }, { status: 400 });
    const { data, error } = await actor.supabase.rpc("create_attendance_checkin_code", {
      p_org_id: orgId,
      p_name: String(body.name ?? ""),
      p_default_service_category_id: body.default_service_category_id || null,
      p_expires_on: body.expires_on || null,
    });
    if (error) throw error;
    return Response.json({ code: data }, { status: 201 });
  } catch (error) { return routeError(error); }
}
