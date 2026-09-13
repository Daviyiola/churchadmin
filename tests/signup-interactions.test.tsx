// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const state = vi.hoisted(() => ({ params: new URLSearchParams(), router: { replace: vi.fn() }, token: vi.fn(), context: vi.fn(), signIn: vi.fn(), session: vi.fn(), signUp: vi.fn(), resend: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => state.router, useSearchParams: () => state.params }));
vi.mock("@/components/BrandLogo", () => ({ default: () => <span>Logo</span> }));
vi.mock("@/lib/auth", () => ({ getAccessToken: state.token, applyOrgContext: state.context, signIn: state.signIn }));
vi.mock("@/lib/supabaseClient", () => ({ supabase: { auth: { getSession: state.session, signUp: state.signUp, resend: state.resend, onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }) } } }));
import GetStarted from "@/app/get-started/page";
import { ONBOARDING_DRAFT_KEY } from "@/lib/onboarding";
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); state.params = new URLSearchParams();
  state.session.mockResolvedValue({ data: { session: null }, error: null }); state.token.mockResolvedValue(null);
  state.signUp.mockResolvedValue({ data: { session: null }, error: null }); state.resend.mockResolvedValue({ error: null });
  state.context.mockResolvedValue({ ok: true }); state.signIn.mockResolvedValue({ ok: true });
  fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
});
afterEach(cleanup);
async function open() { render(<GetStarted />); await screen.findByLabelText("Organization name"); }
function fillAccount() {
  for (const [label, value] of [["Organization name", "Grace Church"], ["Email", "owner@example.invalid"], ["Create a password", "test-password"], ["Confirm password", "test-password"]]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
it("rejects mismatched passwords without creating an account", async () => {
  await open(); fillAccount(); fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "different" } });
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  await screen.findByText("Passwords do not match."); expect(state.signUp).not.toHaveBeenCalled();
});
it("requires email verification and never stores passwords in the draft", async () => {
  state.params = new URLSearchParams("plan=pro&interval=annual"); await open(); fillAccount();
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  await screen.findByRole("button", { name: "Resend verification email" });
  expect(state.signUp).toHaveBeenCalledWith(expect.objectContaining({ email: "owner@example.invalid", options: { emailRedirectTo: expect.stringContaining("plan=pro&interval=annual&verified=1") } }));
  const draft = localStorage.getItem(ONBOARDING_DRAFT_KEY)!;
  expect(draft).not.toContain("password"); expect(JSON.parse(draft)).toMatchObject({ plan: "pro", interval: "annual", org: "Grace Church" });
  expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe(""); expect(fetchMock).not.toHaveBeenCalled();
});
it("allows retrying a verification email after provider failure", async () => {
  await open(); fillAccount(); fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  const button = await screen.findByRole("button", { name: "Resend verification email" });
  state.resend.mockResolvedValueOnce({ error: new Error("Try again later") }); fireEvent.click(button);
  await screen.findByText("Try again later");
  expect((button as HTMLButtonElement).disabled).toBe(false); fireEvent.click(button);
  await screen.findByText("Verification email requested. Check your inbox and spam folder.");
});
it("creates a free workspace and applies its context before navigating", async () => {
  state.session.mockResolvedValue({ data: { session: { user: { email: "owner@example.invalid" } } } }); state.token.mockResolvedValue("token");
  fetchMock.mockResolvedValue(json({ organization_id: "new-org" })); await open();
  fireEvent.change(screen.getByLabelText("Organization name"), { target: { value: "Grace Church" } });
  fireEvent.click(screen.getByRole("button", { name: "Create free workspace" }));
  await waitFor(() => expect(state.router.replace).toHaveBeenCalledWith("/app/setup"));
  expect(state.context).toHaveBeenCalledWith("new-org"); expect(localStorage.getItem(ONBOARDING_DRAFT_KEY)).toBeNull();
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ plan: "free", organization_name: "Grace Church" });
});
it("retains the intent ID across a failed provisioning retry", async () => {
  state.session.mockResolvedValue({ data: { session: { user: { email: "owner@example.invalid" } } } }); state.token.mockResolvedValue("token");
  fetchMock.mockResolvedValueOnce(json({ error: "Please retry" }, 503)).mockResolvedValueOnce(json({ organization_id: "new-org" }));
  await open(); fireEvent.change(screen.getByLabelText("Organization name"), { target: { value: "Grace Church" } });
  fireEvent.click(screen.getByRole("button", { name: "Create free workspace" })); await screen.findByText("Please retry");
  fireEvent.click(screen.getByRole("button", { name: "Create free workspace" })); await waitFor(() => expect(state.router.replace).toHaveBeenCalled());
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).intent_id).toBe(JSON.parse(fetchMock.mock.calls[1][1].body).intent_id);
});
it("does not navigate when organization context cannot be applied", async () => {
  state.session.mockResolvedValue({ data: { session: { user: { email: "owner@example.invalid" } } } }); state.token.mockResolvedValue("token");
  state.context.mockResolvedValue({ ok: false, message: "Workspace temporarily unavailable" }); fetchMock.mockResolvedValue(json({ organization_id: "new-org" }));
  await open(); fireEvent.change(screen.getByLabelText("Organization name"), { target: { value: "Grace Church" } });
  fireEvent.click(screen.getByRole("button", { name: "Create free workspace" }));
  await screen.findByText("Workspace temporarily unavailable"); expect(state.router.replace).not.toHaveBeenCalled();
  expect(localStorage.getItem(ONBOARDING_DRAFT_KEY)).not.toBeNull();
});
it("restores canceled paid checkout details without creating a new checkout", async () => {
  localStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify({ org: "Saved Church", email: "owner@example.invalid", plan: "pro", interval: "annual", intent_id: "saved-intent" }));
  state.params = new URLSearchParams("checkout=canceled&plan=pro&interval=annual"); await open();
  expect((screen.getByLabelText("Organization name") as HTMLInputElement).value).toBe("Saved Church");
  expect(screen.getByText(/Checkout was canceled/)).toBeTruthy(); expect(fetchMock).not.toHaveBeenCalled();
});
it("finishes a paid workspace after confirmation without requesting another payment", async () => {
  state.params = new URLSearchParams("session_id=cs_paid"); state.token.mockResolvedValue("token");
  state.session.mockResolvedValue({ data: { session: { user: { email: "owner@example.invalid" } } } });
  fetchMock.mockResolvedValue(json({ status: "completed", provisioned_organization_id: "paid-org" })); render(<GetStarted />);
  await waitFor(() => expect(state.router.replace).toHaveBeenCalledWith("/app/setup"));
  expect(state.context).toHaveBeenCalledWith("paid-org");
  expect(fetchMock).toHaveBeenCalledTimes(1); expect(fetchMock.mock.calls[0][0]).toContain("/onboarding/status?session_id=cs_paid");
});
it("allows retrying failed payment-status checks", async () => {
  state.params = new URLSearchParams("session_id=cs_paid"); state.token.mockResolvedValue("token");
  state.session.mockResolvedValue({ data: { session: { user: { email: "owner@example.invalid" } } } });
  fetchMock.mockRejectedValueOnce(new Error("Connection interrupted")).mockResolvedValueOnce(json({ provisioned_organization_id: "paid-org" }));
  render(<GetStarted />); await screen.findByText("Connection interrupted"); fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  await waitFor(() => expect(state.router.replace).toHaveBeenCalledWith("/app/setup"));
});
