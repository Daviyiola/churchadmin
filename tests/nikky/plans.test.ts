import { describe, expect, it } from "vitest";
import { normalizePlanKey } from "@/lib/plans";

describe("plan normalization", () => {
  it("treats legacy Growth as Pro", () => expect(normalizePlanKey("growth")).toBe("pro"));
  it("keeps canonical plans", () => {
    expect(normalizePlanKey("free")).toBe("free");
    expect(normalizePlanKey("pro")).toBe("pro");
    expect(normalizePlanKey("enterprise")).toBe("enterprise");
  });
  it("treats missing and unknown plans as Basic", () => {
    expect(normalizePlanKey(null)).toBe("basic");
    expect(normalizePlanKey("future-plan")).toBe("basic");
  });
});
