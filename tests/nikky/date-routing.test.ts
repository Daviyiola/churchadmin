import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NikkyContext } from "@/lib/server/nikky/types";
import type { MessageRow } from "@/lib/server/nikky/repository";
const mocks = vi.hoisted(() => ({ create: vi.fn(), data: vi.fn(), report: vi.fn(), audit: vi.fn() }));
vi.mock("openai", () => ({ default: class { responses = { create: mocks.create }; } }));
vi.mock("@/lib/server/nikky/tools", () => ({ executeDataTool: mocks.data, dataToolDefinitions: () => [] }));
vi.mock("@/lib/server/nikky/reports", () => ({ executeReportTool: mocks.report, reportToolDefinitions: [] }));
vi.mock("@/lib/server/nikky/audit", () => ({ appendNikkyAudit: mocks.audit }));
import { analyticalDateClarification, answerWithNikky, reportDates } from "@/lib/server/nikky/openai";
const context = { accessToken: "x", supabase: {}, userId: "u", organizationId: "o", organizationName: "Church", role: "admin", plan: "pro", timezone: "America/New_York", financeWindowStart: "2026-06-01", monthlyBudgetCents: 1000 } as NikkyContext;
const message = (role: "user" | "assistant", content: string) => ({ role, content }) as MessageRow;
beforeEach(() => {
  vi.clearAllMocks();
  process.env.NIKKY_AUDIT_HMAC_SECRET = "test-date-routing-secret";
  mocks.report.mockResolvedValue({ outcome: "ok", evidence_id: "report-evidence", applied: { start_date: "2026-08-28", end_date: "2026-08-28", format: "pdf" }, data: { report_name: "Attendance" } });
  mocks.data.mockResolvedValue({ outcome: "ok", evidence_id: "data-evidence", data: {} });
  mocks.create.mockResolvedValue({ output: [], output_text: "Which year should I use for August?" });
});
describe("date-aware preflight", () => {
  it.each([
    "What was attendance on 2026-08-28?",
    "What was attendance on August 28, 2026?",
    "How much income came in between August 1 and August 31, 2026?",
    "What were expenses from 8/1/2026 to 8/31/2026?",
    "What was attendance from 28 August 2026 to 4 September 2026?",
    "What was total giving in August 2026?",
    "Compare attendance last month with this month",
    "What was attendance yesterday?",
    "What was attendance in Q3 2026?",
    "What was attendance for the past 30 days?",
  ])("does not reject supplied dates: %s", (text) => { expect(analyticalDateClarification(context, text)).toBeNull(); });
  it("maps one ISO date to an inclusive day", () => {
    expect(reportDates(context, "Attendance on 2026-08-28")).toEqual({ start_date: "2026-08-28", end_date: "2026-08-28" });
  });
  it("preserves explicit ISO endpoints", () => {
    expect(reportDates(context, "Attendance from 2026-08-01 through 2026-08-31")).toEqual({ start_date: "2026-08-01", end_date: "2026-08-31" });
  });
  it.each(["Attendance since 2026-08-28", "Attendance on 2026-02-30", "Attendance from 2026-08-31 to 2026-08-01", "Compare 2026-08-28 with today", "Compare 2026-08-28 with 2026-09-04", "Attendance on 2026-08-28 and 2026-09-04", "Compare this month with last month", "Giving in August 2026 and this month"])("does not invent or truncate a range: %s", (text) => { expect(reportDates(context, text)).toBeNull(); });
  it("still asks when an initial analysis genuinely has no dates", () => {
    expect(analyticalDateClarification(context, "What was the highest attendance?")).toContain("date range");
    expect(analyticalDateClarification(context, "What was total income recently?")).toContain("date range");
  });
});
describe("end-to-end routing without external calls", () => {
  it("prepares a single-day report with both endpoints", async () => {
    const text = "Create a quick attendance report for 2026-08-28";
    const result = await answerWithNikky(context, "c", [message("user", text)], text);
    expect(result.model).toBe("report-router");
    expect(mocks.report).toHaveBeenCalledWith(context, "c", "prepare_report_preview", expect.objectContaining({ start_date: "2026-08-28", end_date: "2026-08-28" }));
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each([
    "Create a quick attendance report for August 28, 2026",
    "Create a quick income report for August 1–31, 2026",
    "How many new members joined between August 1 and August 31, 2026?",
    "What was attendance on August 28, 2026?",
  ])("lets the contextual planner interpret natural dates: %s", async (text) => {
    await answerWithNikky(context, "c", [message("user", text)], text);
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.report).not.toHaveBeenCalled();
    expect(mocks.data).not.toHaveBeenCalled();
  });
  it.each(["And attendance?", "Create the quick attendance report", "How many new members joined?"])("preserves previous dates for follow-ups: %s", async (text) => {
    const history = [message("user", "Show giving from August 1 to August 31, 2026"), message("assistant", "Giving for August 1–31, 2026 was checked."), message("user", text)];
    await answerWithNikky(context, "c", history, text);
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.create.mock.calls[0][0].input).toEqual(expect.arrayContaining([expect.objectContaining({ content: history[0].content }), expect.objectContaining({ content: text })]));
  });
  it("keeps the original subject and filters after a date-only clarification reply", async () => {
    const text = "August 1–31, 2026";
    await answerWithNikky(context, "c", [message("user", "Create a quick income report for cash offerings"), message("assistant", "What date range should I use?"), message("user", text)], text);
    expect(mocks.create.mock.calls[0][0].input[0].content).toContain("cash offerings");
  });
  it("preserves a focused year question instead of replacing it with a verification failure", async () => {
    const text = "What was attendance in August?";
    expect((await answerWithNikky(context, "c", [message("user", text)], text)).content).toBe("Which year should I use for August?");
  });
  it("continues to reject factual answers without a tool check", async () => {
    mocks.create.mockResolvedValue({ output: [], output_text: "Attendance was 150." });
    const text = "What was attendance on August 28, 2026?";
    expect((await answerWithNikky(context, "c", [message("user", text)], text)).content).toContain("couldn't verify");
  });
});
