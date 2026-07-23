import { describe, expect, it } from "vitest";
import {
  friendlyTimezoneName,
  isValidTimezone,
  timezoneOptions,
} from "@/lib/timezones";

describe("organization timezones", () => {
  it("uses friendly labels while preserving IANA values", () => {
    expect(friendlyTimezoneName("America/Chicago")).toBe("Central Time");
    expect(timezoneOptions()).toContain("America/Chicago");
  });

  it("validates IANA timezone identifiers", () => {
    expect(isValidTimezone("America/New_York")).toBe(true);
    expect(isValidTimezone("Not/A_Timezone")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
  });
});
