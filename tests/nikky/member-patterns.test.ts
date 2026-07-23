import { describe, expect, it } from "vitest";
import {
  attendanceInconsistency,
  attendanceMemberChanges,
  attendancePastoralCandidates,
  donorGivingPatterns,
  regularTitheActivity,
  sundayMemberCheckins,
} from "@/lib/server/nikky/tools";
import type { NikkyContext } from "@/lib/server/nikky/types";

type Row = Record<string, unknown>;

class Query {
  private filters: Array<(row: Row) => boolean> = [];
  private rangeStart = 0;
  private rangeEnd = Number.POSITIVE_INFINITY;
  private max = Number.POSITIVE_INFINITY;
  private orders: Array<{ field: string; ascending: boolean }> = [];

  constructor(private readonly rows: Row[]) {}
  select() { return this; }
  eq(field: string, value: unknown) { this.filters.push((row) => row[field] === value); return this; }
  is(field: string, value: unknown) { this.filters.push((row) => row[field] === value); return this; }
  in(field: string, values: unknown[]) { this.filters.push((row) => values.includes(row[field])); return this; }
  gte(field: string, value: unknown) { this.filters.push((row) => String(row[field]) >= String(value)); return this; }
  lte(field: string, value: unknown) { this.filters.push((row) => String(row[field]) <= String(value)); return this; }
  order(field: string, options?: { ascending?: boolean }) {
    this.orders.push({ field, ascending: options?.ascending !== false });
    return this;
  }
  limit(value: number) { this.max = value; return this; }
  range(start: number, end: number) { this.rangeStart = start; this.rangeEnd = end; return this; }
  then(resolve: (value: { data: Row[]; error: null }) => void) {
    let output = this.rows.filter((row) => this.filters.every((filter) => filter(row)));
    for (const order of this.orders.slice().reverse()) {
      output = output.slice().sort((a, b) => {
        const comparison = String(a[order.field] ?? "").localeCompare(String(b[order.field] ?? ""));
        return order.ascending ? comparison : -comparison;
      });
    }
    output = output.slice(this.rangeStart, Math.min(this.rangeEnd + 1, this.rangeStart + this.max));
    resolve({ data: output, error: null });
  }
}

function testContext(tables: Record<string, Row[]>): NikkyContext {
  return {
    accessToken: "token",
    supabase: { from: (table: string) => new Query(tables[table] ?? []) } as never,
    userId: "user",
    userEmail: null,
    organizationId: "org",
    organizationName: "Church",
    role: "admin",
    plan: "pro",
    timezone: "UTC",
    financeWindowStart: "2026-04-23",
    monthlyBudgetCents: 800,
  };
}

const members = [
  { id: "m1", org_id: "org", first_name: "David", last_name: "Iyiola", status: "active", membership_stage: "member" },
  { id: "m2", org_id: "org", first_name: "Grace", last_name: "Iyiola", status: "active", membership_stage: "member" },
  { id: "merged", org_id: "org", first_name: "Old", last_name: "Record", status: "merged", membership_stage: "member" },
];

describe("Nikky member attendance reliability", () => {
  it("keeps an unlisted member unknown when a Sunday contains anonymous headcount", async () => {
    const context = testContext({
      members,
      categories: [{ id: "service", org_id: "org", name: "Sunday Service" }],
      attendance_sessions: [
        { id: "s1", org_id: "org", session_date: "2026-07-05", service_category_id: "service", status: "published", deleted_at: null },
        { id: "s2", org_id: "org", session_date: "2026-07-12", service_category_id: "service", status: "published", deleted_at: null },
      ],
      attendance_entries: [
        { org_id: "org", session_id: "s1", entry_source: "member", member_id: "m1", count: 1 },
        { org_id: "org", session_id: "s2", entry_source: "member", member_id: "m1", count: 1 },
        { org_id: "org", session_id: "s2", entry_source: "headcount", member_id: null, count: 5 },
      ],
    });
    const output = await sundayMemberCheckins(context, {
      sunday_dates: ["2026-07-05", "2026-07-12"],
      page: 1,
    });
    const data = output.data as {
      members_with_no_recorded_checkin: { rows: Array<{ member_id: string; overall_status: string; sundays: Array<{ status: string }> }> };
    };
    expect(data.members_with_no_recorded_checkin.rows).toEqual([
      expect.objectContaining({
        member_id: "m2",
        overall_status: "unknown",
        sundays: [{ date: "2026-07-05", status: "recorded_absent" }, { date: "2026-07-12", status: "unknown" }],
      }),
    ]);
  });

  it("detects conservative decline, inconsistency, and pastoral signals", async () => {
    const sessions = Array.from({ length: 20 }, (_, index) => ({
      id: `s${index + 1}`,
      org_id: "org",
      session_date: `2026-${String(Math.floor(index / 4) + 1).padStart(2, "0")}-${String(index % 4 + 1).padStart(2, "0")}`,
      service_category_id: "service",
      status: "published",
      deleted_at: null,
    }));
    const attendanceEntries = sessions.flatMap((session, index) => [
      { org_id: "org", session_id: session.id, entry_source: "member", member_id: "m2", count: 1 },
      ...(index < 10 && index % 2 === 0 ? [{ org_id: "org", session_id: session.id, entry_source: "member", member_id: "m1", count: 1 }] : []),
    ]);
    const context = testContext({
      members,
      categories: [{ id: "service", org_id: "org", name: "Sunday Service" }],
      attendance_sessions: sessions,
      attendance_entries: attendanceEntries,
    });
    const decline = await attendanceMemberChanges(context, {
      baseline_start: "2026-01-01", baseline_end: "2026-01-04",
      current_start: "2026-05-01", current_end: "2026-05-04", page: 1,
    });
    expect((decline.data as { matches: { rows: Array<{ member_id: string }> } }).matches.rows)
      .toContainEqual(expect.objectContaining({ member_id: "m1" }));

    const inconsistency = await attendanceInconsistency(context, {
      start_date: "2026-01-01", end_date: "2026-02-04", page: 1,
    });
    expect((inconsistency.data as { matches: { rows: Array<{ member_id: string }> } }).matches.rows)
      .toContainEqual(expect.objectContaining({ member_id: "m1" }));

    const pastoralSessions = sessions.slice(0, 12);
    const pastoralEntries = pastoralSessions.flatMap((session, index) => [
      { org_id: "org", session_id: session.id, entry_source: "member", member_id: "m2", count: 1 },
      ...(index < 6 ? [{ org_id: "org", session_id: session.id, entry_source: "member", member_id: "m1", count: 1 }] : []),
    ]);
    const pastoral = await attendancePastoralCandidates(testContext({
      members,
      categories: [{ id: "service", org_id: "org", name: "Sunday Service" }],
      attendance_sessions: pastoralSessions,
      attendance_entries: pastoralEntries,
    }), { as_of_date: "2026-03-04", page: 1 });
    expect((pastoral.data as { candidates: { rows: Array<{ member_id: string }> } }).candidates.rows)
      .toContainEqual(expect.objectContaining({ member_id: "m1" }));
  });
});

describe("Nikky identifiable giving patterns", () => {
  it("limits missing-Tithe results to regular historical Tithe givers", async () => {
    const context = testContext({
      members,
      categories: [{ id: "tithe", org_id: "org", name: "Tithe", type: "income", status: "active" }],
      income_entries: [
        { org_id: "org", session_date: "2025-06-01", member_id: "m1", income_category_id: "tithe", amount_cents: 10000, entry_type: "original" },
        { org_id: "org", session_date: "2025-07-01", member_id: "m1", income_category_id: "tithe", amount_cents: 10000, entry_type: "original" },
        { org_id: "org", session_date: "2025-08-01", member_id: "m1", income_category_id: "tithe", amount_cents: 10000, entry_type: "original" },
        { org_id: "org", session_date: "2025-06-01", member_id: "m2", income_category_id: "tithe", amount_cents: 10000, entry_type: "original" },
        { org_id: "org", session_date: "2025-07-01", member_id: "m2", income_category_id: "tithe", amount_cents: 10000, entry_type: "original" },
        { org_id: "org", session_date: "2026-04-15", member_id: null, income_category_id: "tithe", amount_cents: 5000, entry_type: "original" },
      ],
    });
    const output = await regularTitheActivity(context, {
      analysis: "no_recent_tithe",
      current_start: "2026-04-01",
      current_end: "2026-06-30",
      baseline_start: null,
      baseline_end: null,
      page: 1,
    });
    const data = output.data as {
      matches: { rows: Array<{ member_id: string }> };
      eligible_regular_tithe_giver_count: number;
      anonymous_recent_tithe: { record_count: number };
    };
    expect(data.matches.rows).toEqual([expect.objectContaining({ member_id: "m1" })]);
    expect(data.eligible_regular_tithe_giver_count).toBe(1);
    expect(data.anonymous_recent_tithe.record_count).toBe(1);
  });

  it("applies the conservative recurring-donor amount threshold", async () => {
    const context = testContext({
      members,
      categories: [],
      income_entries: [
        { org_id: "org", session_date: "2025-01-05", member_id: "m1", income_category_id: "offering", amount_cents: 10000, entry_type: "original" },
        { org_id: "org", session_date: "2025-02-05", member_id: "m1", income_category_id: "offering", amount_cents: 10000, entry_type: "original" },
        { org_id: "org", session_date: "2025-03-05", member_id: "m1", income_category_id: "offering", amount_cents: 10000, entry_type: "original" },
        { org_id: "org", session_date: "2026-01-05", member_id: "m1", income_category_id: "offering", amount_cents: 10000, entry_type: "original" },
      ],
    });
    const output = await donorGivingPatterns(context, {
      analysis: "reduced_amount",
      baseline_start: "2025-01-01",
      baseline_end: "2025-03-31",
      current_start: "2026-01-01",
      current_end: "2026-03-31",
      category_id: null,
      page: 1,
    });
    expect((output.data as { matches: { rows: Array<{ member_id: string; change_cents: number }> } }).matches.rows)
      .toEqual([expect.objectContaining({ member_id: "m1", change_cents: -20000 })]);
  });
});
