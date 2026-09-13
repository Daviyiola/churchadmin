// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const state = vi.hoisted(() => ({ token: vi.fn(), org: vi.fn(), upload: vi.fn(), unsaved: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAccessToken: state.token, getActiveOrgId: state.org }));
vi.mock("@/lib/unsaved", () => ({ setUnsaved: state.unsaved }));
vi.mock("@/lib/supabaseClient", () => ({ supabase: { storage: { from: () => ({ upload: state.upload, getPublicUrl: () => ({ data: { publicUrl: "/test-logo.png" } }) }) } } }));
// The test needs an ordinary image element, not Next's image optimizer.
vi.mock("next/image", () => ({ default: (props: any) => <span role="img" aria-label={props.alt} /> }));
import SetupPage from "@/app/app/setup/page";
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const initial = { organization: { name: "Grace Church" }, settings: { timezone_name: "UTC", use_default_logo: true } };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks(); state.token.mockResolvedValue("access-token"); state.org.mockReturnValue("org-1");
  state.upload.mockResolvedValue({ error: null });
  fetchMock = vi.fn().mockImplementation(async () => response(initial)); vi.stubGlobal("fetch", fetchMock);
  window.scrollTo = vi.fn(); HTMLElement.prototype.scrollIntoView = vi.fn();
  URL.createObjectURL = vi.fn(() => "blob:test-logo"); URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);
async function open() {
  render(<SetupPage />);
  await screen.findByLabelText("Organization name");
}
async function skipAndContinue() {
  fireEvent.click(screen.getByRole("checkbox"));
  fetchMock.mockResolvedValueOnce(response({ ok: true }));
  fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
  await screen.findByRole("heading", { name: "Your workspace is ready" });
}
it("loads settings using the current organization and access token", async () => {
  await open();
  expect((screen.getByLabelText("Organization name") as HTMLInputElement).value).toBe("Grace Church");
  expect(fetchMock).toHaveBeenCalledWith("/api/org/setup?organization_id=org-1", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer access-token" }) }));
});
it("lets an owner finish without a logo or mailing address and explains email restrictions", async () => {
  await open(); await skipAndContinue();
  const body = JSON.parse(fetchMock.mock.calls[1][1].body);
  expect(body).toMatchObject({ organization_id: "org-1", name: "Grace Church", timezone_name: "UTC", logo_path: null, mailing_address_line1: null });
  expect(screen.getByText(/Church emails are disabled until/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Skip invitation and open dashboard" }).getAttribute("href")).toBe("/app");
  expect(state.upload).not.toHaveBeenCalled();
});
it("saves an address and chosen timezone before showing readiness", async () => {
  await open();
  for (const [label, value] of [["Street address or PO box", "1 Main St"], ["City", "Town"], ["State / province / region", "NY"], ["Postal code", "10001"], ["Country", "US"]]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.change(screen.getByLabelText("Organization timezone"), { target: { value: "America/New_York" } });
  fetchMock.mockResolvedValueOnce(response({ ok: true }));
  fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
  await screen.findByText(/Mailing address saved/);
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ mailing_address_line1: "1 Main St", mailing_country: "US", timezone_name: "America/New_York" });
  expect(state.unsaved).toHaveBeenLastCalledWith(false);
});
it("offers a working retry after settings fail to load", async () => {
  fetchMock.mockResolvedValueOnce(response({ error: "Settings unavailable" }, 503));
  render(<SetupPage />);
  await screen.findByText("Settings unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByLabelText("Organization name");
  expect(screen.queryByRole("alert")).toBeNull();
});
it("preserves edits and enables retry after a failed save", async () => {
  await open(); fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.change(screen.getByLabelText("Organization name"), { target: { value: "New Church" } });
  fetchMock.mockRejectedValueOnce(new Error("Network unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
  await screen.findByText("Network unavailable");
  expect((screen.getByLabelText("Organization name") as HTMLInputElement).value).toBe("New Church");
  const button = screen.getByRole("button", { name: "Save and continue" }) as HTMLButtonElement;
  expect(button.disabled).toBe(false);
  fetchMock.mockResolvedValueOnce(response({ ok: true })); fireEvent.click(button);
  await screen.findByRole("heading", { name: "Your workspace is ready" });
});
it("reports expired sessions and provides a sign-in route", async () => {
  state.token.mockResolvedValue(null); render(<SetupPage />);
  await screen.findByText(/Your session expired/);
  expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/signin");
  expect(fetchMock).not.toHaveBeenCalled();
});
it.each([new File(["x"], "bad.txt", { type: "text/plain" }), new File([new Uint8Array(2000 * 1024 + 1)], "large.png", { type: "image/png" })])("rejects unsupported or oversized logos", async file => {
  await open(); fireEvent.change(screen.getByLabelText("Logo (optional)"), { target: { files: [file] } });
  expect(screen.getByRole("alert").textContent).toContain("Choose a PNG, JPG, or SVG");
  expect(state.upload).not.toHaveBeenCalled();
});
it("uploads a logo under this tenant before saving its path", async () => {
  await open(); fireEvent.change(screen.getByLabelText("Logo (optional)"), { target: { files: [new File(["png"], "logo.png", { type: "image/png" })] } });
  await skipAndContinue();
  expect(state.upload).toHaveBeenCalledWith(expect.stringMatching(/^org\/org-1\/logo-.*\.png$/), expect.any(File), expect.objectContaining({ contentType: "image/png" }));
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).logo_path).toBe(state.upload.mock.calls[0][0]);
});
it("lets owners remove a failed logo upload and complete setup", async () => {
  await open(); state.upload.mockResolvedValueOnce({ error: { message: "Storage unavailable" } });
  fireEvent.change(screen.getByLabelText("Logo (optional)"), { target: { files: [new File(["png"], "logo.png", { type: "image/png" })] } });
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
  await screen.findByText(/Logo upload failed/);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Use default logo" }));
  fetchMock.mockResolvedValueOnce(response({ ok: true })); fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
  await screen.findByRole("heading", { name: "Your workspace is ready" });
});
it("shows the fallback invitation link when email delivery fails", async () => {
  await open(); await skipAndContinue();
  fireEvent.change(screen.getByLabelText(/Team member.*email/), { target: { value: "team@example.invalid" } });
  fireEvent.change(screen.getByLabelText("Role"), { target: { value: "admin" } });
  fetchMock.mockResolvedValueOnce(response({ inviteUrl: "https://app.example.invalid/invite/test", emailed: false }));
  fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
  await screen.findByLabelText("Invitation link");
  expect(screen.getByRole("status").textContent).toContain("email could not be sent");
  expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toMatchObject({ role: "admin", invited_email: "team@example.invalid", organization_id: "org-1" });
  expect(screen.getByRole("link", { name: "Go to dashboard" })).toBeTruthy();
});
it("keeps the invitation optional after a capacity error", async () => {
  await open(); await skipAndContinue();
  fireEvent.change(screen.getByLabelText(/Team member.*email/), { target: { value: "team@example.invalid" } });
  fetchMock.mockResolvedValueOnce(response({ error: "Management-seat limit reached" }, 409));
  fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
  await screen.findByText("Management-seat limit reached");
  await waitFor(() => expect((screen.getByRole("button", { name: "Send invitation" }) as HTMLButtonElement).disabled).toBe(false));
  expect(screen.getByRole("link", { name: "Skip invitation and open dashboard" })).toBeTruthy();
});
