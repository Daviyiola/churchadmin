import { afterEach, describe, expect, it, vi } from "vitest";
import { TurnstileVerificationError, verifyPublicFormTurnstile } from "@/lib/server/forms/turnstile";

const requestId = "7c43773c-d76a-4a47-a816-f4d0888b7f66";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("public form Turnstile verification", () => {
  it("rejects a missing token without contacting Cloudflare", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(verifyPublicFormTurnstile(new Request("https://churchadmins.com/api/forms/public/demo"), "", requestId))
      .rejects.toBeInstanceOf(TurnstileVerificationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the token, request id, and client address to Siteverify", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await verifyPublicFormTurnstile(new Request("https://churchadmins.com/api/forms/public/demo", {
      headers: { "x-forwarded-for": "203.0.113.9" },
    }), "verified-token", requestId);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = options.body as URLSearchParams;
    expect(body.get("response")).toBe("verified-token");
    expect(body.get("remoteip")).toBe("203.0.113.9");
    expect(body.get("idempotency_key")).toBe(requestId);
  });

  it("rejects a failed Cloudflare verification", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: false,
      "error-codes": ["invalid-input-response"],
    }), { status: 200 })));
    await expect(verifyPublicFormTurnstile(
      new Request("https://churchadmins.com/api/forms/public/demo"),
      "bad-token",
      requestId,
    )).rejects.toMatchObject({ status: 400 });
  });
});
