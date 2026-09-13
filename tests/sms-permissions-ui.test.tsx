// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SmsPermissions } from "@/components/communications/SmsPermissions";
afterEach(cleanup);
function setup(blocked = false) {
  const request = vi.fn().mockResolvedValue({ events: [], suppression: blocked ? { source: "stop" } : null });
  const changed = vi.fn();
  render(<SmsPermissions orgId="org" people={[{ id: "member", name: "David", phone: "2125551234" }]} request={request} onChanged={changed} />);
  return { request, changed };
}
it("starts without presumed permission and records the actual conversation", async () => {
  const { request, changed } = setup();
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  fireEvent.change(screen.getByLabelText("Directory contact"), { target: { value: "2125551234" } });
  await screen.findByText(/informational: No permission recorded/i);
  fireEvent.change(screen.getByLabelText("What did the person agree to?"), { target: { value: "Agreed to Example Church schedule texts after explaining STOP and message charges." } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Record permission" }));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  const call = request.mock.calls.find((args) => args[1]?.method === "POST");
  expect(JSON.parse(call![1].body)).toMatchObject({ organization_id: "org", phone: "2125551234", method: "verbal", category: "informational", confirmed: true });
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
});
it("keeps STOP visible and does not offer verbal promotional permission", async () => {
  setup(true);
  fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "2125551234" } });
  await screen.findByText(/This number is blocked/);
  fireEvent.change(screen.getByLabelText("Message category"), { target: { value: "promotional" } });
  expect(screen.queryByRole("option", { name: "Verbal conversation" })).toBeNull();
  expect(screen.getByLabelText("Where is the written evidence retained?")).toBeTruthy();
});
it("shows save errors, keeps entered evidence, and allows retry", async () => {
  const { request, changed } = setup();
  fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "2125551234" } });
  await screen.findByText(/informational: No permission recorded/i);
  fireEvent.change(screen.getByLabelText("What did the person agree to?"), { target: { value: "Agreed to receive church schedule updates after the service." } });
  fireEvent.click(screen.getByRole("checkbox"));
  request.mockRejectedValueOnce(new Error("Connection interrupted"));
  fireEvent.click(screen.getByRole("button", { name: "Record permission" }));
  await screen.findByRole("alert");
  expect(changed).not.toHaveBeenCalled();
  expect((screen.getByRole("button", { name: "Record permission" }) as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByLabelText("What did the person agree to?") as HTMLTextAreaElement).value).toContain("church schedule updates");
});
it("clears evidence and confirmation when changing the recipient", async () => {
  setup();
  fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "2125551234" } });
  await screen.findByText(/informational: No permission recorded/i);
  fireEvent.change(screen.getByLabelText("What did the person agree to?"), { target: { value: "Agreed to church schedule updates after the service." } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "2125551235" } });
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  expect((screen.getByLabelText("What did the person agree to?") as HTMLTextAreaElement).value).toBe("");
  await screen.findByText(/informational: No permission recorded/i);
});
