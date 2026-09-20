import { beforeEach, describe, expect, it, vi } from "vitest";
import { database } from "../helpers/database";
import type { NikkyContext } from "@/lib/server/nikky/types";
import type { MessageRow } from "@/lib/server/nikky/repository";
const mocks = vi.hoisted(() => ({ audit: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/server/nikky/audit", () => ({ appendNikkyAudit: mocks.audit }));
vi.mock("openai", () => ({ default: class { responses = { create: mocks.create }; } }));
import { attendanceSessionRoster, canUseNikkyDataTool, dataToolDefinitions, executeDataTool } from "@/lib/server/nikky/tools";
import { answerWithNikky } from "@/lib/server/nikky/openai";
const sessionId = "11111111-1111-4111-8111-111111111111";
const session = { id: sessionId, session_date: "2026-09-04", service_category_id: "service", attendance_completeness: "member_complete", unresolved_checkins_at_publish: 0 };
const people = Array.from({ length: 16 }, (_, index) => ({ id: `member-${index}`, first_name: `Person ${String(index).padStart(2, "0")}`, last_name: "Example", membership_stage: "member" }));
const entries = people.map((person, index) => ({ id: `entry-${index}`, session_id: sessionId, member_id: person.id, entry_source: "member", count: 1 }));
let db: ReturnType<typeof database>;
let context: NikkyContext;
beforeEach(() => {
  vi.clearAllMocks(); db = database();
  context = { supabase: db, role: "owner", organizationId: "org", organizationName: "Church", userId: "actor", timezone: "America/New_York", financeWindowStart: "2026-06-01" } as unknown as NikkyContext;
  process.env.NIKKY_AUDIT_HMAC_SECRET = "roster-test-secret";
});
function seed(extra: Record<string, unknown>[] = [], members = people) {
  db.queue("attendance_sessions", { data: session });
  db.queue("attendance_entries", { data: [...entries, ...extra] });
  db.queue("members", { data: members });
  db.queue("categories", { data: [{ id: "service", name: "Friday Service" }] });
}
async function roster(page = 1) { return attendanceSessionRoster(context, { session_id: sessionId, page }); }
describe("published session roster", () => {
  it("lists all 16 recorded attendees for the Friday session", async () => {
    seed(); const output = await roster();
    expect(output.outcome).toBe("ok");
    expect(output.data).toMatchObject({ date: "2026-09-04", service: "Friday Service", total_attendance: 16, recorded_people_count: 16, roster_complete: true, attendees: { total_count: 16, truncated: false } });
    expect((output.data as { attendees: { rows: unknown[] } }).attendees.rows).toHaveLength(16);
    for (const table of ["attendance_sessions", "attendance_entries", "members", "categories"]) expect(db.calls).toContainEqual({ table, method: "eq", args: ["org_id", "org"] });
    expect(db.calls).toContainEqual({ table: "attendance_sessions", method: "eq", args: ["status", "published"] });
    expect(db.calls).toContainEqual({ table: "attendance_sessions", method: "is", args: ["deleted_at", null] });
    expect(db.calls).toContainEqual({ table: "members", method: "in", args: ["status", ["active", "archived"]] });
    expect(db.calls.find((call) => call.table === "members" && call.method === "select")?.args[0]).toBe("id,first_name,last_name,membership_stage");
  });
  it("lists named attendees alongside anonymous headcounts without inventing identities", async () => {
    seed([{ id: "headcount", member_id: null, entry_source: "headcount", count: 5 }]);
    expect((await roster()).data).toMatchObject({ total_attendance: 21, recorded_people_count: 16, anonymous_attendance_count: 5, roster_complete: false });
  });
  it("does not claim incomplete published check-ins are a complete roster", async () => {
    seed(); db.queue("attendance_sessions", { data: { ...session, attendance_completeness: "unresolved_omitted", unresolved_checkins_at_publish: 2 } });
    expect((await roster()).data).toMatchObject({ recorded_people_count: 16, roster_complete: false, unresolved_checkins_at_publish: 2 });
  });
  it("returns an anonymous-only session without looking up or inventing people", async () => {
    seed(); db.queue("attendance_entries", { data: [{ id: "headcount", member_id: null, entry_source: "headcount", count: 16 }] });
    expect((await roster()).data).toMatchObject({ total_attendance: 16, recorded_people_count: 0, anonymous_attendance_count: 16, roster_complete: false, attendees: { rows: [] } });
    expect(db.from).not.toHaveBeenCalledWith("members");
  });
  it("reads entries past the database's first 1,000-row page", async () => {
    seed();
    db.queue("attendance_entries", { data: Array.from({ length: 1000 }, (_, index) => ({ ...entries[0], id: `entry-${index}` })) }, { data: [entries[1]] });
    db.queue("members", { data: people.slice(0, 2) });
    expect((await roster()).data).toMatchObject({ total_attendance: 1001, recorded_people_count: 2 });
    expect(db.calls).toContainEqual({ table: "attendance_entries", method: "range", args: [1000, 1999] });
  });
  it("distinguishes unavailable names from anonymous attendance", async () => {
    seed([], people.slice(0, 15));
    expect((await roster()).data).toMatchObject({ recorded_people_count: 15, unavailable_member_name_count: 1, anonymous_attendance_count: 0, roster_complete: false });
  });
  it("keeps first-timer classification instead of calling every person a registered member", async () => {
    seed([], [{ ...people[0], membership_stage: "first_timer" }, ...people.slice(1)]);
    const output = await roster();
    expect((output.data as { attendees: { rows: unknown[] } }).attendees.rows[0]).toMatchObject({ membership_stage: "first_timer" });
  });
  it("deduplicates people without hiding a mismatched aggregate count", async () => {
    seed([{ ...entries[0], id: "duplicate" }]);
    expect((await roster()).data).toMatchObject({ total_attendance: 17, recorded_people_count: 16, roster_complete: false });
  });
  it("returns no records for inaccessible, draft, or deleted sessions without querying identities", async () => {
    db.queue("attendance_sessions", { data: null });
    expect((await roster()).outcome).toBe("no_records");
    expect(db.from).not.toHaveBeenCalledWith("members");
    expect(db.from).not.toHaveBeenCalledWith("attendance_entries");
  });
  it.each([0, -1, 1.5, 1001])("rejects an invalid page %s", async (page) => { await expect(roster(page)).rejects.toThrow("page"); });
  it("paginates names and exposes how many remain", async () => {
    seed();
    const many = Array.from({ length: 61 }, (_, index) => ({ ...people[0], id: `member-${index}`, first_name: `Person ${String(index).padStart(2, "0")}` }));
    db.queue("members", { data: many });
    db.queue("attendance_entries", { data: many.map((person) => ({ id: person.id, member_id: person.id, entry_source: "member", count: 1 })) });
    const output = await roster(2);
    expect(output.data).toMatchObject({ attendees: { page: 2, total_count: 61, total_pages: 2, truncated: false } });
    expect((output.data as { attendees: { rows: unknown[] } }).attendees.rows).toHaveLength(11);
  });
  it("fails instead of presenting partial data when a member lookup fails", async () => {
    seed(); db.queue("members", { error: { message: "Lookup failed" } });
    await expect(roster()).rejects.toThrow("Lookup failed");
  });
});
describe("Nikky roster authorization and follow-up", () => {
  it("offers the roster to owners/admins, not finance", () => {
    for (const role of ["owner", "admin", "finance"] as const) {
      expect(dataToolDefinitions({ ...context, role }).some((tool) => tool.name === "attendance_session_roster")).toBe(role !== "finance");
      expect(canUseNikkyDataTool({ role }, "attendance_session_roster")).toBe(role !== "finance");
    }
  });
  it("rejects finance even if the hidden tool is called directly", async () => {
    const finance = { ...context, role: "finance" as const };
    expect((await attendanceSessionRoster(finance, { session_id: sessionId, page: 1 })).outcome).toBe("forbidden");
    expect((await executeDataTool(finance, "conversation", "attendance_session_roster", { session_id: sessionId, page: 1 })).outcome).toBe("forbidden");
    expect(db.from).not.toHaveBeenCalled();
  });
  it("audits named attendance as sensitive without putting names into audit arguments", async () => {
    seed(); await executeDataTool(context, "conversation", "attendance_session_roster", { session_id: sessionId, page: 1 });
    expect(mocks.audit).toHaveBeenCalledWith(context, expect.objectContaining({ classifications: ["member_attendance_sensitive"], recordCount: 16, authorizationOutcome: "allowed" }));
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("Person 00");
  });
  it("supports the exact date → who attended follow-up through summary and roster tools", async () => {
    seed();
    db.queue("attendance_sessions", { data: [session] }, { data: session });
    db.queue("attendance_entries", { data: entries }, { data: entries });
    db.queue("categories", { data: [{ id: "service", name: "Friday Service" }] }, { data: [{ id: "service", name: "Friday Service" }] });
    const call = (name: string, args: unknown, id: string) => ({ output_text: "", output: [{ type: "function_call", id, call_id: id, name, arguments: JSON.stringify(args), status: "completed" }] });
    mocks.create.mockResolvedValueOnce(call("attendance_summary", { start_date: "2026-09-04", end_date: "2026-09-04" }, "summary"))
      .mockResolvedValueOnce(call("attendance_session_roster", { session_id: sessionId, page: 1 }, "roster"))
      .mockResolvedValueOnce({ output: [], output_text: "Friday Service on September 4, 2026: Person 00 Example and 15 other recorded attendees." });
    const history = [
      { role: "user", content: "whats the attendance for september 4th?" },
      { role: "assistant", content: "September 4, 2026: 16 attendees at Friday Service." },
      { role: "user", content: "who were the memnbers" },
    ] as MessageRow[];
    const answer = await answerWithNikky(context, "conversation", history, history[2].content);
    expect(answer.usage.toolCalls).toBe(2);
    expect(answer.content).toContain("Person 00 Example");
    expect(answer.evidenceIds).toHaveLength(2);
    expect(mocks.create.mock.calls[0][0].tools.some((tool: { name: string }) => tool.name === "attendance_session_roster")).toBe(true);
  });
});
