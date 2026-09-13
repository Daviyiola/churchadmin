import { beforeEach, expect, it, vi } from "vitest";
import { database } from "./helpers/database";
const state = vi.hoisted(() => ({ db: null as ReturnType<typeof database> | null, actor: vi.fn() }));
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: { from: (table: string) => state.db!.from(table) } }));
vi.mock("@/lib/server/authUser", () => ({ requireActorId: state.actor }));
import { GET, PATCH } from "@/app/api/org/setup/route";
import { GET as status } from "@/app/api/billing/onboarding/status/route";
const request = (body: Record<string, unknown> = {}) => new Request("http://localhost/api/org/setup?organization_id=org-1", {
  method: "PATCH", body: JSON.stringify({ organization_id: "org-1", name: " Grace Church ", ...body }),
});
const writes = () => state.db!.calls.filter(call => ["update", "upsert", "insert", "delete"].includes(call.method));
beforeEach(() => {
  state.db = database(); state.actor.mockReset().mockResolvedValue("actor");
  state.db.queue("user_organizations", { data: { role: "owner" } });
});
it.each(["owner", "admin"])("allows %s to load organization setup scoped to actor and tenant", async role => {
  state.db!.queue("user_organizations", { data: { role } });
  state.db!.queue("organizations", { data: { name: "Grace Church" } });
  state.db!.queue("organization_settings", { data: { timezone_name: "UTC" } });
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ organization: { name: "Grace Church" }, settings: { timezone_name: "UTC" } });
  expect(state.db!.calls).toContainEqual({ table: "user_organizations", method: "eq", args: ["user_id", "actor"] });
  expect(state.db!.calls).toContainEqual({ table: "user_organizations", method: "eq", args: ["organization_id", "org-1"] });
  expect(writes()).toEqual([]);
});
it.each(["member", "finance", "viewer", null])("rejects setup read/write for %s", async role => {
  for (const handler of [GET, PATCH]) {
    state.db!.reset(); state.db!.queue("user_organizations", { data: role ? { role } : null });
    expect((await handler(request())).status).toBe(403);
    expect(state.db!.from).not.toHaveBeenCalledWith("organizations");
    expect(writes()).toEqual([]);
  }
});
it("rejects an expired session before reading any organization", async () => {
  state.actor.mockRejectedValue(new Error("UNAUTHORIZED"));
  expect((await PATCH(request())).status).toBe(401);
  expect(state.db!.from).not.toHaveBeenCalled();
});
it("supports name-only changes without overwriting address or branding", async () => {
  expect((await PATCH(request())).status).toBe(200);
  expect(writes()).toEqual([{ table: "organizations", method: "update", args: [{ name: "Grace Church" }] }]);
});
it("saves timezone and explicitly skipped address with the default logo", async () => {
  expect((await PATCH(request({ timezone_name: "America/New_York" }))).status).toBe(200);
  expect(writes()[1].args[0]).toMatchObject({ organization_id: "org-1", timezone_confirmed: true, timezone_name: "America/New_York", mailing_address_line1: null, logo_path: null, use_default_logo: true });
});
it("saves a complete normalized address and tenant-owned logo", async () => {
  expect((await PATCH(request({ timezone_name: "UTC", mailing_address_line1: " 1 Main St ", mailing_city: "Town", mailing_state: "NY", mailing_postal_code: "10001", mailing_country: "US", logo_path: "org/org-1/logo-abc.png" }))).status).toBe(200);
  expect(writes()[1].args[0]).toMatchObject({ mailing_address_line1: "1 Main St", logo_path: "org/org-1/logo-abc.png", use_default_logo: false });
});
it.each([
  { name: "x" }, { timezone_name: "invalid/timezone" },
  { timezone_name: "UTC", mailing_city: "Only city" },
  { timezone_name: "UTC", logo_path: "org/another-org/logo-abc.png" },
  { timezone_name: "UTC", logo_path: "org/org-1/../logo-abc.png" },
])("validates all setup fields before writing: %j", async invalid => {
  expect((await PATCH(request(invalid))).status).toBe(400);
  expect(writes()).toEqual([]);
});
it("reports persistence failures and permits a subsequent retry", async () => {
  state.db!.queue("organization_settings", { error: { message: "Write failed" } });
  expect((await PATCH(request({ timezone_name: "UTC" }))).status).toBe(400);
  state.db!.queue("user_organizations", { data: { role: "owner" } });
  expect((await PATCH(request({ timezone_name: "UTC" }))).status).toBe(200);
});
it.each(["pending", "completed"])("returns %s checkout status scoped to the signed-in owner", async value => {
  state.db!.queue("owner_onboarding_intents", { data: { status: value, provisioned_organization_id: value === "completed" ? "org-1" : null } });
  const response = await status(new Request("http://localhost?session_id=cs_test"));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: value });
  expect(state.db!.calls).toContainEqual({ table: "owner_onboarding_intents", method: "eq", args: ["user_id", "actor"] });
  expect(state.db!.calls).toContainEqual({ table: "owner_onboarding_intents", method: "eq", args: ["stripe_checkout_session_id", "cs_test"] });
});
it("does not reveal an unknown or another owner's checkout", async () => {
  expect((await status(new Request("http://localhost?session_id=cs_private"))).status).toBe(404);
});
it("rejects a missing checkout session without querying intents", async () => {
  expect((await status(new Request("http://localhost"))).status).toBe(400);
  expect(state.db!.from).not.toHaveBeenCalled();
});
