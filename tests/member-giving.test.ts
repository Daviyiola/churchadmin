import { beforeEach, expect, it, vi } from "vitest";
import { database } from "./helpers/database";
import type { RunMemberGivingBody } from "@/lib/reports/members/types";
const state = vi.hoisted(() => ({ db: null as ReturnType<typeof database> | null, role: "owner" }));
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: { from: (table: string) => state.db!.from(table) } }));
vi.mock("@/lib/server/reports/requestSupabase", async importOriginal => ({
  ...await importOriginal<object>(),
  getReportRequestContext: async () => ({ supabase: state.db, role: state.role }),
}));
import { runMemberGivingReportFromToken } from "@/lib/server/reports/memberGiving";
import { runMemberGivingReportAsAdmin } from "@/lib/server/reports/memberGivingAdmin";
import { renderMemberGivingHtml } from "@/lib/server/reports/memberGivingHtml";
const body: RunMemberGivingBody = { organization_id: "org", member_id: "m", mode: "summary", start_date: "2026-01-15", end_date: "2026-03-10" };
const member = { id: "m", first_name: "Ann", last_name: "<script>" };
function seed(admin = false) {
  state.db!.queue("members", { data: admin ? member : [member] });
  state.db!.queue("organizations", { data: { name: "Church & Friends" } });
  state.db!.queue("organization_settings", { data: { use_default_logo: true } });
  state.db!.queue("categories", { data: [{ id: "c", name: "Giving" }] });
  state.db!.queue("income_entries", { data: [
    { session_date: "2026-01-20", member_id: "m", income_category_id: "c", payment_method: "cash", amount_cents: 12500, entry_type: "normal" },
    { session_date: "2026-03-01", member_id: "m", income_category_id: "c", payment_method: "cash", amount_cents: -2500, entry_type: "adjustment" },
  ] });
}
beforeEach(() => { state.db = database(); state.role = "owner"; });
it.each([false, true])("sums normal gifts and adjustments in the %s admin path", async admin => {
  seed(admin);
  const report = admin ? await runMemberGivingReportAsAdmin(body) : await runMemberGivingReportFromToken(body, "token");
  expect(report).toMatchObject({ summary: { grand_total: 100, rows: [{ amount: 100, category_name: "Giving" }] } });
  expect(renderMemberGivingHtml(report)).toContain("&lt;script&gt;");
  expect(renderMemberGivingHtml(report)).not.toContain("<script>");
});
it.each([false, true])("groups detailed entries by month in the %s admin path", async admin => {
  seed(admin);
  const input = { ...body, mode: "detailed" as const };
  const report = admin ? await runMemberGivingReportAsAdmin(input) : await runMemberGivingReportFromToken(input, "token");
  expect(report).toMatchObject({ detailed: { grand_total: 100, months: [{ subtotal: 125 }, { subtotal: -25 }] } });
  expect(renderMemberGivingHtml(report, "Cash only")).toContain("Cash only");
});
it("fills empty months and clips partial month boundaries", async () => {
  seed();
  const report = await runMemberGivingReportFromToken({ ...body, mode: "monthly" }, "token");
  expect(report).toMatchObject({ monthly: { grand_total: 100, months: [
    { covered_start: "2026-01-15", covered_end: "2026-01-31", subtotal: 125 },
    { covered_start: "2026-02-01", covered_end: "2026-02-28", subtotal: 0 },
    { covered_start: "2026-03-01", covered_end: "2026-03-10", subtotal: -25 },
  ] } });
  expect(renderMemberGivingHtml(report)).toContain("Giving");
});
it.each(["staff", "viewer", "finance"])("rejects %s before querying donor records", async role => {
  state.role = role;
  await expect(runMemberGivingReportFromToken(body, "token")).rejects.toThrow();
  expect(state.db!.from).not.toHaveBeenCalled();
});
it("rejects members outside the organization", async () => {
  await expect(runMemberGivingReportFromToken(body, "token")).rejects.toThrow("outside this organization");
});
it("rejects unavailable monthly categories", async () => {
  seed();
  await expect(runMemberGivingReportFromToken({ ...body, mode: "monthly", category_ids: ["private"] }, "token")).rejects.toThrow("categories are unavailable");
});
it.each([
  { member_id: "", member_ids: [] },
  { member_ids: ["a", "b"] },
  { mode: "monthly" as const, member_ids: Array.from({ length: 501 }, (_, i) => String(i)) },
  { start_date: "2026-04-01" },
])("rejects invalid report selection %j", async overrides => {
  await expect(runMemberGivingReportFromToken({ ...body, ...overrides }, "token")).rejects.toThrow();
  expect(state.db!.from).not.toHaveBeenCalled();
});
it("propagates database failures", async () => {
  state.db!.queue("members", { error: { message: "Database unavailable" } });
  await expect(runMemberGivingReportFromToken(body, "token")).rejects.toThrow("Database unavailable");
});
