import { beforeEach, describe, expect, it, vi } from "vitest";
import { database } from "./helpers/database";
const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: { from: (...args: any[]) => state.db.from(...args) } }));
import { parseSubmissionFilters, fetchFilteredSubmissions, fetchCurrentFormFields } from "@/lib/server/forms/submissionData";
import { localDateStartIso, nextLocalDate, formatOrganizationTimestamp, fetchOrganizationTimezone } from "@/lib/server/forms/timezone";
import { fetchAll, directoryMembers, apiStatus } from "@/lib/server/people/directory";
beforeEach(() => { state.db = database(); });
describe("form inbox filters and timezone boundaries", () => {
  it("normalizes search and default filters", () => expect(parseSubmissionFilters(new URL("http://localhost?q=%20ALICE%20"))).toEqual({ search: "alice", status: "all", from: "", to: "" }));
  it.each(["status=bad", "from=tomorrow", "to=2026-2-1", "from=2026-03-01&to=2026-02-01", `q=${"x".repeat(121)}`])("rejects invalid filter %s", query => expect(() => parseSubmissionFilters(new URL(`http://localhost?${query}`))).toThrow());
  it.each([["2026-03-08", "2026-03-08T05:00:00.000Z"], ["2026-03-09", "2026-03-09T04:00:00.000Z"], ["2026-11-01", "2026-11-01T04:00:00.000Z"], ["2026-11-02", "2026-11-02T05:00:00.000Z"]])("handles New York DST on %s", (date, utc) => expect(localDateStartIso(date, "America/New_York")).toBe(utc));
  it("advances local dates across leap day and year end", () => { expect(nextLocalDate("2024-02-28")).toBe("2024-02-29"); expect(nextLocalDate("2026-12-31")).toBe("2027-01-01"); expect(formatOrganizationTimestamp("2026-01-01T01:00:00Z", "America/New_York")).toContain("Dec 31, 2025"); });
  it("uses UTC for an unset organization timezone", async () => expect(await fetchOrganizationTimezone("org-1")).toBe("UTC"));
  it("filters submissions within the tenant and inclusive end date", async () => {
    state.db.queue("form_submissions", { data: [{ id: "1", answers: { name: "Alice" } }, { id: "2", answers: { name: "Bob" } }] });
    const result = await fetchFilteredSubmissions("form-1", "org-1", { status: "new", search: "alice", from: "2026-03-08", to: "2026-03-08" }, "America/New_York");
    expect(result.map(row => row.id)).toEqual(["1"]);
    expect(state.db.calls).toContainEqual({ table: "form_submissions", method: "eq", args: ["org_id", "org-1"] });
    expect(state.db.calls).toContainEqual({ table: "form_submissions", method: "lt", args: ["submitted_at", "2026-03-09T04:00:00.000Z"] });
  });
  it("maps current form fields", async () => { state.db.queue("form_fields", { data: [{ field_key: "name", label: "Name", field_type: "short_text", position: 2 }] }); expect(await fetchCurrentFormFields("form", "org")).toEqual([{ key: "name", label: "Name", type: "short_text", position: 2 }]); });
  it("propagates query failures rather than presenting empty results", async () => { state.db.queue("form_submissions", { error: { message: "offline" } }); await expect(fetchFilteredSubmissions("f", "o", { status: "all", search: "", from: "", to: "" })).rejects.toThrow("offline"); });
});
describe("complete people directory pagination", () => {
  it("continues past a full page without duplicating offsets", async () => { const build = vi.fn().mockResolvedValueOnce({ data: Array.from({ length: 1000 }, (_, id) => id), error: null }).mockResolvedValueOnce({ data: [1000], error: null }); expect(await fetchAll(build)).toHaveLength(1001); expect(build.mock.calls).toEqual([[0,999],[1000,1999]]); });
  it("rejects query errors", async () => { await expect(fetchAll(async () => ({ data: null, error: { message: "offline" } }))).rejects.toThrow("offline"); });
  it("scopes directory members to their organization and stage", async () => { state.db.queue("members", { data: [] }); expect(await directoryMembers("org")).toEqual([]); expect(state.db.calls).toContainEqual({ table: "members", method: "eq", args: ["membership_stage", "member"] }); });
  it.each([["UNAUTHORIZED",401],["Forbidden role",403],["Member not found",404],["Invalid input",400]])("maps directory error %s", (message,status) => expect(apiStatus(String(message))).toBe(status));
});
