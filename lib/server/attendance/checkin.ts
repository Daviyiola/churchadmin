import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getBearerToken, createRequestSupabase } from "@/lib/server/reports/requestSupabase";
import { normalizeUsSmsPhone } from "@/lib/sms/phone";
import { nextOccurrences } from "@/lib/attendance/recurrence";

export const CHECKIN_COOKIE = "churchadmin_attendance_device";
export const ATTEMPT_COOKIE = "churchadmin_attendance_attempt";
export const CHECKIN_ROLES = ["owner", "admin", "finance", "member"] as const;
type PublicCheckinSession = { id: string; session_date: string; status: string; deleted_at: string | null; categories: { name: string } | { name: string }[] | null };

type SignedPayload = { c: string; v: number };

function secret() {
  const value = process.env.ATTENDANCE_CHECKIN_HMAC_SECRET?.trim();
  if (!value || value.length < 32) throw new Error("Attendance QR security is not configured.");
  return value;
}

function hmac(domain: string, value: string) {
  return crypto.createHmac("sha256", secret()).update(`${domain}\0${value}`).digest("base64url");
}

export function signCheckinCode(codeId: string, version: number) {
  const payload = Buffer.from(JSON.stringify({ c: codeId, v: version } satisfies SignedPayload)).toString("base64url");
  return `${payload}.${hmac("qr-code", payload)}`;
}

export function verifyCheckinCode(token: string): SignedPayload | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = hmac("qr-code", payload);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SignedPayload;
    return typeof parsed.c === "string" && Number.isInteger(parsed.v) ? parsed : null;
  } catch { return null; }
}

export function signConfirmation(checkinId: string, ttlSeconds = 600) {
  const payload = Buffer.from(JSON.stringify({ id: checkinId, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString("base64url");
  return `${payload}.${hmac("confirmation", payload)}`;
}

export function verifyConfirmation(token: string): string | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = hmac("confirmation", payload);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { id?: string; exp?: number };
    return parsed.id && Number(parsed.exp) >= Math.floor(Date.now() / 1000) ? parsed.id : null;
  } catch { return null; }
}

export function signAttempt(codeId: string, ttlSeconds = 900) {
  const payload = Buffer.from(JSON.stringify({ c: codeId, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString("base64url");
  return `${payload}.${hmac("attempt", payload)}`;
}

export function verifyAttempt(token: string | null, codeId: string) {
  if (!token) return false;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return false;
  const expected = hmac("attempt", payload);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { c?: string; exp?: number };
    return parsed.c === codeId && Number(parsed.exp) >= Math.floor(Date.now() / 1000);
  } catch { return false; }
}

export function newDeviceToken() { return crypto.randomBytes(32).toString("base64url"); }
export function deviceTokenHash(token: string) { return crypto.createHmac("sha256", secret()).update(`device\0${token}`).digest("hex"); }
export function nameHash(first: string, last: string) { return crypto.createHmac("sha256", secret()).update(`name\0${normalizeName(`${first} ${last}`)}`).digest("hex"); }
export function normalizeName(value: string) { return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US"); }

export function readCookie(req: Request, name: string) {
  const raw = req.headers.get("cookie") ?? "";
  for (const item of raw.split(";")) {
    const [key, ...parts] = item.trim().split("=");
    if (key === name) return decodeURIComponent(parts.join("="));
  }
  return null;
}

export const secureCookie = process.env.NODE_ENV === "production";

export async function requireAttendanceStaff(req: Request, organizationId: string) {
  const token = getBearerToken(req);
  if (!token) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  const supabase = createRequestSupabase(token);
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError && (userError.name === "AuthRetryableFetchError" || userError.status === 0 || (userError.status ?? 0) >= 500)) {
    throw Object.assign(new Error("Unable to reach the sign-in service. Please try again shortly."), { status: 503 });
  }
  if (userError || !userData.user) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  const { data, error } = await supabase.from("user_organizations").select("role").eq("organization_id", organizationId).eq("user_id", userData.user.id).maybeSingle<{ role: string }>();
  if (error) throw error;
  if (!data || !CHECKIN_ROLES.includes(data.role as (typeof CHECKIN_ROLES)[number])) throw Object.assign(new Error("Forbidden"), { status: 403 });
  return { token, supabase, userId: userData.user.id, role: data.role };
}

export async function publicCheckinContext(signedCode: string) {
  const signed = verifyCheckinCode(signedCode);
  if (!signed) throw Object.assign(new Error("This QR code is invalid."), { status: 404 });
  const { data: code, error } = await supabaseAdmin.from("attendance_checkin_codes")
    .select("id,org_id,name,token_version,expires_on,status")
    .eq("id", signed.c).maybeSingle();
  if (error || !code || code.status === "revoked" || code.token_version !== signed.v) throw Object.assign(new Error("This QR code is unavailable."), { status: 404 });
  const { data: window, error: windowError } = await supabaseAdmin.from("attendance_checkin_windows")
    .select("id,session_id,opens_at,closes_at,status")
    .eq("code_id", code.id).in("status", ["scheduled", "open"]).gt("closes_at", new Date().toISOString()).order("opens_at").limit(1).maybeSingle();
  if (windowError) throw new Error("Unable to check the attendance window. Please try again.");
  const [{ data: org }, { data: settings }] = await Promise.all([
    supabaseAdmin.from("organizations").select("name").eq("id", code.org_id).single(),
    supabaseAdmin.from("organization_settings").select("timezone_name,timezone_confirmed,logo_path,use_default_logo").eq("organization_id", code.org_id).maybeSingle(),
  ]);
  let session: PublicCheckinSession | null = null;
  if (window) {
    const result = await supabaseAdmin.from("attendance_sessions").select("id,session_date,status,deleted_at,categories(name)").eq("id", window.session_id).eq("org_id", code.org_id).maybeSingle();
    session = result.data as unknown as PublicCheckinSession | null;
  }
  const now = Date.now();
  const timezone = settings?.timezone_name || "UTC";
  const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const unexpired = !code.expires_on || code.expires_on >= localDate;
  const open = unexpired && !!window && session?.status === "draft" && !session.deleted_at && now >= Date.parse(window.opens_at) && now < Date.parse(window.closes_at);
  let upcoming: { date: string; opens_at: string; closes_at: string; service_name: string; preparing: boolean } | null = null;
  if (!window && unexpired) {
    const { data: schedule, error: scheduleError } = await supabaseAdmin.from("attendance_checkin_schedules").select("*").eq("code_id", code.id).eq("org_id", code.org_id).maybeSingle();
    if (scheduleError && !["PGRST205", "42P01"].includes(scheduleError.code)) throw new Error("Unable to check the attendance schedule. Please try again.");
    if (schedule && !schedule.paused && schedule.timezone_name === timezone && settings?.timezone_confirmed) {
      const [{ data: skips, error: skipError }, { data: used, error: usedError }, { data: service, error: serviceError }] = await Promise.all([
        supabaseAdmin.from("attendance_checkin_skips").select("occurrence_date").eq("code_id", code.id).gte("occurrence_date", new Date(now - 86400000).toISOString().slice(0, 10)),
        supabaseAdmin.from("attendance_checkin_windows").select("occurrence_date").eq("code_id", code.id).gte("occurrence_date", new Date(now - 86400000).toISOString().slice(0, 10)),
        supabaseAdmin.from("categories").select("name,status").eq("id", schedule.service_category_id).eq("org_id", code.org_id).maybeSingle(),
      ]);
      if (skipError || usedError || serviceError) throw new Error("Unable to check the attendance schedule. Please try again.");
      const excluded = [...(skips ?? []), ...(used ?? [])].map(row => row.occurrence_date);
      const next = nextOccurrences(schedule, timezone, new Date(now), excluded, code.expires_on, 20).find(item => !item.skipped);
      if (next && service?.status === "active") upcoming = { ...next, service_name: service.name, preparing: Date.parse(next.opens_at) <= now && !schedule.last_error };
    }
  }
  return { signed, code, window, session, org, settings, open, upcoming, expired: !unexpired };
}

export async function exactMemberMatches(orgId: string, first: string, last: string, phone?: string, email?: string) {
  const all: Array<{ id:string;first_name:string;last_name:string|null;email:string|null;phone:string|null;status:string;membership_stage:string }> = [];
  for (let from = 0; from < 5000; from += 1000) {
    const { data, error } = await supabaseAdmin.from("members")
      .select("id,first_name,last_name,email,phone,status,membership_stage")
      .eq("org_id", orgId).eq("status", "active").eq("membership_stage", "member").range(from, from + 999);
    if (error) throw error;
    all.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) break;
  }
  const wanted = normalizeName(`${first} ${last}`);
  let rows = all.filter((row) => normalizeName(`${row.first_name} ${row.last_name ?? ""}`) === wanted);
  const cleanEmail = email?.trim().toLowerCase();
  const cleanPhone = phone ? normalizeUsSmsPhone(phone) : null;
  if (rows.length > 1 && (cleanEmail || cleanPhone?.ok)) {
    rows = rows.filter((row) => {
      const rowPhone = normalizeUsSmsPhone(row.phone);
      return row.email?.trim().toLowerCase() === cleanEmail || (cleanPhone?.ok && rowPhone.ok && rowPhone.e164 === cleanPhone.e164);
    });
  }
  return rows;
}

export function routeError(error: unknown) {
  const status = Number((error as { status?: number })?.status) || 400;
  const raw = error instanceof Error ? error.message : "Unable to complete this request.";
  const message = raw.includes("CHECKIN_WINDOW_CLOSED") ? "Check-in is not open right now." : raw.includes("attendance_sessions_checkin_occurrence_key") ? "A draft is already assigned to this service time. Choose that draft." : raw.includes("duplicate key") ? "That name is already in use." : raw;
  return Response.json({ error: message }, { status });
}
