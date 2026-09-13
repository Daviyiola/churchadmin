// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
const api = vi.hoisted(() => vi.fn());
vi.mock("@/lib/attendance/staffApi", () => ({ attendanceStaffApi: api }));
import UnresolvedCheckins from "@/components/attendance/UnresolvedCheckins";
afterEach(() => { cleanup(); api.mockReset(); });
it("shows a failed review load instead of pretending there are no unresolved check-ins", async () => {
  api.mockRejectedValueOnce(new Error("Service unavailable")).mockResolvedValue({ checkins: [{ id: "pending", state: "unresolved", submitted_first_name: "Test", submitted_last_name: "Visitor", created_at: "2030-01-01", person_warnings: [] }] });
  const count = vi.fn();
  render(<UnresolvedCheckins sessionId="draft" members={[]} onResolved={vi.fn()} onCount={count} />);
  expect((await screen.findByRole("alert")).textContent).toContain("Service unavailable");
  expect(count).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Retry QR check-ins" }));
  expect(await screen.findByText("Test Visitor")).toBeTruthy();
  expect(count).toHaveBeenCalledWith(1);
});
