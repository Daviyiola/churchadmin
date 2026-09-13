import { beforeEach, expect, it, vi } from "vitest";
import { database } from "./helpers/database";
const state = vi.hoisted(() => ({ db: null as ReturnType<typeof database> | null, send: vi.fn(), download: vi.fn() }));
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: { from: (table: string) => state.db!.from(table), rpc: vi.fn().mockResolvedValue({ error: null }), storage: { from: () => ({ download: state.download }) } } }));
vi.mock("@/lib/serverAuthz", () => ({ requireUser: vi.fn().mockResolvedValue({ ok: true, userId: "user" }), requireOrgFinanceOrAbove: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/server/email", () => ({ sendManagedEmail: state.send }));
vi.mock("@/lib/server/communicationsLimits", () => ({ assertBurstLimit: vi.fn().mockResolvedValue({ ok: true }), assertMonthlyQuota: vi.fn().mockResolvedValue({ ok: true }), consumeBurst: vi.fn(), consumeMonthlyQuota: vi.fn() }));
import { POST as send } from "@/app/api/communications/send-one/route";
import { POST as create } from "@/app/api/communications/campaign/create/route";
const request = (body: object) => new Request("http://localhost/api/communications", { method: "POST", body: JSON.stringify({ organization_id: "org", ...body }) });
const file = { id: "file", bucket: "message-uploads", path: "org/file.png", filename: "flyer.png", content_type: "image/png", upload_mode: "attachment", inline_cid: null };
beforeEach(() => {
  state.db = database(); state.send.mockReset().mockResolvedValue({ sent: true, providerId: "message" });
  state.download.mockReset().mockResolvedValue({ data: new Blob(["image bytes"]), error: null });
  state.db.queue("communication_campaigns", { data: { id: "campaign", subject: "Hello", body_html: '<p>First<br>Second</p><p></p><img src="https://example.com/expired" data-upload-id="file">' } });
  state.db.queue("organizations", { data: { name: "Church" } });
  state.db.queue("message_uploads", { data: [file] });
});
it("passes a real image attachment's bytes and MIME type to the email sender", async () => {
  const response = await send(request({ campaign_id: "campaign", to_email: "test@example.invalid", mode: "test" }));
  expect(response.status).toBe(200);
  expect(state.send).toHaveBeenCalledWith(expect.objectContaining({ attachments: [{ filename: "flyer.png", content: Buffer.from("image bytes").toString("base64"), contentType: "image/png" }] }));
  expect(state.db!.calls).toContainEqual({ table: "message_uploads", method: "eq", args: ["org_id", "org"] });
});
it("sends CID images with matching inline attachment IDs and email-ready spacing", async () => {
  state.db!.queue("message_uploads", { data: [{ ...file, upload_mode: "inline", inline_cid: "flyer" }] });
  expect((await send(request({ campaign_id: "campaign", to_email: "test@example.invalid" }))).status).toBe(200);
  const payload = state.send.mock.calls[0][0];
  expect(payload.html).toContain('src="cid:flyer"'); expect(payload.html).not.toContain("example.com/expired");
  expect(payload.html).toContain("margin:0;line-height:1.5"); expect(payload.html).toContain("&nbsp;");
  expect(payload.attachments[0].contentId).toBe("flyer");
});
it("fails before sending if an attachment cannot be downloaded", async () => {
  state.download.mockResolvedValue({ data: null, error: { message: "File unavailable" } });
  expect((await send(request({ campaign_id: "campaign", to_email: "test@example.invalid" }))).status).toBe(400);
  expect(state.send).not.toHaveBeenCalled();
});
it("fails before sending instead of silently skipping malformed file metadata", async () => {
  state.db!.queue("message_uploads", { data: [{ ...file, path: null }] });
  expect((await send(request({ campaign_id: "campaign", to_email: "test@example.invalid" }))).status).toBe(400);
  expect(state.send).not.toHaveBeenCalled();
});
it("rejects selected uploads outside the organization before creating a campaign", async () => {
  state.db!.queue("organization_settings", { data: { mailing_address_line1: "1 Main", mailing_city: "City", mailing_state: "TN", mailing_postal_code: "12345", mailing_country: "US" } });
  state.db!.queue("message_uploads", { data: [] });
  const response = await create(request({ subject: "Test", body_html: "<p>Hello</p>", uploads: [{ upload_id: "other", upload_mode: "attachment" }], total_recipients: 1 }));
  expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ error: expect.stringContaining("attachment is unavailable") });
  expect(state.db!.calls.some(call => call.table === "communication_campaigns" && call.method === "insert")).toBe(false);
});
