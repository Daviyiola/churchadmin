import { afterEach, describe, expect, it, vi } from "vitest";
import { hexToRgbTriplet, rgbTripletToHex } from "@/lib/utils/color";
import { cleanStr, isRole, isStatus, isYYYYMM, isYYYYMMDD, monthFromDate } from "@/lib/schedule/util";
import { assertPublicMonthAllowed, getPublicAllowedMonths } from "@/lib/schedule/public_rules";
import { financeWindowStart } from "@/lib/reports/financeWindow";
import { normalizeNikkyMarkdown } from "@/lib/nikkyMarkdown";
import { nikkyStarters } from "@/lib/nikkyStarters";
import { isAudienceEmail, normalizeAudienceEmail } from "@/lib/communications/audience";
import { getUnsaved, setUnsaved, subscribeUnsaved } from "@/lib/unsaved";
afterEach(() => vi.useRealTimers());
describe("branding color input", () => {
  it.each([["#000000", "0 0 0"], ["#FFFFFF", "255 255 255"], ["2f5e85", "47 94 133"]])("converts %s", (hex, rgb) => { expect(hexToRgbTriplet(hex)).toBe(rgb); expect(rgbTripletToHex(rgb)).toBe(`#${hex.replace("#", "").toLowerCase()}`); });
  it.each(["", "#123", "#1g0000", "#001z00", "#00000z", "##12345"]) ("rejects invalid hex %s", value => expect(hexToRgbTriplet(value)).toBeNull());
  it.each([null, undefined, "", "1 2", "1 2 3 4", "-1 0 0", "256 0 0", "1.5 0 0", "NaN 0 0"])("rejects invalid RGB %s", value => expect(rgbTripletToHex(value)).toBeNull());
});
describe("schedule calendar boundaries", () => {
  it.each(["2026-00", "2026-13", "2026-1", "x", "2026-02-01"])("rejects invalid month %s", value => expect(isYYYYMM(value)).toBe(false));
  it.each(["2026-02-29", "2026-04-31", "2026-00-01", "2026-01-00", "2026-13-01"])("rejects impossible date %s", value => expect(isYYYYMMDD(value)).toBe(false));
  it("accepts leap dates and formats local months", () => { expect(isYYYYMMDD("2024-02-29")).toBe(true); expect(isYYYYMM("2026-12")).toBe(true); expect(monthFromDate(new Date(2026, 0, 2))).toBe("2026-01"); });
  it("limits public access to three months across a year boundary", () => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 11, 15)); expect(getPublicAllowedMonths()).toEqual(["2026-12", "2027-01", "2027-02"]); expect(assertPublicMonthAllowed("2027-02")).toBe(true); expect(assertPublicMonthAllowed("2027-03")).toBe(false); expect(assertPublicMonthAllowed("")).toBe(false); });
  it.each(["lead", "asst", "member"])("accepts staffing role %s", value => expect(isRole(value)).toBe(true));
  it.each(["owner", null, "pending"])("rejects staffing role %s", value => expect(isRole(value)).toBe(false));
  it.each(["pending", "approved", "rejected"])("accepts status %s", value => expect(isStatus(value)).toBe(true));
  it("normalizes optional strings", () => { expect(cleanStr(null)).toBe(""); expect(cleanStr(" a ")).toBe("a"); expect(cleanStr(12)).toBe("12"); expect(isStatus("active")).toBe(false); });
});
describe("shared presentation and state", () => {
  it("computes the UTC finance cutoff across leap February", () => expect(financeWindowStart(new Date("2024-05-29T23:59:00Z"))).toBe("2024-02-29"));
  it("normalizes bold spacing without breaking punctuation", () => { expect(normalizeNikkyMarkdown("Total** 100 **people.")).toBe("Total **100** people."); expect(normalizeNikkyMarkdown("(**value**).")).toBe("(**value**)."); });
  it("expands compact tables but leaves ordinary paragraphs intact", () => { expect(normalizeNikkyMarkdown("| Name | Value | | --- | --- | | A | 1 |")).toContain("\n| ---"); expect(normalizeNikkyMarkdown("Plain text")).toBe("Plain text"); });
  it.each([0, 1, -2, 5, 11])("rotates three finance-safe suggestions (%s)", rotation => { const items = nikkyStarters("finance", rotation); expect(items).toHaveLength(3); expect(items.every(Boolean)).toBe(true); expect(items.join(" ")).not.toMatch(/pastoral|donors|Tithe/); });
  it("notifies unsaved-state listeners and supports unsubscribe", () => { const listener = vi.fn(); const stop = subscribeUnsaved(listener); setUnsaved(true); expect(getUnsaved()).toBe(true); expect(listener).toHaveBeenCalledWith(true); stop(); setUnsaved(false); expect(listener).toHaveBeenCalledTimes(1); });
  it.each(["bad", "a@b", "a b@example.com", "a@@b.com", `${"x".repeat(250)}@example.com`])("rejects invalid recipient %s", email => expect(isAudienceEmail(email)).toBe(false));
  it("normalizes email case and whitespace", () => { expect(normalizeAudienceEmail(" A@Example.com ")).toBe("a@example.com"); expect(isAudienceEmail(" A@Example.com ")).toBe(true); });
});
