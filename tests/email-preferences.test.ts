import { describe, expect, it } from "vitest";
import { createEmailPreferenceToken, verifyEmailPreferenceToken } from "@/lib/server/email/tokens";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

process.env.EMAIL_PREFERENCE_HMAC_SECRET = "test-email-preference-secret-at-least-thirty-two-characters";

describe("email preference tokens", () => {
  it("binds the contact, purpose, topic, and version", () => {
    const token = createEmailPreferenceToken("contact-1", "one_click", "broadcast");
    expect(verifyEmailPreferenceToken(token, "one_click")).toMatchObject({ c: "contact-1", p: "one_click", t: "broadcast", v: 1 });
    expect(verifyEmailPreferenceToken(token, "manage")).toBeNull();
  });

  it("rejects tampering", () => {
    const token = createEmailPreferenceToken("contact-1", "manage");
    expect(verifyEmailPreferenceToken(`${token}x`)).toBeNull();
  });
});

describe("central email provider", () => {
  it("keeps direct Resend sending inside the provider module", () => {
    const root = resolve(process.cwd());
    const files = execFileSync("rg", ["-l", "new Resend|resend\\.emails\\.send", "app", "lib"], { cwd: root, encoding: "utf8" })
      .trim().split(/\r?\n/).filter(Boolean).map((file) => file.replaceAll("\\", "/"));
    expect(files).toEqual(["lib/server/email/sender.ts"]);
    expect(readFileSync(resolve(root, files[0]), "utf8")).toContain("sendManagedEmail");
  });
});
