import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), user: vi.fn(), from: vi.fn(), rpc: vi.fn(), price: vi.fn(), create: vi.fn(), retrieve: vi.fn(), prior: null as Record<string, unknown> | null, inserts: [] as unknown[] }));
vi.mock("@/lib/server/authUser", () => ({ requireActorId: mocks.actor }));
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: { from: mocks.from, rpc: mocks.rpc, auth: { admin: { getUserById: mocks.user } } } }));
vi.mock("@/lib/server/billing/catalog", () => ({ getStripePrice: mocks.price }));
vi.mock("@/lib/server/billing/stripe", () => ({ stripeTaxEnabled: () => false, getStripe: () => ({ checkout: { sessions: { create: mocks.create, retrieve: mocks.retrieve } } }) }));
import { POST } from "@/app/api/billing/onboarding/route";
const intent = "11111111-1111-4111-8111-111111111111";
const request = (body: Record<string, unknown> = {}) => new Request("http://localhost/api/billing/onboarding", { method: "POST", body: JSON.stringify({ plan: "free", interval: "monthly", organization_name: "Grace Church", intent_id: intent, ...body }) });
describe("onboarding provisioning and checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.prior = null; mocks.inserts = [];
    mocks.actor.mockResolvedValue("owner-1");
    mocks.user.mockResolvedValue({ data: { user: { email: "owner@example.invalid", email_confirmed_at: "2026-01-01" } } });
    mocks.rpc.mockResolvedValue({ data: "org-1", error: null });
    mocks.price.mockResolvedValue("price_test");
    mocks.create.mockResolvedValue({ id: "cs_test", url: "https://checkout.stripe.com/test" });
    mocks.from.mockImplementation(() => {
      const chain = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), insert: vi.fn(), single: vi.fn(), update: vi.fn() };
      chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain); chain.update.mockReturnValue(chain);
      chain.maybeSingle.mockImplementation(async () => ({ data: mocks.prior, error: null }));
      chain.insert.mockImplementation(value => { mocks.inserts.push(value); return chain; });
      chain.single.mockResolvedValue({ data: { id: intent }, error: null });
      return chain;
    });
  });
  it("creates Free without calling Stripe", async () => {
    expect(await (await POST(request())).json()).toMatchObject({ organization_id: "org-1" });
    expect(mocks.price).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.inserts[0]).toMatchObject({ id: intent, plan_key: "free", billing_interval: "none" });
  });
  it("requires verified email before creating any intent", async () => {
    mocks.user.mockResolvedValue({ data: { user: { email_confirmed_at: null } } });
    expect((await POST(request())).status).toBe(409); expect(mocks.from).not.toHaveBeenCalled();
  });
  it("returns the existing workspace when retrying a completed intent", async () => {
    mocks.prior = { user_id: "owner-1", provisioned_organization_id: "org-1" };
    expect(await (await POST(request())).json()).toMatchObject({ organization_id: "org-1" });
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.inserts).toHaveLength(0);
  });
  it("does not expose another user's completed workspace", async () => {
    mocks.prior = { user_id: "someone-else", provisioned_organization_id: "private-org" };
    const response = await POST(request());
    expect(response.status).toBe(400); expect(await response.text()).not.toContain("private-org");
  });
  it("rejects invalid plan and paid interval values", async () => {
    expect((await POST(request({ plan: "nonsense" }))).status).toBe(400);
    expect((await POST(request({ plan: "pro", interval: "none" }))).status).toBe(400);
    expect(mocks.inserts).toHaveLength(0);
  });
  it("does not create a paid intent until Stripe pricing is configured", async () => {
    mocks.price.mockRejectedValue(new Error("Stripe pricing is not configured for this plan."));
    expect((await POST(request({ plan: "pro" }))).status).toBe(400);
    expect(mocks.inserts).toHaveLength(0); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("keeps plan and interval on checkout cancellation and uses an idempotency key", async () => {
    expect((await POST(request({ plan: "pro", interval: "annual" }))).status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ cancel_url: expect.stringContaining("plan=pro&interval=annual") }), { idempotencyKey: `onboarding-${intent}` });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
