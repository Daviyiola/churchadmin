import { beforeEach, expect, it, vi } from "vitest";
import { database } from "./helpers/database";
const state = vi.hoisted(() => ({ db: null as ReturnType<typeof database> | null, user: vi.fn() }));
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: { from: (table: string) => state.db!.from(table), auth: { getUser: state.user } } }));
import { POST as changeRole } from "@/app/api/org/users/role/route";
import { POST as remove } from "@/app/api/org/users/remove/route";
import { POST as revokeInvite } from "@/app/api/invites/remove/route";
const request = (body = {}) => new Request("http://localhost/api/org/users", { method: "POST", headers: { Authorization: "Bearer token" }, body: JSON.stringify({ organization_id: "org", user_id: "target", role: "member", token: "invite-token", ...body }) });
const writes = () => state.db!.calls.filter(call => ["update", "delete"].includes(call.method));
function members(caller: string | null, target: string | null = "member") { state.db!.queue("user_organizations", { data: caller ? { role: caller } : null }, { data: target ? { role: target } : null }, {}); }
beforeEach(() => { state.db = database(); state.user.mockResolvedValue({ data: { user: { id: "actor" } }, error: null }); members("owner"); });
it.each([changeRole, remove])("prevents self-modification in %s", async action => {
  expect((await action(request({ user_id: "actor" }))).status).toBe(400); expect(writes()).toEqual([]);
});
it.each(["member", "finance", "viewer", null])("denies %s role and removal actions", async caller => {
  for (const action of [changeRole, remove]) {
    members(caller); expect((await action(request())).status).toBe(403); expect(writes()).toEqual([]);
  }
});
it.each([changeRole, remove])("does not modify a user outside this tenant in %s", async action => {
  members("owner", null); expect((await action(request())).status).toBe(404); expect(writes()).toEqual([]);
});
it.each(["admin", "owner"])("prevents admins from demoting or removing %s", async target => {
  for (const action of [changeRole, remove]) {
    members("admin", target); expect((await action(request())).status).toBe(403); expect(writes()).toEqual([]);
  }
});
it("prevents an admin from granting ownership", async () => {
  members("admin"); expect((await changeRole(request({ role: "owner" }))).status).toBe(403); expect(writes()).toEqual([]);
});
it("allows an owner to grant ownership to another member within this tenant", async () => {
  expect((await changeRole(request({ role: "owner" }))).status).toBe(200);
  expect(writes()[0]).toMatchObject({ method: "update", args: [{ role: "owner" }] });
  expect(state.db!.calls.slice(-2)).toEqual([
    { table: "user_organizations", method: "eq", args: ["organization_id", "org"] },
    { table: "user_organizations", method: "eq", args: ["user_id", "target"] },
  ]);
});
it.each(["owner", "admin"])("allows %s to remove a basic member with tenant scoping", async caller => {
  members(caller); expect((await remove(request())).status).toBe(200); expect(writes()[0].method).toBe("delete");
  expect(state.db!.calls.slice(-2)).toContainEqual({ table: "user_organizations", method: "eq", args: ["organization_id", "org"] });
});
it("rejects an unknown role before issuing an update", async () => {
  expect((await changeRole(request({ role: "superuser" }))).status).toBe(400); expect(writes()).toEqual([]);
});
it("revokes only an unused invitation in the specified tenant", async () => {
  state.db!.queue("invites", { data: [{ token: "invite-token" }] });
  expect((await revokeInvite(request())).status).toBe(200);
  expect(state.db!.calls).toContainEqual({ table: "invites", method: "eq", args: ["organization_id", "org"] });
  expect(state.db!.calls).toContainEqual({ table: "invites", method: "is", args: ["used_at", null] });
});
it("reports an already used or inaccessible invitation as unavailable", async () => {
  expect((await revokeInvite(request())).status).toBe(404);
});
