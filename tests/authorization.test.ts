import { beforeEach, describe, expect, it, vi } from "vitest";
import { database } from "./helpers/database";
const state = vi.hoisted(() => ({ getUser: vi.fn(), actor: vi.fn(), db: null as any }));
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: { from: (...args: any[]) => state.db.from(...args), auth: { getUser: state.getUser } } }));
vi.mock("@/lib/server/authUser", () => ({ requireActorId: state.actor }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ from: (...args: any[]) => state.db.from(...args), auth: { getUser: state.getUser } }) }));
import { getBearerToken, requireUser, requireOrgOwnerOrAdmin, requireOrgFinanceOrAbove } from "@/lib/serverAuthz";
import { requireBillingActor } from "@/lib/server/billing/auth";
import { requireManagedFormContext, managedFormErrorStatus } from "@/lib/server/forms/access";
import { getReportRequestContext, requireReportRoles, requireFinanceDateWindow, requireValidReportDateRange, ReportAccessError, reportErrorStatus } from "@/lib/server/reports/requestSupabase";
import { requireSmsOperator, smsRouteError } from "@/lib/server/sms/auth";
const req = new Request("http://localhost", { headers: { Authorization: "Bearer good-token" } });
beforeEach(() => { state.db = database(); state.actor.mockResolvedValue("user-1"); state.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }); });
describe("authentication boundaries", () => {
  it.each(["", "Basic abc", "Bearer   "])("rejects missing bearer token %s", value => expect(getBearerToken(new Request("http://localhost", { headers: { authorization: value } }))).toBeNull());
  it("trims a valid token", () => expect(getBearerToken(new Request("http://localhost", { headers: { authorization: "Bearer abc " } }))).toBe("abc"));
  it("authenticates a verified provider user", async () => expect(await requireUser(req)).toEqual({ ok: true, userId: "user-1" }));
  it("rejects revoked sessions", async () => { state.getUser.mockResolvedValue({ data: { user: null }, error: { message: "expired" } }); expect(await requireUser(req)).toMatchObject({ ok: false, status: 401 }); });
});
describe.each(["owner", "admin", "finance", "member", "viewer", "unknown"])("role %s", role => {
  const membership = () => state.db.queue("user_organizations", { data: { role } });
  it("checks organization administration", async () => { membership(); const result = await requireOrgOwnerOrAdmin("org-1", "user-1"); expect(result.ok).toBe(["owner", "admin"].includes(role)); expect(state.db.calls).toContainEqual({ table: "user_organizations", method: "eq", args: ["organization_id", "org-1"] }); expect(state.db.calls).toContainEqual({ table: "user_organizations", method: "eq", args: ["user_id", "user-1"] }); });
  it("checks finance-capable access", async () => { membership(); expect((await requireOrgFinanceOrAbove("org-1", "user-1")).ok).toBe(["owner", "admin", "finance"].includes(role)); });
  it("restricts billing mutations to the owner", async () => { membership(); const action = requireBillingActor(req, "org-1", true); if (role === "owner") expect(await action).toMatchObject({ role }); else await expect(action).rejects.toThrow("FORBIDDEN"); });
  it("checks billing read access", async () => { membership(); const action = requireBillingActor(req, "org-1"); if (["owner", "admin", "finance"].includes(role)) expect(await action).toMatchObject({ role }); else await expect(action).rejects.toThrow("FORBIDDEN"); });
  it("checks managed-form access using the form's tenant", async () => { state.db.queue("forms", { data: { id: "form-1", org_id: "org-1" } }); membership(); const action = requireManagedFormContext(req, "form-1"); if (["owner", "admin", "finance"].includes(role)) expect(await action).toMatchObject({ role, form: { org_id: "org-1" } }); else await expect(action).rejects.toThrow("Forbidden"); });
  it("checks SMS operator access", async () => { membership(); const action = requireSmsOperator(req, "org-1"); if (["owner", "admin", "finance"].includes(role)) expect(await action).toMatchObject({ role }); else await expect(action).rejects.toThrow("Forbidden"); });
});
describe("report and error access policy", () => {
  it("rejects a valid user without tenant membership", async () => { await expect(getReportRequestContext("token", "org-2")).rejects.toThrow("Forbidden"); });
  it("does not turn database errors into authorized access", async () => { state.db.queue("user_organizations", { error: { message: "database unavailable" } }); expect(await requireOrgOwnerOrAdmin("org-1", "user-1")).toMatchObject({ ok: false, status: 400 }); });
  it("rejects a nonexistent managed form", async () => { await expect(requireManagedFormContext(req, "missing")).rejects.toThrow("Form not found"); });
  it.each([["2026-02-29", "2026-03-01"], ["2026-12-02", "2026-12-01"], ["2026-13-01", "2026-13-02"]])("rejects invalid report range %s %s", (start, end) => expect(() => requireValidReportDateRange(start, end)).toThrow());
  it("accepts a single day and leap date", () => expect(() => requireValidReportDateRange("2024-02-29", "2024-02-29")).not.toThrow());
  it("limits finance history but permits owner history", () => { expect(() => requireFinanceDateWindow("finance", "2000-01-01")).toThrow(ReportAccessError); expect(() => requireFinanceDateWindow("owner", "2000-01-01")).not.toThrow(); });
  it("maps typed access errors", () => { expect(reportErrorStatus(new ReportAccessError("Forbidden", 403))).toBe(403); expect(reportErrorStatus(new Error())).toBe(400); expect(() => requireReportRoles("member", ["owner", "admin"])).toThrow("Forbidden"); });
  it.each([["UNAUTHORIZED",401],["Forbidden",403],["Form not found",404],["Other",400]])("maps form error %s", (message,status) => expect(managedFormErrorStatus(String(message))).toBe(status));
  it("sanitizes arbitrary SMS error status", () => { expect(smsRouteError({ status: 999 }).status).toBe(400); expect(smsRouteError(Object.assign(new Error("Forbidden"), { status: 403 }))).toEqual({ status: 403, message: "Forbidden" }); });
});
