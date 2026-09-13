import { beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ getSession: vi.fn(), refreshSession: vi.fn() }));
vi.mock("@/lib/supabaseClient", () => ({ supabase: { auth } }));
import { attendanceStaffApi } from "@/lib/attendance/staffApi";
const json = (status: number, body = {}) => new Response(JSON.stringify(body), { status });
beforeEach(() => {
  vi.clearAllMocks(); auth.getSession.mockResolvedValue({ data: { session: { access_token: "old" } } });
  auth.refreshSession.mockResolvedValue({ data: { session: { access_token: "new" } } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { ok: true })));
});
it("refreshes a rejected token once and preserves the request body and organization", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(json(401));
  expect(await attendanceStaffApi("/api/attendance/test", { method: "POST", body: "{}", headers: { "x-organization-id": "org" } })).toEqual({ ok: true });
  expect(fetch).toHaveBeenLastCalledWith("/api/attendance/test", expect.objectContaining({ body: "{}", headers: { Authorization: "Bearer new", "x-organization-id": "org" } }));
  expect(auth.refreshSession).toHaveBeenCalledTimes(1);
});
it.each([403, 503])("does not refresh or replay a non-auth failure (%s)", async status => {
  vi.mocked(fetch).mockResolvedValue(json(status, { error: "Service unavailable" }));
  await expect(attendanceStaffApi("/api/attendance/test")).rejects.toThrow("Service unavailable");
  expect(auth.refreshSession).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledTimes(1);
});
it("stops after a second unauthorized response", async () => {
  vi.mocked(fetch).mockImplementation(async () => json(401));
  await expect(attendanceStaffApi("/api/attendance/test")).rejects.toThrow("Sign in again");
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("does not send an empty bearer token", async () => {
  auth.getSession.mockResolvedValue({ data: { session: null } });
  await expect(attendanceStaffApi("/api/attendance/test")).rejects.toThrow("Sign in again");
  expect(fetch).not.toHaveBeenCalled();
});
