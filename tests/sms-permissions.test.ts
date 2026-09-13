import { beforeEach, describe, expect, it, vi } from "vitest";
import { database } from "./helpers/database";
import { currentSmsPermissions, parsePermissionInput, permissionKey, type SmsPermissionEvent } from "@/lib/sms/permissions";
const state = vi.hoisted(() => ({ db: null as any, auth: vi.fn() }));
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: { from: (...args: any[]) => state.db.from(...args) } }));
vi.mock("@/lib/server/sms/auth", () => ({ requireSmsOperator: state.auth, smsRouteError: (e: any) => ({ status: e.status ?? 400, message: e.message }) }));
import { GET, POST } from "@/app/api/communications/sms/permissions/route";
import { POST as previewAudience } from "@/app/api/communications/sms/audiences/preview/route";
import { resolveSmsAudience, getSmsReadiness, getSmsAudienceOptions } from "@/lib/server/sms/audienceResolver";
const org = "11111111-1111-4111-8111-111111111111";
const member = "22222222-2222-4222-8222-222222222222";
const phone = "+12125551234";
const event: SmsPermissionEvent = { id: "e1", phone_e164: phone, category: "informational", status: "granted", method: "verbal", disclosure: "Agreed to Example Church service schedule updates and explained how to opt out.", evidence_note: "", obtained_at: "2026-01-01T10:00:00Z", created_at: "2026-01-01T10:00:00Z", recorded_by: "actor" };
const person = { id: member, first_name: "David", last_name: "Example", phone, membership_stage: "member" };
const input = { phone, category: "informational", status: "granted", method: "verbal", disclosure: event.disclosure, confirmed: true, obtained_at: event.obtained_at };
beforeEach(() => { state.db = database(); state.auth.mockReset().mockResolvedValue({ userId: "actor", role: "owner" }); });
const request = (body: unknown) => new Request("https://example.test/api", { method: "POST", body: JSON.stringify(body) });

describe("permission evidence", () => {
  it("accepts individual verbal informational permission", () => { expect(parsePermissionInput(input)).toMatchObject({ phone_e164: phone, method: "verbal", category: "informational" }); });
  it.each([
    [{ confirmed: false }, "Confirm"], [{ obtained_at: "2099-01-01" }, "when"], [{ obtained_at: "invalid" }, "when"],
    [{ category: "everything" }, "category"], [{ category: "promotional" }, "written"],
    [{ method: "written", evidence_note: "" }, "evidence"], [{ phone: "123" }, "phone"],
    [{ disclosure: "yes" }, "Record"], [{ status: "granted", method: "staff_opt_out" }, "verbal"],
  ])("rejects invalid or incomplete evidence %j", (patch, message) => { expect(() => parsePermissionInput({ ...input, ...patch })).toThrow(message); });
  it("accepts written promotional permission with evidence location", () => {
    expect(parsePermissionInput({ ...input, category: "promotional", method: "written", evidence_note: "Signed card filed in the church office." }).category).toBe("promotional");
  });
  it("records opt-out at the server time regardless of a supplied date", () => {
    expect(parsePermissionInput({ ...input, status: "revoked", obtained_at: "2099-01-01" }, new Date("2026-02-01")).obtained_at).toBe("2026-02-01T00:00:00.000Z");
  });
  it("a historical grant never overwrites a newer opt-out", () => {
    const revoked = { ...event, id: "e2", status: "revoked" as const, obtained_at: "2026-02-01T00:00:00Z" };
    expect(currentSmsPermissions([revoked, { ...event, created_at: "2026-03-01T00:00:00Z" }]).get(permissionKey(phone, "informational"))?.status).toBe("revoked");
  });
  it("opt-out wins equal timestamps in either database order", () => {
    const revoked = { ...event, status: "revoked" as const };
    for (const rows of [[event, revoked], [revoked, event]]) expect(currentSmsPermissions(rows).get(permissionKey(phone, "informational"))?.status).toBe("revoked");
  });
  it("keeps categories independent", () => { expect(currentSmsPermissions([event]).has(permissionKey(phone, "promotional"))).toBe(false); });
});

describe("permission API boundaries", () => {
  it.each([401, 403])("denies unauthorized writes (%s)", async (status) => {
    state.auth.mockRejectedValue(Object.assign(new Error("Denied"), { status }));
    expect((await POST(request({ ...input, organization_id: org }))).status).toBe(status);
    expect(state.db.from).not.toHaveBeenCalled();
  });
  it("uses the authorized actor and tenant, never a supplied actor or timestamp", async () => {
    state.db.queue("sms_permission_events", { data: { id: "new" } });
    expect((await POST(request({ ...input, organization_id: org, org_id: "other", recorded_by: "spoof", created_at: "1900-01-01" }))).status).toBe(200);
    expect(state.auth).toHaveBeenCalledWith(expect.any(Request), org);
    const insert = state.db.calls.find((c: any) => c.method === "insert").args[0];
    expect(insert).toMatchObject({ org_id: org, recorded_by: "actor" }); expect(insert.created_at).toBeUndefined();
    expect(state.db.calls.some((c: any) => c.table === "sms_suppressions")).toBe(false);
  });
  it("scopes both history and block lookups to the authorized organization and phone", async () => {
    const response = await GET(new Request(`https://example.test/api?organization_id=${org}&phone=${encodeURIComponent(phone)}`));
    expect(response.status).toBe(200);
    for (const table of ["sms_permission_events", "sms_suppressions"]) {
      expect(state.db.calls).toContainEqual({ table, method: "eq", args: ["org_id", org] });
      expect(state.db.calls).toContainEqual({ table, method: "eq", args: ["phone_e164", phone] });
    }
  });
  it("returns a failure when evidence cannot be persisted", async () => {
    state.db.queue("sms_permission_events", { error: { message: "Database unavailable" } });
    expect((await POST(request({ ...input, organization_id: org }))).status).toBe(400);
  });
});

describe("audience permission enforcement", () => {
  function prepare(events: SmsPermissionEvent[] = [], blocked = false) {
    state.db.queue("members", { data: [person] });
    state.db.queue("sms_permission_events", { data: events });
    state.db.queue("sms_suppressions", { data: blocked ? [{ phone_e164: phone }] : [] });
  }
  it("excludes directory contacts without individual permission even with a blanket attestation", async () => {
    prepare(); state.db.queue("sms_consent_attestations", { data: { id: "attestation" } });
    const result = await resolveSmsAudience(org, { member_ids: [member] }, "Schedule update");
    expect(result.eligible_count).toBe(0); expect(result.no_consent_count).toBe(1);
  });
  it("includes verbal informational permission and snapshots its evidence ID", async () => {
    prepare([event]); const result = await resolveSmsAudience(org, { member_ids: [member] }, "Schedule update");
    expect(result.recipients[0]).toMatchObject({ consent_basis: "individual_consent", consent_reference_id: "e1" });
  });
  it("does not use informational permission for promotions", async () => {
    prepare([event]); expect((await resolveSmsAudience(org, { member_ids: [member], message_category: "promotional" }, "Fundraiser")).eligible_count).toBe(0);
  });
  it("does not allow a fresh grant to clear STOP", async () => {
    prepare([event], true); const result = await resolveSmsAudience(org, { member_ids: [member] }, "Schedule update");
    expect(result.eligible_count).toBe(0); expect(result.suppressed_count).toBe(1);
  });
  it("rechecks current revocation on each review", async () => {
    prepare([event, { ...event, id: "e2", status: "revoked", obtained_at: "2026-02-01T00:00:00Z" }]);
    expect((await resolveSmsAudience(org, { member_ids: [member] }, "Schedule update")).eligible_count).toBe(0);
  });
  it("fails closed on permission database errors", async () => {
    state.db.queue("sms_permission_events", { error: { message: "Cannot verify permission" } });
    await expect(resolveSmsAudience(org, { member_ids: [member] }, "Schedule update")).rejects.toThrow("Cannot verify");
  });
  it("counts usable numbers separately from consented numbers", async () => {
    prepare(); expect(await getSmsReadiness(org)).toMatchObject({ valid: 1, informational: 0, promotional: 0, no_permission: 1 });
  });
  it("returns useful exclusions for an empty audience without saving a sendable snapshot", async () => {
    prepare(); state.db.queue("sms_campaigns", { data: { id: "campaign", purpose: "reminder" } });
    const response = await previewAudience(request({ organization_id: org, campaign_id: "campaign", message: "Schedule update", criteria: { member_ids: [member] } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ snapshot_id: null, eligible_count: 0, no_consent_count: 1 });
    expect(state.db.calls.some((c: any) => c.method === "insert")).toBe(false);
  });
  it("forces promotional permission for a saved fundraising campaign despite informational criteria", async () => {
    prepare([event]); state.db.queue("sms_campaigns", { data: { id: "campaign", purpose: "fundraising" } });
    const response = await previewAudience(request({ organization_id: org, campaign_id: "campaign", message: "Fundraiser", criteria: { member_ids: [member], message_category: "informational" } }));
    expect(await response.json()).toMatchObject({ eligible_count: 0, criteria: { message_category: "promotional" } });
  });
  it("supports optional form fields without treating arbitrary answers as new grants", async () => {
    const form = "33333333-3333-4333-8333-333333333333", phoneKey = "44444444-4444-4444-8444-444444444444", consentKey = "55555555-5555-4555-8555-555555555555";
    state.db.queue("forms", { data: [{ id: form, title: "Welcome" }] });
    state.db.queue("form_fields", { data: [{ form_id: form, field_key: phoneKey, field_type: "phone" }, { form_id: form, field_key: consentKey, field_type: "multiple_choice", is_required: false }] });
    expect((await getSmsAudienceOptions(org)).forms).toHaveLength(1);
    state.db.queue("forms", { data: { id: form, title: "Welcome" } });
    state.db.queue("form_fields", { data: { field_key: phoneKey } }, { data: { field_key: consentKey, label: "Today's changed label" } });
    state.db.queue("form_submissions", { data: [{ id: "submission", answers: { [phoneKey]: phone, [consentKey]: ["Yes"] } }] });
    const result = await resolveSmsAudience(org, { form_sources: [{ form_id: form, phone_field_key: phoneKey, consent_field_key: consentKey, affirmative_values: ["Yes"], statuses: [] }] }, "Update");
    expect(result.eligible_count).toBe(0); expect(result.no_consent_count).toBe(1);
    expect(state.db.calls.some((c: any) => c.method === "insert")).toBe(false);
  });
});
