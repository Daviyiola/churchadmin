import { beforeEach, expect, it, vi } from "vitest";
import { database } from "./helpers/database";
const state = vi.hoisted(() => ({ db: null as ReturnType<typeof database> | null, rpc: vi.fn() }));
vi.mock("@/lib/supabaseClient", () => ({ supabase: { from: (table: string) => state.db!.from(table), rpc: state.rpc } }));
import { confirmAttendancePublish } from "@/lib/attendance/publish";
beforeEach(() => { state.db = database(); state.rpc.mockReset().mockResolvedValue({ error: null }); });
it.each([0, 1, 4])("checks the live unresolved count (%s) before publishing", async count => {
  state.db!.queue("attendance_public_checkins", { count });
  const confirm = vi.fn().mockReturnValue(true);
  expect(await confirmAttendancePublish("draft", confirm)).toBe(true);
  expect(confirm).toHaveBeenCalledWith(count ? expect.stringContaining(`${count} unresolved QR`) : "Publish this attendance draft?");
  expect(state.rpc).toHaveBeenCalledWith("publish_attendance_session", { p_session_id: "draft", p_acknowledge_unresolved: count > 0 });
  expect(state.db!.calls).toContainEqual({ table: "attendance_public_checkins", method: "eq", args: ["session_id", "draft"] });
});
it("does not publish when confirmation is cancelled", async () => {
  state.db!.queue("attendance_public_checkins", { count: 1 });
  expect(await confirmAttendancePublish("draft", () => false)).toBe(false);
  expect(state.rpc).not.toHaveBeenCalled();
});
it.each([{ error: { message: "offline" } }, { count: null }])("does not treat a failed preflight as zero pending", async result => {
  state.db!.queue("attendance_public_checkins", result);
  const confirm = vi.fn();
  await expect(confirmAttendancePublish("draft", confirm)).rejects.toThrow("Unable to check pending QR attendance");
  expect(confirm).not.toHaveBeenCalled(); expect(state.rpc).not.toHaveBeenCalled();
});
it("reports a database refusal without claiming success", async () => {
  state.db!.queue("attendance_public_checkins", { count: 0 });
  state.rpc.mockResolvedValue({ error: { message: "Unresolved QR check-ins must be acknowledged before publishing." } });
  await expect(confirmAttendancePublish("draft", () => true)).rejects.toThrow("must be acknowledged");
});
