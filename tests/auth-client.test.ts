// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { database } from "./helpers/database";
const mocks = vi.hoisted(() => ({ db: null as any, auth: { signInWithPassword: vi.fn(), getSession: vi.fn(), signOut: vi.fn() } }));
vi.mock("@/lib/supabaseClient", () => ({ supabase: { from: (...args: any[]) => mocks.db.from(...args), auth: mocks.auth } }));
import { applyOrgContext, signIn, signInWithOrg, signOut, getAccessToken, getActiveOrgId, getActiveOrgRole, getUserId } from "@/lib/auth";
beforeEach(() => { localStorage.clear(); mocks.db = database(); mocks.auth.getSession.mockResolvedValue({ data: { session: { user: { id: "user-1" }, access_token: "token" } } }); mocks.auth.signInWithPassword.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }); mocks.auth.signOut.mockResolvedValue({ error: null }); vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ options: [] }) })); });
describe("client account and tenant selection", () => {
  it("signs in and returns the authenticated user", async () => expect(await signIn("owner@example.invalid", "password")).toMatchObject({ ok: true, user: { id: "user-1" } }));
  it("returns login errors", async () => { mocks.auth.signInWithPassword.mockResolvedValue({ data: {}, error: { message: "Wrong password" } }); expect(await signIn("a", "b")).toEqual({ ok: false, message: "Wrong password" }); });
  it("stores only an authorized tenant and role", async () => { mocks.db.queue("user_organizations", { data: { role: "owner" } }); expect(await applyOrgContext("org-1")).toEqual({ ok: true }); expect(getActiveOrgId()).toBe("org-1"); expect(getActiveOrgRole()).toBe("owner"); });
  it("clears stale tenant context and signs out on denied membership", async () => { localStorage.setItem("active_org_id", "stale"); expect((await applyOrgContext("org-2")).ok).toBe(false); expect(getActiveOrgId()).toBeNull(); expect(mocks.auth.signOut).toHaveBeenCalled(); });
  it("rejects selection without a session", async () => { mocks.auth.getSession.mockResolvedValue({ data: { session: null } }); expect(await applyOrgContext("org-1")).toEqual({ ok: false, message: "Not signed in." }); expect(await getAccessToken()).toBeNull(); expect(await getUserId()).toBeNull(); });
  it("does not let assistant-context network failures break tenant selection", async () => { mocks.db.queue("user_organizations", { data: { role: "admin" } }); vi.mocked(fetch).mockRejectedValue(new Error("offline")); expect((await applyOrgContext("org-1")).ok).toBe(true); });
  it("rejects sign-in to an organization without membership", async () => { expect((await signInWithOrg("a", "b", "org-1")).ok).toBe(false); expect(mocks.auth.signOut).toHaveBeenCalled(); });
  it("cleans tenant context on sign-out", async () => { localStorage.setItem("active_org_id", "org-1"); localStorage.setItem("active_org_role", "owner"); await signOut(); expect(getActiveOrgId()).toBeNull(); expect(getActiveOrgRole()).toBeNull(); });
  it("exposes current session ID and token", async () => { expect(await getUserId()).toBe("user-1"); expect(await getAccessToken()).toBe("token"); });
});
