import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { database } from "./helpers/database";
const state = vi.hoisted(() => ({ db: null as ReturnType<typeof database> | null, verify: vi.fn(), retrieve: vi.fn(), reconcile: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: { from: (table: string) => state.db!.from(table), rpc: state.rpc } }));
vi.mock("@/lib/server/billing/stripe", () => ({ getStripe: () => ({ webhooks: { constructEvent: state.verify }, subscriptions: { retrieve: state.retrieve } }) }));
vi.mock("@/lib/server/billing/reconcile", () => ({ reconcileSubscription: state.reconcile }));
import { POST } from "@/app/api/billing/webhook/route";
const subscription = { id: "sub_test", items: { data: [{ price: { id: "price_test" }, current_period_start: 1788652800, current_period_end: 1791244800 }] } };
const event = { id: "evt_test", type: "checkout.session.completed", data: { object: { metadata: { onboarding_intent_id: "intent" }, subscription: "sub_test", customer: "cus_test" } } };
const request = () => new Request("http://localhost/api/billing/webhook", { method: "POST", headers: { "stripe-signature": "signature" }, body: "raw-event-body" });
const updates = () => state.db!.calls.filter(call => call.table === "stripe_webhook_events" && call.method === "update").map(call => call.args[0]);
beforeEach(() => {
  vi.clearAllMocks(); state.db = database(); vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_unit_test");
  state.verify.mockReturnValue(event); state.retrieve.mockResolvedValue(subscription);
  state.rpc.mockResolvedValue({ data: "org", error: null }); state.reconcile.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());
it("verifies the original request body before reading or writing billing data", async () => {
  state.verify.mockImplementation(() => { throw new Error("bad signature"); });
  expect((await POST(request())).status).toBe(400);
  expect(state.verify).toHaveBeenCalledWith("raw-event-body", "signature", "whsec_unit_test");
  expect(state.db!.from).not.toHaveBeenCalled(); expect(state.rpc).not.toHaveBeenCalled();
});
it("provisions and reconciles a completed checkout before acknowledging it", async () => {
  expect((await POST(request())).status).toBe(200);
  expect(state.rpc).toHaveBeenCalledWith("provision_owner_organization", expect.objectContaining({ p_intent_id: "intent", p_stripe_customer_id: "cus_test", p_stripe_subscription_id: "sub_test", p_stripe_price_id: "price_test" }));
  expect(state.reconcile).toHaveBeenCalledWith(subscription);
  expect(updates()).toContainEqual(expect.objectContaining({ status: "processed" }));
});
it("acknowledges an already processed event without provisioning twice", async () => {
  state.db!.queue("stripe_webhook_events", { data: { status: "processed" } });
  expect(await (await POST(request())).json()).toEqual({ received: true, duplicate: true });
  expect(state.rpc).not.toHaveBeenCalled(); expect(state.retrieve).not.toHaveBeenCalled(); expect(updates()).toEqual([]);
});
it("rejects simultaneous processing so Stripe can retry", async () => {
  state.db!.queue("stripe_webhook_events", { data: { status: "processing" } });
  expect((await POST(request())).status).toBe(409); expect(state.rpc).not.toHaveBeenCalled();
});
it("retries a failed event and increments its attempt count", async () => {
  state.db!.queue("stripe_webhook_events", { data: { status: "failed", attempts: 2 } }, {}, {});
  expect((await POST(request())).status).toBe(200);
  expect(updates()[0]).toEqual({ status: "processing", attempts: 3, last_error: null });
  expect(state.db!.calls).toContainEqual({ table: "stripe_webhook_events", method: "eq", args: ["status", "failed"] });
});
it.each(["lookup", "claim"])("does not process an event when its %s fails", async stage => {
  state.db!.queue("stripe_webhook_events", ...(stage === "lookup" ? [{ error: { message: "unavailable" } }] : [{}, { error: { message: "duplicate claim" } }]));
  expect((await POST(request())).status).toBe(500); expect(state.rpc).not.toHaveBeenCalled();
});
it("marks failed provisioning for retry without exposing database details", async () => {
  state.rpc.mockResolvedValue({ error: { message: "private database error" } });
  const response = await POST(request()); expect(response.status).toBe(500);
  expect(await response.text()).not.toContain("private database error");
  expect(updates()).toContainEqual({ status: "failed", last_error: "private database error" });
  expect(state.reconcile).not.toHaveBeenCalled();
});
it.each(["customer.subscription.updated", "customer.subscription.deleted"])("reconciles %s", async type => {
  state.verify.mockReturnValue({ id: "evt_sub", type, data: { object: subscription } });
  expect((await POST(request())).status).toBe(200); expect(state.reconcile).toHaveBeenCalledWith(subscription);
  expect(state.rpc).not.toHaveBeenCalled();
});
it.each(["invoice.paid", "invoice.payment_failed"])("refreshes subscription state for %s", async type => {
  state.verify.mockReturnValue({ id: "evt_invoice", type, data: { object: { parent: { subscription_details: { subscription: "sub_test" } } } } });
  expect((await POST(request())).status).toBe(200); expect(state.retrieve).toHaveBeenCalledWith("sub_test");
  expect(state.reconcile).toHaveBeenCalledWith(subscription);
});
it("does not acknowledge success when the processed-state write fails", async () => {
  state.db!.queue("stripe_webhook_events", {}, {}, { error: { message: "Completion write failed" } }, {});
  expect((await POST(request())).status).toBe(500);
  expect(updates()).toContainEqual({ status: "failed", last_error: "Completion write failed" });
});
it("does not silently lose the checkout audit event", async () => {
  state.db!.queue("billing_plan_events", { error: { message: "Audit write failed" } });
  expect((await POST(request())).status).toBe(500);
  expect(updates()).toContainEqual({ status: "failed", last_error: "Audit write failed" });
});
