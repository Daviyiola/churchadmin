import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function ensureScheduleMonth(orgId: string, month: string, createdBy?: string) {
  // 1) Try fetch
  const { data: existing, error: selErr } = await supabaseAdmin
    .from("schedule_months")
    .select("id,org_id,month,draft_open,edits_open,is_public_visible,month_code_set_at,created_by")
    .eq("org_id", orgId)
    .eq("month", month)
    .maybeSingle();

  if (selErr) return { ok: false as const, error: selErr.message };
  if (existing) return { ok: true as const, monthRow: existing };

  // 2) Insert (service role → no auth.uid(), so set created_by explicitly if provided)
  const insertPayload: {
    org_id: string;
    month: string;
    draft_open?: boolean;
    is_public_visible?: boolean;
    created_by?: string | null;
  } = {
    org_id: orgId,
    month,
    draft_open: true,
    is_public_visible: true,
  };

  if (typeof createdBy === "string" && createdBy.trim()) {
    insertPayload.created_by = createdBy;
  } else {
    insertPayload.created_by = null; // works if column is nullable (Fix 1)
  }

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from("schedule_months")
    .insert(insertPayload)
    .select("id,org_id,month,draft_open,edits_open,is_public_visible,month_code_set_at,created_by")
    .single();

  if (insErr) return { ok: false as const, error: insErr.message };
  return { ok: true as const, monthRow: inserted };
}
