import { supabase } from "@/lib/supabaseClient";

export async function attendanceStaffApi(path: string, init: RequestInit = {}) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session?.access_token) throw new Error("Your session expired. Sign in again.");
  const send = (token: string) => fetch(path, {
    ...init, cache: "no-store", signal: init.signal ?? AbortSignal.timeout(15000),
    headers: { ...Object.fromEntries(new Headers(init.headers)), Authorization: `Bearer ${token}` },
  });
  let response = await send(data.session.access_token);
  // A rejected credential cannot have performed the staff operation; retry once.
  if (response.status === 401) {
    const refreshed = await supabase.auth.refreshSession();
    if (refreshed.error || !refreshed.data.session) throw new Error("Your session expired. Sign in again.");
    response = await send(refreshed.data.session.access_token);
  }
  const body = await response.json();
  if (!response.ok) throw new Error(response.status === 401
    ? "Your session could not be verified. Sign in again."
    : body.error || "Unable to complete the request. Please try again.");
  return body;
}
