import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertDateRange, dateContext, enforceFinanceWindow, organizationToday } from "@/lib/server/nikky/dates";
import type { NikkyContext } from "@/lib/server/nikky/types";

const context = (role: NikkyContext["role"]): NikkyContext => ({
  accessToken: "test", supabase: {} as NikkyContext["supabase"], userId: "user", userEmail: null,
  organizationId: "org", organizationName: "Church", role, plan: "pro", timezone: "America/New_York",
  financeWindowStart: "2026-04-23", monthlyBudgetCents: 2500,
});

describe("Nikky date policy", () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T16:00:00Z"));
  });
  afterAll(() => vi.useRealTimers());
  it("uses the organization timezone", () => expect(organizationToday("America/New_York", new Date("2026-07-22T02:00:00Z"))).toBe("2026-07-21"));
  it("defines last Sunday as strictly before today", () => expect(dateContext(context("admin")).last_sunday).toBe("2026-07-19"));
  it("rejects finance dates before the database-derived cutoff without truncating", () => expect(() => enforceFinanceWindow(context("finance"), "2026-04-22")).toThrow("begins 2026-04-23"));
  it("accepts the exact finance cutoff", () => expect(() => enforceFinanceWindow(context("finance"), "2026-04-23")).not.toThrow());
  it("rejects malformed and reversed dates", () => { expect(() => assertDateRange("2026-02-30", "2026-03-01")).toThrow(); expect(() => assertDateRange("2026-03-02", "2026-03-01")).toThrow(); });
});
