import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { database } from "./helpers/database";
const state = vi.hoisted(() => ({ db: null as any, rpc: vi.fn() }));
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: { from: (...args: any[]) => state.db.from(...args), rpc: state.rpc } }));
import { getOrganizationEntitlements } from "@/lib/server/planEntitlements";
import { getPublicPlans, getStripePrice } from "@/lib/server/billing/catalog";
import { reconcileSubscription } from "@/lib/server/billing/reconcile";
import { getStripe, stripeTaxEnabled } from "@/lib/server/billing/stripe";
import { assertMonthlyQuota, assertBurstLimit, consumeMonthlyQuota, consumeBurst } from "@/lib/server/communicationsLimits";
const ent = { email_monthly_limit: 100, form_count_limit: 2, member_count_limit: 40, first_timer_count_limit: 40, management_seat_limit: 2, nikky_monthly_budget_cents: 50 };
beforeEach(() => { state.db = database(); state.rpc.mockReset(); state.rpc.mockResolvedValue({ data: "free", error: null }); });
describe("plan catalog and entitlements", () => {
  it("maps Free capacity from the effective plan", async () => { state.db.queue("plan_entitlements", { data: ent }); expect(await getOrganizationEntitlements("org")).toEqual({ plan: "free", emailMonthlyLimit: 100, formCountLimit: 2, memberCountLimit: 40, firstTimerCountLimit: 40, managementSeatLimit: 2, nikkyMonthlyBudgetCents: 50, nikkyBudgetSource: "plan" }); });
  it.each([null,0,500])("uses only a positive enterprise custom budget (%s)", async budget => { state.rpc.mockResolvedValue({ data: "enterprise", error: null }); state.db.queue("plan_entitlements", { data: { ...ent, member_count_limit: null } }); state.db.queue("organization_settings", { data: { nikky_monthly_budget_cents: budget } }); const result = await getOrganizationEntitlements("org"); expect(result.memberCountLimit).toBeNull(); expect(result.nikkyMonthlyBudgetCents).toBe(budget || null); expect(result.nikkyBudgetSource).toBe(budget ? "enterprise_custom" : "missing_enterprise_custom"); });
  it("fails closed when effective-plan lookup fails", async () => { state.rpc.mockResolvedValue({ error: { message: "offline" } }); await expect(getOrganizationEntitlements("org")).rejects.toThrow("offline"); });
  it("maps public plans and both relationship shapes", async () => { state.db.queue("billing_plan_catalog", { data: [{ plan_key: "free", display_name: "Free", plan_entitlements: ent }, { plan_key: "pro", display_name: "Pro", plan_entitlements: [ent] }] }); const result = await getPublicPlans(); expect(result.map(plan => plan.name)).toEqual(["Free","Pro"]); expect(result[1].managementSeatLimit).toBe(2); });
  it.each(["monthly", "annual"] as const)("requires configured %s pricing", async interval => { await expect(getStripePrice("pro", interval)).rejects.toThrow("not configured"); });
  it("returns a configured Stripe price", async () => { state.db.queue("billing_plan_catalog", { data: { stripe_annual_price_id: "price_year" } }); expect(await getStripePrice("pro", "annual")).toBe("price_year"); });
  it("does not initialize Stripe without a key", () => { vi.stubEnv("STRIPE_SECRET_KEY", ""); expect(() => getStripe()).toThrow("not configured"); vi.unstubAllEnvs(); });
  it.each(["true"," TRUE ","false",""])("parses tax setting %s", value => { vi.stubEnv("STRIPE_TAX_ENABLED", value); expect(stripeTaxEnabled()).toBe(value.trim().toLowerCase()==="true"); vi.unstubAllEnvs(); });
});
describe("email allowances", () => {
  it.each([[99,1,true],[100,1,false],[0,100,true],[0,101,false]])("monthly quota: used %s plus %s", async (used, increment, ok) => { state.db.queue("plan_entitlements", { data: ent }); state.db.queue("org_email_usage_month", { data: { used } }); expect((await assertMonthlyQuota("org", Number(increment))).ok).toBe(ok); });
  it.each([[29,1,true],[30,1,false],[0,31,false]])("burst quota: used %s plus %s", async (used, increment, ok) => { state.db.queue("org_burst_usage_minute", { data: { used } }); expect((await assertBurstLimit("org", Number(increment))).ok).toBe(ok); });
  it.each([consumeBurst,consumeMonthlyQuota])("propagates quota accounting failures", async consume => { state.rpc.mockResolvedValue({ error: { message: "write failed" } }); await expect(consume("org", 1)).rejects.toThrow("write failed"); });
});
function subscription(status = "active") { return { id: "sub-1", status, cancel_at_period_end: false, items: { data: [{ price: { id: "price-1", recurring: { interval: "year" } }, current_period_start: 1767225600, current_period_end: 1798761600 }] } } as unknown as Stripe.Subscription; }
describe("Stripe subscription reconciliation", () => {
  it.each([["active","active"],["trialing","active"],["past_due","past_due"],["canceled","canceled"],["unpaid","unpaid"],["incomplete_expired","canceled"],["paused","past_due"]])("maps %s to %s", async (status, expected) => { state.db.queue("billing_plan_catalog", { data: { plan_key: "pro" } }); state.db.queue("organization_subscriptions", { data: { organization_id: "org", plan_key: "basic" } }, {}); await reconcileSubscription(subscription(status)); const update = state.db.calls.find((c:any) => c.table === "organization_subscriptions" && c.method === "update"); expect(update.args[0]).toMatchObject({ status: expected, plan_key: "pro", billing_interval: "annual" }); });
  it("does not mutate an unknown subscription", async () => { await reconcileSubscription(subscription()); expect(state.db.calls.filter((c:any) => c.method === "update")).toEqual([]); });
  it("keeps founder Pro until the complimentary term ends", async () => { state.db.queue("billing_plan_catalog", { data: { plan_key: "basic" } }); state.db.queue("organization_subscriptions", { data: { organization_id: "org", status: "founder_complimentary", founder_ends_at: "2099-01-01", plan_key: "pro" } }, {}); await reconcileSubscription(subscription()); expect(state.db.calls.find((c:any) => c.method === "update").args[0]).toMatchObject({ status: "founder_complimentary", plan_key: "pro", scheduled_plan_key: "basic" }); });
  it("holds a scheduled downgrade until renewal", async () => { state.db.queue("billing_plan_catalog", { data: { plan_key: "basic" } }); state.db.queue("organization_subscriptions", { data: { organization_id: "org", scheduled_plan_key: "basic", current_period_end: "2099-01-01", plan_key: "pro" } }, {}); await reconcileSubscription(subscription()); expect(state.db.calls.find((c:any) => c.method === "update").args[0].plan_key).toBe("pro"); });
  it("propagates subscription write failures", async () => { state.db.queue("organization_subscriptions", { data: { organization_id: "org" } }, { error: { message: "write failed" } }); await expect(reconcileSubscription(subscription())).rejects.toThrow("write failed"); });
});
