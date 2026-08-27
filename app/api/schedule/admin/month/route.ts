import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireActorId } from "@/lib/server/authUser";
import { cleanStr, isYYYYMM } from "@/lib/schedule/util";
import { ensureScheduleMonth } from "@/lib/schedule/admin";
import { requireOrgOperator } from "@/lib/schedule/admin_auth";
import type { AdminMonthResponse } from "@/lib/schedule/types";

type ErrorJson = { error: string };

export async function GET(req: Request) {
  try {
    const actorId = await requireActorId(req);
    const { searchParams } = new URL(req.url);

    const orgId = cleanStr(searchParams.get("org_id"));
    const month = cleanStr(searchParams.get("month"));

    if (!orgId)
      return NextResponse.json<ErrorJson>(
        { error: "Missing org_id" },
        { status: 400 },
      );
    if (!month || !isYYYYMM(month))
      return NextResponse.json<ErrorJson>(
        { error: "Invalid month" },
        { status: 400 },
      );

    const perm = await requireOrgOperator(actorId, orgId);
    if (!perm.ok)
      return NextResponse.json<ErrorJson>(
        { error: perm.error },
        { status: perm.status },
      );

    // Ensure month exists (admin can browse any month)
    const ensured = await ensureScheduleMonth(orgId, month, actorId);

    if (!ensured.ok)
      return NextResponse.json<ErrorJson>(
        { error: ensured.error },
        { status: 400 },
      );

    const monthId = ensured.monthRow.id;

    const [{ data: entries, error: eErr }, { data: settings, error: settingsError }] = await Promise.all([
      supabaseAdmin.from("schedule_entries")
        .select("id,date,service_category_id,department_category_id,role,name,notes,status,created_at")
        .eq("org_id", orgId).eq("month_id", monthId)
        .order("date", { ascending: true }).order("created_at", { ascending: true }),
      supabaseAdmin.from("schedule_settings").select("show_birthdays").eq("org_id", orgId).maybeSingle(),
    ]);

    if (eErr)
      return NextResponse.json<ErrorJson>(
        { error: eErr.message },
        { status: 400 },
      );
    if (settingsError) throw new Error(settingsError.message);

    const showBirthdays = settings?.show_birthdays ?? true;
    const birthdayRows: Array<{ id: string; first_name: string | null; last_name: string | null; birth_month: number | null; birth_day: number | null }> = [];
    if (showBirthdays) {
      const selectedMonth = Number(month.slice(5, 7));
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const { data: members, error: memberError } = await supabaseAdmin
          .from("members")
          .select("id,first_name,last_name,birth_month,birth_day")
          .eq("org_id", orgId)
          .eq("membership_stage", "member")
          .eq("status", "active")
          .eq("birth_month", selectedMonth)
          .not("birth_day", "is", null)
          .order("first_name", { ascending: true })
          .range(from, from + pageSize - 1);
        if (memberError) throw new Error(memberError.message);
        birthdayRows.push(...((members ?? []) as typeof birthdayRows));
        if ((members ?? []).length < pageSize) break;
      }
    }

    const out: AdminMonthResponse = {
      ok: true,
      month: {
        id: monthId,
        month: ensured.monthRow.month,
        draft_open: ensured.monthRow.draft_open,
        edits_open: Boolean(
          (ensured.monthRow as { edits_open?: unknown }).edits_open,
        ),
        is_public_visible: ensured.monthRow.is_public_visible,
        month_code_set_at:
          (ensured.monthRow as { month_code_set_at?: string | null })
            .month_code_set_at ?? null,
      },

      entries: (entries ?? []).map((r) => ({
        id: String(r.id),
        date: String(r.date),
        service_category_id: r.service_category_id
          ? String(r.service_category_id)
          : null,
        department_category_id: r.department_category_id
          ? String(r.department_category_id)
          : null,
        role: r.role,
        name: String(r.name),
        notes: r.notes ? String(r.notes) : null,
        status: r.status,
        created_at: String(r.created_at),
      })),
      settings: { show_birthdays: showBirthdays },
      birthdays: birthdayRows.map((member) => ({
        member_id: member.id,
        date: `${month}-${String(member.birth_day).padStart(2, "0")}`,
        name: [member.first_name, member.last_name].filter(Boolean).join(" ").trim() || "Member",
      })),
    };

    return NextResponse.json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    if (msg === "UNAUTHORIZED") {
      return NextResponse.json<ErrorJson>(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }
    return NextResponse.json<ErrorJson>({ error: msg }, { status: 400 });
  }
}
