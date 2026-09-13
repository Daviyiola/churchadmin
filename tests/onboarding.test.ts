import { describe, expect, it, vi, beforeEach } from "vitest";
import { hasMailingAddress, organizationName, setupSettings } from "@/lib/onboarding";

const completeAddress = { mailing_address_line1: "123 Main St", mailing_city: "Boston", mailing_state: "MA", mailing_postal_code: "02101", mailing_country: "US" };
describe("owner setup validation", () => {
  it("allows skipping an address without violating the non-null country column", () => {
    const settings = setupSettings({ timezone_name: "America/New_York" }, "org-1");
    expect(settings.mailing_country).toBe("");
    expect(settings.timezone_confirmed).toBe(true);
    expect(hasMailingAddress(settings)).toBe(false);
  });
  it("requires every essential address field, even if optional fields are filled", () => {
    expect(hasMailingAddress(completeAddress)).toBe(true);
    expect(hasMailingAddress({ ...completeAddress, mailing_address_line1: " ", mailing_address_line2: "Suite 5" })).toBe(false);
    expect(() => setupSettings({ ...completeAddress, mailing_city: "", timezone_name: "UTC" }, "org-1")).toThrow("Complete the mailing address");
  });
  it("rejects invalid timezones and logos from another tenant", () => {
    expect(() => setupSettings({ timezone_name: "Mars/Olympus" }, "org-1")).toThrow("timezone");
    expect(() => setupSettings({ timezone_name: "UTC", logo_path: "org/other/logo-123.png" }, "org-1")).toThrow("logo");
    expect(() => setupSettings({ timezone_name: "UTC", logo_path: "org/org-1/../logo-123.png" }, "org-1")).toThrow("logo");
    expect(setupSettings({ timezone_name: "UTC", logo_path: "org/org-1/logo-123.png" }, "org-1").use_default_logo).toBe(false);
  });
  it("trims names and rejects empty or oversized names", () => {
    expect(organizationName("  Grace Church  ")).toBe("Grace Church");
    for (const value of [" ", "A", "A".repeat(121), null]) expect(() => organizationName(value)).toThrow();
  });
});

const mocks = vi.hoisted(() => ({ actor: vi.fn(), from: vi.fn(), role: "owner" }));
vi.mock("@/lib/server/authUser", () => ({ requireActorId: mocks.actor }));
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: { from: mocks.from } }));
import { PATCH } from "@/app/api/org/setup/route";
describe("organization setup authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.actor.mockResolvedValue("user-1"); mocks.role = "owner";
    mocks.from.mockImplementation((table: string) => {
      const chain = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), update: vi.fn(), single: vi.fn(), upsert: vi.fn() };
      chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain); chain.update.mockReturnValue(chain);
      chain.maybeSingle.mockResolvedValue({ data: table === "user_organizations" ? { role: mocks.role } : null, error: null });
      chain.single.mockResolvedValue({ data: { id: "org-1" }, error: null });
      chain.upsert.mockResolvedValue({ error: null });
      return chain;
    });
  });
  const request = () => new Request("http://localhost/api/org/setup", { method: "PATCH", body: JSON.stringify({ organization_id: "org-1", name: "Grace Church", timezone_name: "UTC" }) });
  it("allows owners to save setup", async () => { expect((await PATCH(request())).status).toBe(200); });
  it("rejects members before any organization mutation", async () => {
    mocks.role = "member";
    expect((await PATCH(request())).status).toBe(403);
    expect(mocks.from.mock.calls.map(call => call[0])).toEqual(["user_organizations"]);
  });
  it("rejects unauthenticated requests", async () => {
    mocks.actor.mockRejectedValue(new Error("UNAUTHORIZED"));
    expect((await PATCH(request())).status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
