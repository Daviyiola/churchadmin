import { beforeEach, describe, expect, it } from "vitest";
import { deviceTokenHash, nameHash, normalizeName, signCheckinCode, verifyCheckinCode } from "@/lib/server/attendance/checkin";

describe("attendance check-in signing", () => {
  beforeEach(() => { process.env.ATTENDANCE_CHECKIN_HMAC_SECRET = "test-secret-that-is-at-least-thirty-two-characters"; });

  it("round-trips a code and rejects tampering", () => {
    const token = signCheckinCode("11111111-1111-4111-8111-111111111111", 3);
    expect(verifyCheckinCode(token)).toEqual({ c: "11111111-1111-4111-8111-111111111111", v: 3 });
    expect(verifyCheckinCode(`${token}x`)).toBeNull();
  });

  it("normalizes names deterministically without exposing them in hashes", () => {
    expect(normalizeName("  David   Iyiola ")).toBe("david iyiola");
    expect(nameHash("David", "Iyiola")).toMatch(/^[a-f0-9]{64}$/);
    expect(nameHash("David", "Iyiola")).not.toContain("david");
  });

  it("domain-separates device hashes", () => {
    expect(deviceTokenHash("opaque-device-token")).not.toBe(nameHash("opaque-device", "token"));
  });
});
