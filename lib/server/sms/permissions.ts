import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { SmsPermissionEvent } from "@/lib/sms/permissions";

export async function getSmsPermissionEvents(orgId: string, phone?: string) {
  const rows: SmsPermissionEvent[] = [];
  for (let from = 0; ; from += 1000) {
    let query = supabaseAdmin.from("sms_permission_events")
      .select("id,phone_e164,category,status,method,disclosure,evidence_note,obtained_at,created_at,recorded_by")
      .eq("org_id", orgId).order("obtained_at", { ascending: false }).order("id").range(from, from + 999);
    if (phone) query = query.eq("phone_e164", phone);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []) as SmsPermissionEvent[]);
    if (!data || data.length < 1000) return rows;
  }
}
