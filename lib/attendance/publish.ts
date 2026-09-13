import { supabase } from "@/lib/supabaseClient";

/** Read at confirmation time; the review panel may be stale or unavailable. */
export async function confirmAttendancePublish(sessionId: string, confirm: (message: string) => boolean) {
  const { count, error } = await supabase.from("attendance_public_checkins")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId).in("state", ["unresolved", "awaiting_confirmation"]);
  if (error) throw new Error(`Unable to check pending QR attendance: ${error.message}`);
  if (count == null) throw new Error("Unable to check pending QR attendance. Please try again.");
  const unresolved = count;
  const accepted = confirm(unresolved > 0
    ? `This draft has ${unresolved} unresolved QR check-in${unresolved === 1 ? "" : "s"}. Only known attendance will be published. Continue?`
    : "Publish this attendance draft?");
  if (!accepted) return false;
  const { error: publishError } = await supabase.rpc("publish_attendance_session", {
    p_session_id: sessionId, p_acknowledge_unresolved: unresolved > 0,
  });
  if (publishError) throw new Error(publishError.message);
  return true;
}
