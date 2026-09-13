import { beforeEach, expect, it, vi } from "vitest";
import { database } from "./helpers/database";
const state = vi.hoisted(() => ({ db: null as ReturnType<typeof database> | null, staff: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: { from: (table: string) => state.db!.from(table) } }));
vi.mock("@/lib/server/attendance/checkin", async original => ({ ...await original<object>(), requireAttendanceStaff: state.staff }));
import { PUT, PATCH } from "@/app/api/attendance/check-in-codes/[codeId]/schedule/route";
import { POST as refresh } from "@/app/api/attendance/recurrence/refresh/route";
const context = { params: Promise.resolve({ codeId: "code" }) };
const rule = { service_category_id: "33333333-3333-4333-8333-333333333333", starts_on: "2030-01-01", weekdays: [0], every_weeks: 1, service_time: "10:00", opens_before_minutes: 30, closes_after_minutes: 90 };
const request = (body: unknown) => new Request("http://localhost/api/attendance", { method: "POST", headers: { "x-organization-id": "org" }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); state.db = database(); state.db.queue("attendance_checkin_codes", { data: { org_id: "org" } });
  state.staff.mockResolvedValue({ supabase: { rpc: state.rpc } }); state.rpc.mockResolvedValue({ error: null });
});
it("saves a validated rule through the authenticated database operation", async () => {
  const req = request(rule); expect((await PUT(req, context)).status).toBe(200);
  expect(state.staff).toHaveBeenCalledWith(req, "org");
  expect(state.rpc).toHaveBeenCalledWith("save_attendance_checkin_schedule", { p_code_id: "code", p_settings: { ...rule, ends_on: null } });
});
it.each([401,403])("does not save for a rejected actor (%s)", async status => {
  state.staff.mockRejectedValue(Object.assign(new Error("Forbidden"), { status }));
  expect((await PUT(request(rule), context)).status).toBe(status); expect(state.rpc).not.toHaveBeenCalled();
});
it("rejects caller-supplied tenant and timezone overrides", async () => {
  expect((await PUT(request({ ...rule, org_id: "other", timezone_name: "UTC" }), context)).status).toBe(400);
  expect(state.rpc).not.toHaveBeenCalled();
});
it.each(["pause","resume","skip"])("executes the %s action for the authorized code", async action => {
  expect((await PATCH(request({ action, date: action === "skip" ? "2030-01-06" : null }), context)).status).toBe(200);
  expect(state.rpc).toHaveBeenCalledWith("act_attendance_checkin_schedule", { p_code_id: "code", p_action: action, p_date: action === "skip" ? "2030-01-06" : null });
});
it("returns a useful error when a live window blocks schedule editing", async () => {
  state.rpc.mockResolvedValue({ error: { message: "Close the current window before changing the schedule." } });
  const response = await PUT(request(rule), context); expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Close the current window before changing the schedule." });
});
it("refreshes only the authenticated organization", async () => {
  const req = request({}); expect((await refresh(req)).status).toBe(200);
  expect(state.staff).toHaveBeenCalledWith(req, "org"); expect(state.rpc).toHaveBeenCalledWith("refresh_attendance_checkin_schedules", { p_org_id: "org" });
});
it("rejects a missing tenant without calling the worker", async () => {
  expect((await refresh(new Request("http://localhost", { method: "POST" }))).status).toBe(400);
  expect(state.rpc).not.toHaveBeenCalled();
});
