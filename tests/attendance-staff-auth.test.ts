import { beforeEach, expect, it, vi } from "vitest";
import { database } from "./helpers/database";
const state = vi.hoisted(() => ({ user: vi.fn(), db: null as ReturnType<typeof database> | null }));
vi.mock("@/lib/server/reports/requestSupabase", async original => ({ ...await original<object>(), createRequestSupabase: () => ({ auth: { getUser: state.user }, from: (table: string) => state.db!.from(table) }) }));
import { requireAttendanceStaff, routeError } from "@/lib/server/attendance/checkin";
const req = new Request("http://localhost/api/attendance", { headers: { Authorization: "Bearer token" } });
beforeEach(() => { state.db = database(); state.user.mockReset(); });
it.each([{ name: "AuthRetryableFetchError", status: 0 }, { name: "AuthApiError", status: 503 }])("distinguishes a service outage from invalid credentials", async error => {
  state.user.mockResolvedValue({ data: { user: null }, error });
  try { await requireAttendanceStaff(req, "org"); throw new Error("Expected failure"); }
  catch (error) { const response = routeError(error); expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "Unable to reach the sign-in service. Please try again shortly." }); }
  expect(state.db!.from).not.toHaveBeenCalled();
});
it("still rejects an invalid token", async () => {
  state.user.mockResolvedValue({ data: { user: null }, error: { name: "AuthApiError", status: 401 } });
  await expect(requireAttendanceStaff(req, "org")).rejects.toMatchObject({ status: 401 });
});
it("still enforces organization membership after verifying the token", async () => {
  state.user.mockResolvedValue({ data: { user: { id: "user" } }, error: null });
  state.db!.queue("user_organizations", { data: null });
  await expect(requireAttendanceStaff(req, "org")).rejects.toMatchObject({ status: 403 });
});
