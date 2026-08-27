import { describe, expect, it } from "vitest";
import { normalizeUsSmsPhone } from "@/lib/sms/phone";

describe("US SMS phone normalization", () => {
  it.each([
    ["415-555-2671", "+14155552671"],
    ["(415) 555-2671", "+14155552671"],
    ["1 415 555 2671", "+14155552671"],
    ["+1 415 555 2671", "+14155552671"],
  ])("normalizes %s", (raw, expected) => {
    expect(normalizeUsSmsPhone(raw)).toEqual({ ok: true, e164: expected });
  });

  it("keeps missing, extensions, invalid, and international values distinct", () => {
    expect(normalizeUsSmsPhone("")).toEqual({ ok: false, reason: "missing" });
    expect(normalizeUsSmsPhone("415-555-2671 ext 4")).toEqual({ ok: false, reason: "extension" });
    expect(normalizeUsSmsPhone("12345")).toEqual({ ok: false, reason: "invalid" });
    expect(normalizeUsSmsPhone("+44 20 7946 0958")).toEqual({ ok: false, reason: "unsupported_country" });
  });
});
