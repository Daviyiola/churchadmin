import { describe, expect, it } from "vitest";
import { isExplicitAffirmative } from "@/lib/sms/types";

describe("form SMS consent", () => {
  it("requires an exact configured affirmative answer", () => {
    expect(isExplicitAffirmative("Yes, text me", ["Yes, text me"])).toBe(true);
    expect(isExplicitAffirmative("yes, TEXT me", ["Yes, text me"])).toBe(true);
    expect(isExplicitAffirmative("Maybe", ["Yes, text me"])).toBe(false);
  });

  it("accepts an affirmative selection inside checkbox answers", () => {
    expect(isExplicitAffirmative(["Email", "SMS"], ["SMS"])).toBe(true);
    expect(isExplicitAffirmative(["Email"], ["SMS"])).toBe(false);
  });
});
