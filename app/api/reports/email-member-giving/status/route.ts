export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireUser } from "@/lib/serverAuthz";

type ErrorJson = { error: string };

type RecipientStatus =
  | "pending"
  | "processing"
  | "success"
  | "failure"
  | "skipped";

async function countByStatus(job_id: string, status: RecipientStatus) {
  const { count, error } = await supabaseAdmin
    .from("report_email_job_recipients")
    .select("idx", { count: "exact", head: true })
    .eq("job_id", job_id)
    .eq("status", status);

  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function GET(req: Request) {
  try {
    const u = await requireUser(req);
    if (!u.ok) {
      return NextResponse.json<ErrorJson>({ error: u.error }, { status: u.status });
    }

    const url = new URL(req.url);
    const organization_id = String(url.searchParams.get("organization_id") ?? "").trim();
    const job_id = String(url.searchParams.get("job_id") ?? "").trim();

    if (!organization_id)
      return NextResponse.json({ error: "organization_id required" }, { status: 400 });
    if (!job_id)
      return NextResponse.json({ error: "job_id required" }, { status: 400 });

    // Must be org member to view progress
    const { data: link, error: linkErr } = await supabaseAdmin
      .from("user_organizations")
      .select("id")
      .eq("organization_id", organization_id)
      .eq("user_id", u.userId)
      .maybeSingle<{ id: string }>();

    if (linkErr) throw new Error(linkErr.message);
    if (!link) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // Job (state only)
    const { data: job, error: jobErr } = await supabaseAdmin
      .from("report_email_jobs")
      .select(
        "id, org_id, campaign_id, status, paused_reason, total, start_date, end_date, attach_summary, attach_detailed, created_at, updated_at",
      )
      .eq("id", job_id)
      .eq("org_id", organization_id)
      .maybeSingle<{
        id: string;
        org_id: string;
        campaign_id: string;
        status: "running" | "paused" | "done" | "error";
        paused_reason: string | null;
        total: number;
        start_date: string;
        end_date: string;
        attach_summary: boolean;
        attach_detailed: boolean;
        created_at: string;
        updated_at: string;
      }>();

    if (jobErr) throw new Error(jobErr.message);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    // Truth-based counts from recipient rows (this fixes UI weirdness)
    const [
      pendingCount,
      processingCount,
      successCount,
      failureCount,
      skippedCount,
    ] = await Promise.all([
      countByStatus(job_id, "pending"),
      countByStatus(job_id, "processing"),
      countByStatus(job_id, "success"),
      countByStatus(job_id, "failure"),
      countByStatus(job_id, "skipped"),
    ]);

    const remaining = pendingCount + processingCount;
    const done = remaining === 0;

    // Recent activity:
    // prefer rows that actually changed recently:
    // 1) sent_at desc (completed first)
    // 2) idx desc tie-break
    const { data: recent, error: rErr } = await supabaseAdmin
      .from("report_email_job_recipients")
      .select("idx, to_email, display_name, status, error, sent_at")
      .eq("job_id", job_id)
      .order("sent_at", { ascending: false, nullsFirst: false })
      .order("idx", { ascending: false })
      .limit(12);

    if (rErr) throw new Error(rErr.message);

    // Optional: if it’s actually done but job.status didn’t get set (rare),
    // you can “heal” it here. Safe & idempotent.
    if (done && job.status !== "done") {
      await supabaseAdmin
        .from("report_email_jobs")
        .update({ status: "done", paused_reason: null })
        .eq("id", job_id)
        .eq("org_id", organization_id);
      job.status = "done";
      job.paused_reason = null;
    }

    return NextResponse.json({
      ok: true,
      job: {
        ...job,
        // overwrite “counts” with truth
        sent_success: successCount,
        sent_failure: failureCount + skippedCount,
        processed: successCount + failureCount + skippedCount,
        pending: pendingCount,
        processing: processingCount,
        skipped: skippedCount,
      },
      recent: (recent ?? []) as Array<{
        idx: number;
        to_email: string;
        display_name: string | null;
        status: RecipientStatus;
        error: string | null;
        sent_at: string | null;
      }>,
      done,
      remaining,
    });
  } catch (e) {
    return NextResponse.json<ErrorJson>(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 400 },
    );
  }
}
