import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: { rpc: state.rpc } }));
vi.mock("@/lib/server/email", () => ({ resolveEmailEligibility: vi.fn() }));
import { parseAudienceCriteria } from "@/lib/server/communications/audienceResolver";
import { parseSmsAudience } from "@/lib/server/sms/audienceResolver";
import { enforceIntakeRateLimit, getRequestIp, isHoneypotFilled, IntakeRateLimitError } from "@/lib/server/intake/security";
const id = "11111111-1111-4111-8111-111111111111";
describe("email audience selection", () => {
  it("does not opt into all members by default", () => { expect(parseAudienceCriteria(null)).toMatchObject({ include_filtered_members: false, member_ids: [], form_sources: [], manual_text: "" }); });
  it("deduplicates IDs and strips invalid criteria", () => { expect(parseAudienceCriteria({ member_ids: [id,id,"bad"], genders: ["male","male","other"], include_filtered_members: "true" })).toMatchObject({ member_ids: [id], genders: ["male"], include_filtered_members: false }); });
  it("normalizes exclusions", () => { expect(parseAudienceCriteria({ excluded_emails: [" A@EXAMPLE.COM ","a@example.com","bad"] }).excluded_emails).toEqual(["a@example.com"]); });
  it("validates form IDs and defaults response statuses", () => { const result = parseAudienceCriteria({ form_sources: [{ form_id: id, field_key: id }, { form_id: "bad", field_key: id }] }); expect(result.form_sources).toEqual([{ form_id: id, field_key: id, statuses: ["new","reviewed"] }]); });
  it("caps form sources and rejects oversized manual input", () => { expect(parseAudienceCriteria({ form_sources: Array(15).fill({ form_id: id, field_key: id }) }).form_sources).toHaveLength(10); expect(() => parseAudienceCriteria({ manual_text: "x".repeat(20001) })).toThrow("too long"); });
});
describe("SMS audience consent selection", () => {
  it("does not coerce a string to affirmative audience inclusion", () => expect(parseSmsAudience({ include_filtered_people: "true" }).include_filtered_people).toBe(false));
  it("requires explicit affirmative values for form consent", () => { expect(parseSmsAudience({ form_sources: [{ form_id: id, phone_field_key: id, consent_field_key: id }] }).form_sources).toEqual([]); });
  it("retains valid consent mapping and discards invalid statuses", () => { const result = parseSmsAudience({ form_sources: [{ form_id: id, phone_field_key: id, consent_field_key: id, affirmative_values: [" Yes "], statuses: ["new","fake"] }] }); expect(result.form_sources[0]).toMatchObject({ affirmative_values: ["Yes"], statuses: ["new"] }); });
  it("deduplicates member/group filters", () => expect(parseSmsAudience({ member_ids: [id,id,"bad"], group_ids: [id] })).toMatchObject({ member_ids: [id], group_ids: [id] }));
});
describe("public intake abuse protection", () => {
  beforeEach(() => { state.rpc.mockReset(); state.rpc.mockResolvedValue({ error: null }); });
  it.each([[{},"unknown"],[{"x-forwarded-for":"1.2.3.4, 5.6.7.8"},"1.2.3.4"],[{"cf-connecting-ip":"9.8.7.6","x-real-ip":"1.2.3.4"},"9.8.7.6"]])("resolves trusted proxy IP precedence", (headers, ip) => expect(getRequestIp(new Request("http://localhost", { headers }))).toBe(ip));
  it("detects honeypot content without flagging blank input", () => { expect(isHoneypotFilled({ website: "spam" })).toBe(true); expect(isHoneypotFilled({ website: " " })).toBe(false); expect(isHoneypotFilled({})).toBe(false); });
  it("hashes IP before rate-limit persistence", async () => { await enforceIntakeRateLimit(new Request("http://localhost", { headers: { "x-real-ip": "1.2.3.4" } }), "lookup", 10, 60); const args = state.rpc.mock.calls[0][1]; expect(args).toMatchObject({ p_scope: "lookup", p_limit: 10, p_window_seconds: 60 }); expect(args.p_fingerprint).toMatch(/^[a-f0-9]{64}$/); expect(JSON.stringify(args)).not.toContain("1.2.3.4"); });
  it("maps exhausted limits to a retryable error", async () => { state.rpc.mockResolvedValue({ error: { message: "INTAKE_RATE_LIMITED" } }); await expect(enforceIntakeRateLimit(new Request("http://localhost"), "lookup", 10, 60)).rejects.toBeInstanceOf(IntakeRateLimitError); });
  it("does not silently ignore database failures", async () => { state.rpc.mockResolvedValue({ error: { message: "offline" } }); await expect(enforceIntakeRateLimit(new Request("http://localhost"), "lookup", 10, 60)).rejects.toThrow("offline"); });
});
