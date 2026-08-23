import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  managedFormErrorStatus,
  requireManagedFormContext,
} from "@/lib/server/forms/access";

const PAGE_SIZE = 25;
const SUBMISSION_COLUMNS = "id,form_revision,status,form_snapshot,answers,result_member_id,person_action,processed_at,submitted_at,reviewed_at,archived_at,source_type,source_label";

function searchableSubmission(row: Record<string, unknown>) {
  return [row.form_snapshot, row.answers, row.source_label, row.person_action]
    .map((value) => typeof value === "string" ? value : JSON.stringify(value ?? ""))
    .join(" ")
    .toLowerCase();
}

export async function GET(
  req: Request,
  context: { params: Promise<{ formId: string }> },
) {
  try {
    const { formId } = await context.params;
    const { form } = await requireManagedFormContext(req, formId);
    const url = new URL(req.url);
    const status = url.searchParams.get("status") ?? "all";
    if (!["all", "new", "reviewed", "archived"].includes(status)) {
      throw new Error("Invalid inbox filter");
    }
    const search = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    if (search.length > 120) throw new Error("Search is too long");
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const start = (page - 1) * PAGE_SIZE;
    let data: Record<string, unknown>[] = [];
    let total = 0;
    let counts = { all: 0, new: 0, reviewed: 0, archived: 0 };

    if (search) {
      const allRows: Record<string, unknown>[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data: batch, error } = await supabaseAdmin.from("form_submissions")
          .select(SUBMISSION_COLUMNS).eq("form_id", formId).eq("org_id", form.org_id)
          .order("submitted_at", { ascending: false }).range(offset, offset + 999);
        if (error) throw new Error(error.message);
        allRows.push(...((batch ?? []) as Record<string, unknown>[]));
        if ((batch ?? []).length < 1000) break;
      }
      const matches = allRows.filter((row) => searchableSubmission(row).includes(search));
      counts = {
        all: matches.length,
        new: matches.filter((row) => row.status === "new").length,
        reviewed: matches.filter((row) => row.status === "reviewed").length,
        archived: matches.filter((row) => row.status === "archived").length,
      };
      const statusMatches = status === "all" ? matches : matches.filter((row) => row.status === status);
      total = statusMatches.length;
      data = statusMatches.slice(start, start + PAGE_SIZE);
    } else {
      let query = supabaseAdmin.from("form_submissions").select(SUBMISSION_COLUMNS, { count: "exact" })
        .eq("form_id", formId).eq("org_id", form.org_id).order("submitted_at", { ascending: false })
        .range(start, start + PAGE_SIZE - 1);
      if (status !== "all") query = query.eq("status", status);
      const result = await query;
      if (result.error) throw new Error(result.error.message);
      data = (result.data ?? []) as Record<string, unknown>[];
      total = result.count ?? 0;

      const countQuery = (filter?: "new" | "reviewed" | "archived") => {
        let request = supabaseAdmin.from("form_submissions").select("id", { count: "exact", head: true })
          .eq("form_id", formId).eq("org_id", form.org_id);
        if (filter) request = request.eq("status", filter);
        return request;
      };
      const countResults = await Promise.all([countQuery(), countQuery("new"), countQuery("reviewed"), countQuery("archived")]);
      const countFailure = countResults.find((result) => result.error)?.error;
      if (countFailure) throw new Error(countFailure.message);
      counts = { all: countResults[0].count ?? 0, new: countResults[1].count ?? 0, reviewed: countResults[2].count ?? 0, archived: countResults[3].count ?? 0 };
    }

    const [creator, editor] = await Promise.all([
      supabaseAdmin.auth.admin.getUserById(form.created_by),
      supabaseAdmin.auth.admin.getUserById(form.updated_by),
    ]);

    return NextResponse.json({
      form: {
        ...form,
        created_by_email: creator.data.user?.email ?? "Unknown user",
        updated_by_email: editor.data.user?.email ?? "Unknown user",
      },
      submissions: data,
      counts,
      page,
      page_size: PAGE_SIZE,
      total,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load submissions.";
    return NextResponse.json({ error: message }, { status: managedFormErrorStatus(message) });
  }
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ formId: string }> },
) {
  try {
    const { formId } = await context.params;
    const { actorId, form } = await requireManagedFormContext(req, formId);
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || Object.keys(body).some((key) => !["submission_id", "status"].includes(key))) {
      throw new Error("Invalid request");
    }
    const submissionId = String(body.submission_id ?? "");
    const status = String(body.status ?? "");
    if (!["new", "reviewed", "archived"].includes(status)) throw new Error("Invalid status");
    const { data: submission, error: lookupError } = await supabaseAdmin
      .from("form_submissions")
      .select("id")
      .eq("id", submissionId)
      .eq("form_id", form.id)
      .eq("org_id", form.org_id)
      .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    if (!submission) throw new Error("Submission not found");

    const { error } = await supabaseAdmin.rpc("set_form_submission_status", {
      p_submission_id: submissionId,
      p_actor_id: actorId,
      p_status: status,
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update submission.";
    return NextResponse.json({ error: message }, { status: managedFormErrorStatus(message) });
  }
}
