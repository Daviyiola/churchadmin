import { afterEach, describe, expect, it, vi } from "vitest";
import { getSmsProvider } from "@/lib/server/sms/provider";

describe("SMS provider fail-closed behavior", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("cannot load the mock provider in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => getSmsProvider()).toThrow("No production SMS provider is connected");
  });

  it("still refuses sending through the local mock", async () => {
    vi.stubEnv("NODE_ENV", "test");
    await expect(getSmsProvider().send({})).rejects.toThrow("SMS sending is disabled");
  });
});
