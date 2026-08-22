import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NikkyContext } from "@/lib/server/nikky/types";
import { canonicalizeReportParameters } from "@/lib/server/reports/registry";

const memberA = "11111111-1111-4111-8111-111111111111";
const memberB = "22222222-2222-4222-8222-222222222222";

function context(role: NikkyContext["role"]): NikkyContext {
  return {
    accessToken: "test",
    supabase: {} as SupabaseClient,
    userId: "33333333-3333-4333-8333-333333333333",
    userEmail: "test@example.com",
    organizationId: "44444444-4444-4444-8444-444444444444",
    organizationName: "Test Church",
    role,
    plan: "pro",
    timezone: "America/New_York",
    financeWindowStart: "2026-01-01",
    monthlyBudgetCents: 800,
  };
}

function monthlyParameters() {
  return {
    report_type: "member_giving",
    format: "pdf",
    start_date: "2026-01-01",
    end_date: "2026-03-31",
    detail_level: "monthly",
    include_archived: true,
    joined: "all",
    service_ids: null,
    category_ids: ["55555555-5555-4555-8555-555555555555"],
    payment_methods: null,
    member_id: null,
    member_ids: [memberA, memberB],
  };
}

describe("Member Giving report parameters", () => {
  it("binds multiple members to the monthly report confirmation", () => {
    const result = canonicalizeReportParameters(context("owner"), monthlyParameters());
    expect(result.detail_level).toBe("monthly");
    expect(result.member_id).toBeNull();
    expect(result.member_ids).toEqual([memberA, memberB]);
  });

  it("continues to block finance from named giving reports", () => {
    expect(() =>
      canonicalizeReportParameters(context("finance"), monthlyParameters()),
    ).toThrow(/not available for your role|cannot target donors/i);
  });

  it("rejects a multi-member list for legacy summary reports", () => {
    expect(() =>
      canonicalizeReportParameters(context("admin"), {
        ...monthlyParameters(),
        detail_level: "summary",
        member_id: memberA,
      }),
    ).toThrow(/accept only one member/i);
  });
});
