import { describe, expect, it } from "vitest";
import { createEmailPreferenceToken, verifyEmailPreferenceToken } from "@/lib/server/email/tokens";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

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
    const files = ["app", "lib"].flatMap(sourceFiles)
      .filter(file => /new Resend|resend\.emails\.send/.test(readFileSync(resolve(root, file), "utf8")))
      .map(file => file.replaceAll("\\", "/")).sort();
    expect(files).toEqual(["lib/server/email/sender.ts"]);
    expect(readFileSync(resolve(root, files[0]), "utf8")).toContain("sendManagedEmail");
  });
});
