import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/client/scheduleApi";
beforeEach(() => { vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })))); });
describe("schedule API client", () => {
  it.each([
    ["metadata", () => api.getPublicMeta("a&b"), "/api/schedule/public/meta?token=a%26b"],
    ["categories", () => api.getPublicCategories("a&b"), "/api/schedule/public/categories?token=a%26b"],
    ["month", () => api.getPublicMonth("token", "2026-09"), "/api/schedule/public/month?token=token&month=2026-09"],
    ["default month", () => api.getPublicMonth("token"), "/api/schedule/public/month?token=token"],
    ["day", () => api.getPublicDay("token", "2026-09", "2026-09-06"), "/api/schedule/public/day?token=token&month=2026-09&date=2026-09-06"],
  ] as const)("encodes public %s requests", async (_name, call, url) => { expect(await call()).toEqual({ ok: true }); expect(fetch).toHaveBeenCalledWith(url, expect.objectContaining({ method: "GET", cache: "no-store", headers: undefined })); });
  it("includes authorization for administrative reads", async () => { await api.getAdminMonth("org", "2026-09", "jwt"); expect(fetch).toHaveBeenCalledWith(expect.stringContaining("org_id=org"), expect.objectContaining({ headers: { Authorization: "Bearer jwt" } })); });
  it.each([
    ["month settings", () => api.patchAdminMonthSettings({ org_id: "org", month: "2026-09" } as any, "jwt"), "PATCH"],
    ["schedule settings", () => api.patchScheduleSettings({ org_id: "org", show_birthdays: false }, "jwt"), "PATCH"],
    ["entry patch", () => api.patchAdminEntry({ org_id: "org", entry_id: "entry" } as any, "jwt"), "PATCH"],
    ["entry creation", () => api.createAdminEntry({ org_id: "org", month: "2026-09", date: "2026-09-06", name: "A", role: "lead", notes: null, service_category_id: null, department_category_id: null }, "jwt"), "POST"],
  ] as const)("serializes authorized %s", async (_name, call, method) => { await call(); const init = vi.mocked(fetch).mock.calls[0][1]!; expect(init.method).toBe(method); expect(init.headers).toMatchObject({ Authorization: "Bearer jwt", "Content-Type": "application/json" }); expect(JSON.parse(String(init.body)).org_id).toBe("org"); });
  it("sends public verification codes without bearer auth", async () => { await api.verifyPublicMonthCode("token", "2026-09", "1234"); expect(fetch).toHaveBeenCalledWith("/api/schedule/public/verify-code", expect.objectContaining({ body: JSON.stringify({ token: "token", month: "2026-09", code: "1234" }) })); });
  it("sends public entry and submission payloads", async () => { await api.patchPublicEntry({ token: "t", month: "2026-09", month_code: "c", entry_id: "e", status: "approved" }); expect(fetch).toHaveBeenCalledWith("/api/schedule/public/entry", expect.objectContaining({ method: "PATCH" })); vi.mocked(fetch).mockResolvedValue(new Response('{"ok":true}')); await api.submitPublic({ token: "t" } as any); expect(fetch).toHaveBeenLastCalledWith("/api/schedule/public/submit", expect.objectContaining({ method: "POST" })); });
  it.each([["", 502, "HTTP 502"], ["<html>down</html>", 502, "Invalid JSON"], ['{"error":"Forbidden"}', 403, "Forbidden"], ['{}', 429, "HTTP 429"]] as const)("reports malformed/error response %s", async (body,status,message) => { vi.mocked(fetch).mockResolvedValue(new Response(body, { status })); await expect(api.getPublicMeta("t")).rejects.toThrow(message); });
  it("propagates network errors", async () => { vi.mocked(fetch).mockRejectedValue(new Error("offline")); await expect(api.getPublicMeta("t")).rejects.toThrow("offline"); });
});
