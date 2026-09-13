import { describe, expect, it } from "vitest";
import { matchesDate, nextOccurrences, validateRecurrence, zonedDateTime, type Recurrence } from "@/lib/attendance/recurrence";
const rule: Recurrence = { service_category_id: "33333333-3333-4333-8333-333333333333", starts_on: "2026-09-01", ends_on: null, every_weeks: 1, weekdays: [0], service_time: "10:00", opens_before_minutes: 30, closes_after_minutes: 90 };
describe("weekly recurrence validation", () => {
  it("normalizes duplicate weekdays and stored time values", () => {
    expect(validateRecurrence({ ...rule, weekdays: [3, 0, 3], service_time: "10:00:00" })).toMatchObject({ weekdays: [0, 3], service_time: "10:00" });
  });
  it.each([
    { every_weeks: 0 }, { every_weeks: 13 }, { every_weeks: 1.5 }, { every_weeks: "2" },
    { weekdays: [] }, { weekdays: [7] }, { weekdays: [1.5] }, { weekdays: ["0"] },
    { starts_on: "2026-02-30" }, { ends_on: "2026-08-31" }, { ends_on: "bad" },
    { service_time: "24:00" }, { service_time: "10:99" }, { service_category_id: "" },
    { opens_before_minutes: -1 }, { opens_before_minutes: 181 }, { closes_after_minutes: 0 }, { closes_after_minutes: 721 },
    { org_id: "untrusted" }, { paused: true },
  ])("rejects invalid settings %j", invalid => expect(() => validateRecurrence({ ...rule, ...invalid })).toThrow());
});
it("anchors alternate weeks to Monday, including across a year boundary", () => {
  const alternate = { ...rule, starts_on: "2026-12-30", every_weeks: 2, weekdays: [0, 3] };
  expect(matchesDate(alternate, "2027-01-03")).toBe(true);
  expect(matchesDate(alternate, "2027-01-06")).toBe(false);
  expect(matchesDate(alternate, "2027-01-13")).toBe(true);
});
it("includes the start/end dates and excludes earlier dates", () => {
  const limited = { ...rule, starts_on: "2026-09-06", ends_on: "2026-09-13" };
  expect(matchesDate(limited, "2026-08-30")).toBe(false);
  expect(matchesDate(limited, "2026-09-06")).toBe(true);
  expect(matchesDate(limited, "2026-09-13")).toBe(true);
  expect(matchesDate(limited, "2026-09-20")).toBe(false);
});
it("preserves local service time as UTC offsets change", () => {
  const result = nextOccurrences({ ...rule, starts_on: "2026-03-01" }, "America/New_York", new Date("2026-03-01T00:00Z"), [], null, 2);
  expect(result.map(row => row.service_at)).toEqual(["2026-03-01T15:00:00.000Z", "2026-03-08T14:00:00.000Z"]);
});
it("rejects spring gaps and chooses the later autumn time", () => {
  expect(() => zonedDateTime("2026-03-08T02:30", "America/New_York")).toThrow(/does not exist/);
  expect(zonedDateTime("2026-11-01T01:30", "America/New_York")).toBe("2026-11-01T06:30:00.000Z");
});
it("supports half-hour timezones", () => {
  expect(zonedDateTime("2026-09-06T10:00", "Asia/Kolkata")).toBe("2026-09-06T04:30:00.000Z");
});
it("keeps a previous service date when check-in crosses midnight", () => {
  const result = nextOccurrences({ ...rule, service_time: "23:00", closes_after_minutes: 180 }, "UTC", new Date("2026-09-07T00:30Z"));
  expect(result[0]).toMatchObject({ date: "2026-09-06", closes_at: "2026-09-07T02:00:00.000Z" });
});
it("marks skipped dates and honors code expiry", () => {
  const result = nextOccurrences(rule, "UTC", new Date("2026-09-01T00:00Z"), ["2026-09-06"], "2026-09-13");
  expect(result.map(row => [row.date, row.skipped])).toEqual([["2026-09-06", true], ["2026-09-13", false]]);
});
it("does not preview a window that extends beyond expiry", () => {
  expect(nextOccurrences({ ...rule, service_time: "23:00", closes_after_minutes: 180 }, "UTC", new Date("2026-09-06T20:00Z"), [], "2026-09-06")).toEqual([]);
});
it("stops showing an occurrence at its exact closing instant", () => {
  expect(nextOccurrences(rule, "UTC", new Date("2026-09-06T11:30Z"))[0].date).toBe("2026-09-13");
});
