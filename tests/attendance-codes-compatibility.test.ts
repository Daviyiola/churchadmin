import { beforeEach, expect, it, vi } from "vitest";
import { database } from "./helpers/database";
const state = vi.hoisted(() => ({ db: null as ReturnType<typeof database> | null, staff: vi.fn() }));
vi.mock("@/lib/server/attendance/checkin", async original => ({ ...await original<object>(), requireAttendanceStaff: state.staff }));
import { GET } from "@/app/api/attendance/check-in-codes/route";
beforeEach(() => {
  state.db = database(); state.staff.mockResolvedValue({ supabase: state.db });
  process.env.ATTENDANCE_CHECKIN_HMAC_SECRET = "unit-test-attendance-secret-at-least-32-characters";
  state.db.queue("attendance_checkin_codes", { data: [{ id: "code", name: "Lobby", token_version: 1 }] });
});
const request = () => GET(new Request("http://localhost/api/attendance/check-in-codes", { headers: { "x-organization-id": "org" } }));
it("returns existing QR codes when the recurrence schema is not deployed", async () => {
  state.db!.queue("attendance_checkin_schedules", { error: { code: "PGRST205", message: "Missing table" } });
  state.db!.queue("attendance_checkin_skips", { error: { code: "42P01", message: "Missing table" } });
  state.db!.queue("attendance_checkin_windows", { data: [] }, { error: { code: "42703", message: "Missing column" } });
  const response = await request(); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ recurrence_available: false, codes: [{ id: "code", schedule: null }] });
});
it("does not hide permission errors as a missing migration", async () => {
  state.db!.queue("attendance_checkin_schedules", { error: { code: "42501", message: "Permission denied" } });
  expect((await request()).status).toBe(400);
});
