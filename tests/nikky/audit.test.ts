import { createHmac } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { database } from "../helpers/database";
import type { NikkyContext } from "@/lib/server/nikky/types";
const state = vi.hoisted(() => ({ db: null as ReturnType<typeof database> | null }));
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: { from: (table: string) => state.db!.from(table) } }));
import { appendNikkyAudit } from "@/lib/server/nikky/audit";
const context = { organizationId: "org", userId: "user", role: "owner" } as NikkyContext;
beforeEach(() => { state.db = database(); vi.stubEnv("NIKKY_AUDIT_HMAC_SECRET", "audit-secret"); });
it("records tenant, actor, authorization, and provenance with safe defaults", async () => {
  await appendNikkyAudit(context, { authorizationOutcome: "denied", outcome: "blocked", errorCode: "forbidden" });
  expect(state.db!.calls.find(call => call.method === "insert")?.args[0]).toMatchObject({
    organization_id: "org", user_id: "user", role_snapshot: "owner", authorization_outcome: "denied",
    outcome: "blocked", error_code: "forbidden", requested_parameters: {}, applied_parameters: {},
    access_classifications: [], member_reference_hmac: null,
  });
});
it("stores a keyed member reference without storing the raw member identifier", async () => {
  await appendNikkyAudit(context, { authorizationOutcome: "allowed", outcome: "success", memberId: "private-member" });
  const row = state.db!.calls.find(call => call.method === "insert")?.args[0];
  expect(row.member_reference_hmac).toBe(createHmac("sha256", "audit-secret").update("private-member").digest("hex"));
  expect(JSON.stringify(row)).not.toContain("private-member");
});
it("surfaces a failed audit write", async () => {
  state.db!.queue("nikky_audit_logs", { error: { message: "audit unavailable" } });
  await expect(appendNikkyAudit(context, { authorizationOutcome: "allowed", outcome: "success" })).rejects.toThrow("audit unavailable");
});
