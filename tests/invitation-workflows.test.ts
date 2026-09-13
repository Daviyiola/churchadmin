import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { database } from "./helpers/database";
const state = vi.hoisted(() => ({ db: null as ReturnType<typeof database> | null, user: vi.fn(), send: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: { from: (table: string) => state.db!.from(table), rpc: state.rpc, auth: { getUser: state.user } } }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { getUser: state.user } }) }));
vi.mock("@/lib/server/email", () => ({ sendManagedEmail: state.send }));
import { POST as create } from "@/app/api/invites/create/route";
import { POST as accept } from "@/app/api/invites/accept/route";
const request = (body: Record<string, unknown>) => new Request("http://localhost/api/invites", { method: "POST", headers: { Authorization: "Bearer token" }, body: JSON.stringify(body) });
const creation = (overrides = {}) => request({ organization_id: "org", invited_email: " Person@Example.Invalid ", role: "member", ...overrides });
const invitation = { id: "i", token: "invite-token", invited_email: "person@example.invalid", expires_at: "2026-09-13T00:00:00.000Z" };
beforeEach(() => {
  state.db = database(); vi.clearAllMocks();
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-06T00:00:00Z"));
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.invalid"); vi.stubEnv("RESEND_FROM", "mail@example.invalid");
  state.user.mockResolvedValue({ data: { user: { id: "actor", email: "Person@example.invalid", email_confirmed_at: "2026-01-01" } }, error: null });
  state.rpc.mockResolvedValue({ data: "org", error: null }); state.send.mockResolvedValue({ sent: true });
  state.db.queue("user_organizations", { data: { role: "owner" } });
  state.db.queue("organizations", { data: { name: "Grace <Church>" } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
describe("creating and resending invitations", () => {
  it.each(["member", "finance", "admin"])("creates a %s invitation with normalized email and seven-day expiry", async role => {
    const response = await create(creation({ role }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ emailed: true, reused: false });
    expect(state.db!.calls.find(call => call.method === "insert")?.args[0]).toMatchObject({ organization_id: "org", invited_email: "person@example.invalid", role, expires_at: invitation.expires_at });
    expect(state.send).toHaveBeenCalledWith(expect.objectContaining({ kind: "essential", to: "person@example.invalid", html: expect.stringContaining("Grace &lt;Church&gt;") }));
  });
  it.each(["member", "finance", null])("prevents %s from inviting users", async role => {
    state.db!.queue("user_organizations", { data: role ? { role } : null });
    expect((await create(creation())).status).toBe(403);
    expect(state.send).not.toHaveBeenCalled();
    expect(state.db!.from).not.toHaveBeenCalledWith("invites");
  });
  it.each([{ role: "owner" }, { role: "unknown" }, { invited_email: "bad-address" }])("rejects invalid invitation %j", async body => {
    expect((await create(creation(body))).status).toBe(400);
    expect(state.db!.from).not.toHaveBeenCalledWith("invites");
    expect(state.send).not.toHaveBeenCalled();
  });
  it("reuses an unexpired invitation without extending its expiry", async () => {
    state.db!.queue("invites", { data: invitation }, {});
    expect(await (await create(creation())).json()).toMatchObject({ reused: true, refreshed: false, inviteUrl: "https://app.example.invalid/invite/invite-token" });
    const update = state.db!.calls.find(call => call.method === "update")?.args[0];
    expect(update).toEqual({ token: "invite-token", role: "member" });
  });
  it("rotates expired tokens and renews expiry", async () => {
    state.db!.queue("invites", { data: { ...invitation, expires_at: "2026-09-01" } }, {});
    expect(await (await create(creation())).json()).toMatchObject({ reused: false, refreshed: true });
    const update = state.db!.calls.find(call => call.method === "update")?.args[0];
    expect(update.token).not.toBe(invitation.token); expect(update.expires_at).toBe(invitation.expires_at);
  });
  it.each([{ code: "23505", message: "duplicate" }, { message: "PLAN_CAPACITY_REACHED" }])("returns a recoverable conflict for %j", async error => {
    state.db!.queue("invites", {}, { error });
    expect((await create(creation())).status).toBe(409); expect(state.send).not.toHaveBeenCalled();
  });
  it("returns a usable invitation link when delivery fails", async () => {
    state.send.mockRejectedValue(new Error("Provider unavailable"));
    const response = await create(creation());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ emailed: false, inviteUrl: expect.stringContaining("https://app.example.invalid/invite/") });
  });
});
describe("accepting invitations", () => {
  it("accepts the verified recipient through the atomic database operation", async () => {
    state.db!.queue("invites", { data: invitation });
    expect(await (await accept(request({ token: invitation.token }))).json()).toEqual({ ok: true, organization_id: "org" });
    expect(state.rpc).toHaveBeenCalledWith("accept_organization_invite", { p_token: invitation.token, p_user_id: "actor" });
  });
  it("blocks unverified recipients before reading invitations", async () => {
    state.user.mockResolvedValue({ data: { user: { id: "actor", email_confirmed_at: null } } });
    expect((await accept(request({ token: invitation.token }))).status).toBe(409);
    expect(state.db!.from).not.toHaveBeenCalled(); expect(state.rpc).not.toHaveBeenCalled();
  });
  it.each([
    [null, 400], [{ ...invitation, expires_at: "2026-09-01" }, 400],
    [{ ...invitation, invited_email: "someone-else@example.invalid" }, 403],
  ])("rejects unavailable, expired, or mismatched invitation %j", async (data, code) => {
    state.db!.queue("invites", { data });
    expect((await accept(request({ token: invitation.token }))).status).toBe(code);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("returns the seat-limit conflict without reporting acceptance", async () => {
    state.db!.queue("invites", { data: invitation });
    state.rpc.mockResolvedValue({ error: { message: "PLAN_CAPACITY_REACHED" } });
    expect((await accept(request({ token: invitation.token }))).status).toBe(409);
  });
});
