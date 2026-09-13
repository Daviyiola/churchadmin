import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ send: vi.fn(), eligibility: vi.fn() }));
vi.mock("resend", () => ({ Resend: class { emails = { send: mocks.send }; } }));
vi.mock("@/lib/server/email/repository", () => ({ normalizeEmail: (value: string) => value.trim().toLowerCase(), resolveEmailEligibility: mocks.eligibility }));
vi.mock("@/lib/server/email/tokens", () => ({ createEmailPreferenceToken: () => "test-token" }));
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: {} }));
import { sendManagedEmail } from "@/lib/server/email/sender";
describe("onboarding mailing-address promise", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.eligibility.mockResolvedValue({ eligible: true, contactId: "contact-1", mailingAddress: null }); });
  it("blocks church emails even when a caller omits the old address flag", async () => {
    const result = await sendManagedEmail({ kind: "optional", organizationId: "org-1", topic: "broadcast", from: "church@example.invalid", to: "member@example.invalid", subject: "Hello", html: "<p>Hello</p>" });
    expect(result).toMatchObject({ sent: false, skipped: true, reason: "missing_mailing_address" });
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("sends and includes the saved address when the organization is ready", async () => {
    mocks.eligibility.mockResolvedValue({ eligible: true, contactId: "contact-1", mailingAddress: "123 Main St · Boston, MA · 02101 · US" });
    mocks.send.mockResolvedValue({ data: { id: "message-1" }, error: null });
    expect(await sendManagedEmail({ kind: "optional", organizationId: "org-1", topic: "broadcast", from: "church@example.invalid", to: "member@example.invalid", subject: "Hello", html: "<p>Hello</p>" })).toMatchObject({ sent: true });
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ html: expect.stringContaining("123 Main St") }));
  });
});
