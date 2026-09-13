// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import RecurrenceEditor from "@/components/attendance/RecurrenceEditor";
import AttendanceQrManager from "@/components/attendance/AttendanceQrManager";
const state = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("@/lib/supabaseClient", () => ({ supabase: { auth: { getSession: state.session } } }));
vi.mock("@/components/QrCodeBox", () => ({ default: () => <div>QR preview</div> }));
vi.mock("@/components/ServiceCombobox", () => ({ default: () => <div>Service selector</div> }));
const service = "33333333-3333-4333-8333-333333333333";
const services = [{ id: service, name: "Sunday service" }];
const code = { id: "code", name: "Lobby", default_service_category_id: service, status: "active", expires_on: null, public_url: "https://example.invalid/check-in/test", attendance_checkin_windows: [] };
const schedule = { code_id: "code", service_category_id: service, starts_on: "2030-01-01", ends_on: null, every_weeks: 1, weekdays: [0], service_time: "10:00", opens_before_minutes: 30, closes_after_minutes: 90, timezone_name: "UTC", paused: false, last_error: null, upcoming: [{ date: "2030-01-06", service_at: "2030-01-06T10:00:00Z", opens_at: "2030-01-06T09:30:00Z", closes_at: "2030-01-06T11:30:00Z", skipped: false }] };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  state.session.mockResolvedValue({ data: { session: { access_token: "token" } } });
  fetchMock = vi.fn().mockImplementation(async () => json({ codes: [code], timezone: { timezone_name: "UTC", timezone_confirmed: true } }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(cleanup);
it("previews and saves an every-two-week schedule", async () => {
  const save = vi.fn().mockResolvedValue(undefined), close = vi.fn();
  render(<RecurrenceEditor name="Lobby" schedule={schedule} defaultService={service} timezone="UTC" services={services} expiresOn={null} onSave={save} onClose={close} />);
  fireEvent.change(screen.getByLabelText("Repeat every"), { target: { value: "2" } });
  expect(screen.getByRole("dialog").className).toContain("overflow-y-auto");
  fireEvent.click(screen.getByRole("button", { name: "Save recurring schedule" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ every_weeks: 2, weekdays: [0], service_time: "10:00" })));
  expect(close).toHaveBeenCalled();
});
it("keeps the editor and values available after a failed schedule save", async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error("Network interrupted")).mockResolvedValueOnce(undefined);
  render(<RecurrenceEditor name="Lobby" schedule={schedule} defaultService={service} timezone="UTC" services={services} expiresOn={null} onSave={save} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Save recurring schedule" })); await screen.findByText("Network interrupted");
  expect((screen.getByRole("button", { name: "Save recurring schedule" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Save recurring schedule" })); await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
});
it("allows recurrence setup even when there are no attendance drafts", async () => {
  render(<AttendanceQrManager orgId="org" drafts={[]} services={services} initialDraftId={null} />);
  fireEvent.click(screen.getByRole("button", { name: "QR Check-in" }));
  const repeat = await screen.findByRole("button", { name: "Repeat automatically" });
  expect((repeat as HTMLButtonElement).disabled).toBe(false); fireEvent.click(repeat);
  expect(screen.getByRole("dialog").textContent).toContain("create one 15 minutes before");
});
it("sends pause and skip actions for the selected QR only", async () => {
  fetchMock.mockImplementation(async (_path, options) => options.method === "PATCH" ? json({ ok: true }) : json({ codes: [{ ...code, schedule }], timezone: { timezone_name: "UTC", timezone_confirmed: true } }));
  render(<AttendanceQrManager orgId="org" drafts={[]} services={services} initialDraftId={null} />);
  fireEvent.click(screen.getByRole("button", { name: "QR Check-in" })); fireEvent.click(await screen.findByRole("button", { name: "Pause recurrence" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/attendance/check-in-codes/code/schedule", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ action: "pause" }) })));
  await waitFor(() => expect((screen.getByRole("button", { name: "Skip 2030-01-06" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Skip 2030-01-06" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/attendance/check-in-codes/code/schedule", expect.objectContaining({ body: JSON.stringify({ action: "skip", date: "2030-01-06" }) })));
});
it("shows code-save failures inside the scrolling editor and enables retry", async () => {
  render(<AttendanceQrManager orgId="org" drafts={[]} services={services} initialDraftId={null} />);
  fireEvent.click(screen.getByRole("button", { name: "QR Check-in" }));
  await screen.findByRole("button", { name: "Repeat automatically" }); fireEvent.click(screen.getByRole("button", { name: "New QR code" }));
  fireEvent.change(screen.getByLabelText("QR name"), { target: { value: "New entrance" } });
  fetchMock.mockRejectedValueOnce(new Error("Connection lost")); fireEvent.click(screen.getByRole("button", { name: /^Create$/ }));
  await screen.findByRole("alert");
  const modal = screen.getByRole("heading", { name: "New attendance QR code" }).parentElement!;
  expect(modal.className).toContain("overflow-y-auto"); expect(within(modal).getByRole("alert").textContent).toBe("Connection lost");
  expect((within(modal).getByRole("button", { name: /^Create$/ }) as HTMLButtonElement).disabled).toBe(false);
});
