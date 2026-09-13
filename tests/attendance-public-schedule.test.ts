import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { database } from "./helpers/database";
const state = vi.hoisted(() => ({ db: null as ReturnType<typeof database> | null }));
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: { from: (table: string) => state.db!.from(table) } }));
import { publicCheckinContext, signCheckinCode } from "@/lib/server/attendance/checkin";
import { GET } from "@/app/api/attendance/public/[signedCode]/route";
const schedule = { code_id: "code", org_id: "org", service_category_id: "service", starts_on: "2030-01-01", ends_on: null, every_weeks: 1, weekdays: [0], service_time: "10:00:00", timezone_name: "UTC", opens_before_minutes: 30, closes_after_minutes: 90, paused: false, last_error: null };
const window = { id: "window", session_id: "session", opens_at: "2030-01-06T09:30:00Z", closes_at: "2030-01-06T11:30:00Z", status: "scheduled" };
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2030-01-06T09:00:00Z"));
  vi.stubEnv("ATTENDANCE_CHECKIN_HMAC_SECRET", "unit-test-attendance-secret-at-least-32-characters");
  state.db = database();
  state.db.queue("attendance_checkin_codes", { data: { id: "code", org_id: "org", token_version: 1, status: "active", expires_on: null } });
  state.db.queue("attendance_checkin_windows", {}, {});
  state.db.queue("organization_settings", { data: { timezone_name: "UTC", timezone_confirmed: true, use_default_logo: true } });
  state.db.queue("organizations", { data: { name: "Test Church" } });
  state.db.queue("attendance_checkin_schedules", { data: schedule });
  state.db.queue("categories", { data: { name: "Sunday service", status: "active" } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
const context = () => publicCheckinContext(signCheckinCode("code", 1));
it("shows the next opening before a draft exists without creating any data", async () => {
  const result = await context();
  expect(result.open).toBe(false); expect(result.upcoming).toMatchObject({ date: "2030-01-06", opens_at: "2030-01-06T09:30:00.000Z", preparing: false });
  expect(state.db!.calls.some(call => ["insert","update","upsert","delete"].includes(call.method))).toBe(false);
});
it("returns preparing when the window is due but has not been created yet", async () => {
  vi.setSystemTime(new Date("2030-01-06T09:45:00Z"));
  const token = signCheckinCode("code", 1);
  const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ signedCode: token }) });
  expect(await response.json()).toMatchObject({ status: "preparing", service_name: "Sunday service" });
});
it("allows a scheduled row to open at the exact opening time", async () => {
  vi.setSystemTime(new Date(window.opens_at)); state.db!.queue("attendance_checkin_windows", { data: window });
  state.db!.queue("attendance_sessions", { data: { id: "session", status: "draft", deleted_at: null } });
  expect((await context()).open).toBe(true);
});
it.each([{ status: "published", deleted_at: null }, { status: "draft", deleted_at: "2030-01-06T09:00Z" }])("does not open an unavailable draft %j", async session => {
  vi.setSystemTime(new Date("2030-01-06T09:45:00Z")); state.db!.queue("attendance_checkin_windows", { data: window });
  state.db!.queue("attendance_sessions", { data: session }); expect((await context()).open).toBe(false);
});
it("excludes skipped and already closed occurrences from the public next date", async () => {
  state.db!.queue("attendance_checkin_skips", { data: [{ occurrence_date: "2030-01-06" }] });
  state.db!.queue("attendance_checkin_windows", {}, { data: [{ occurrence_date: "2030-01-13" }] });
  expect((await context()).upcoming?.date).toBe("2030-01-20");
});
it("does not advertise a paused recurrence", async () => {
  state.db!.queue("attendance_checkin_schedules", { data: { ...schedule, paused: true } }); expect((await context()).upcoming).toBeNull();
});
it("does not advertise a future window on an expired code", async () => {
  state.db!.queue("attendance_checkin_codes", { data: { id: "code", org_id: "org", token_version: 1, status: "active", expires_on: "2030-01-05" } });
  state.db!.queue("attendance_checkin_windows", { data: window });
  const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ signedCode: signCheckinCode("code", 1) }) });
  expect(await response.json()).toMatchObject({ status: "closed", window: null });
});

it("keeps a manual QR code available before recurrence is deployed", async () => {
  state.db!.queue("attendance_checkin_schedules", { error: { code: "PGRST205", message: "Missing table" } });
  const result = await context(); expect(result.open).toBe(false); expect(result.upcoming).toBeNull();
});
it("does not hide an unrelated recurrence database failure", async () => {
  state.db!.queue("attendance_checkin_schedules", { error: { code: "42501", message: "Permission denied" } });
  await expect(context()).rejects.toThrow("Unable to check the attendance schedule");
});
