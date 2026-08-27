import { describe, expect, it } from "vitest";
import { estimateSmsSegments, renderSmsPersonalization } from "@/lib/sms/segments";

describe("SMS segment estimation", () => {
  it("uses GSM-7 single and multipart limits", () => {
    expect(estimateSmsSegments("a".repeat(160))).toMatchObject({ encoding: "gsm7", segments: 1, units: 160 });
    expect(estimateSmsSegments("a".repeat(161))).toMatchObject({ encoding: "gsm7", segments: 2, units: 161 });
  });

  it("counts GSM extension characters as two units", () => {
    expect(estimateSmsSegments("^".repeat(80))).toMatchObject({ encoding: "gsm7", units: 160, segments: 1 });
  });

  it("uses Unicode limits and handles emoji code units", () => {
    expect(estimateSmsSegments("🙂".repeat(35))).toMatchObject({ encoding: "unicode", units: 70, segments: 1 });
    expect(estimateSmsSegments("🙂".repeat(36))).toMatchObject({ encoding: "unicode", units: 72, segments: 2 });
  });

  it("renders only the approved first-name variable", () => {
    expect(renderSmsPersonalization("Hi {{first_name}} — {{unknown}}", "David"))
      .toBe("Hi David — {{unknown}}");
  });
});
